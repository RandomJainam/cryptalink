import json
import io
import socket
import threading
import time

from audit.logger import AuditLogger
from client.attacks import tamper_packet
from client.client import _recv_exact, build_packet_for, send_raw
from config import (MAX_PACKET_BYTES, STATUS_INTEGRITY_FAILED, STATUS_OK,
                    STATUS_REPLAY, STATUS_STALE_TIMESTAMP, STATUS_TOO_LARGE)
from client.client import send_file
from fastapi import HTTPException, UploadFile
import pytest
from crypto.keys import generate_rsa_keypair
from server.server import recv_exact, serve_forever


def test_audit_chain_resumes_and_detects_edit(tmp_path):
    path = tmp_path / "audit.jsonl"
    logger = AuditLogger(path)
    logger.append_event("TRANSFER_ACCEPTED", "01", "127.0.0.1", "accepted", "ok", 4)
    assert logger.verify_chain() == (True, None)
    resumed = AuditLogger(path)
    assert resumed.append_event("REPLAY_REJECTED", "01", "127.0.0.1", "rejected", "replay", 0)["seq"] == 2
    assert len(resumed.read_events(50)) == 2
    records = path.read_text(encoding="utf-8").splitlines()
    record = json.loads(records[0])
    record["reason"] = "edited"
    records[0] = json.dumps(record)
    path.write_text("\n".join(records) + "\n", encoding="utf-8")
    assert resumed.verify_chain() == (False, 1)


def test_recv_exact_handles_partial_reads_and_early_close():
    left, right = socket.socketpair()
    try:
        left.sendall(b"ab")
        left.sendall(b"cd")
        assert recv_exact(right, 4) == b"abcd"
        left.close()
        try:
            recv_exact(right, 1)
        except EOFError:
            pass
        else:
            raise AssertionError("early close was not detected")
    finally:
        right.close()


def test_tcp_transfer_saves_identical_bytes(tmp_path, monkeypatch):
    import server.storage

    monkeypatch.setattr(server.storage, "RECEIVED_DIR", tmp_path / "received")
    private_key, public_key = generate_rsa_keypair()
    logger = AuditLogger(tmp_path / "audit.jsonl")
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    stop = threading.Event()
    thread = threading.Thread(target=serve_forever,
                              kwargs={"host": "127.0.0.1", "port": port,
                                      "private_key": private_key, "logger": logger,
                                      "stop_event": stop}, daemon=True)
    thread.start()
    time.sleep(0.1)
    try:
        result = send_file(b"same bytes", "demo.txt", "127.0.0.1", port, public_key)
    finally:
        stop.set()
        thread.join(timeout=2)
    assert result["status_code"] == 0
    saved = list((tmp_path / "received").iterdir())
    assert len(saved) == 1 and saved[0].read_bytes() == b"same bytes"


def _send_oversized_length(host, port, size):
    with socket.create_connection((host, port), timeout=3) as connection:
        connection.sendall(size.to_bytes(4, "big"))
        response_size = int.from_bytes(_recv_exact(connection, 4), "big")
        body = _recv_exact(connection, response_size)
    reason_size = int.from_bytes(body[17:19], "big")
    return {"status_code": body[0], "reason": body[19:19 + reason_size].decode("utf-8")}


def test_socket_attack_replay_stale_oversize_and_traversal(tmp_path, monkeypatch):
    import server.storage

    monkeypatch.setattr(server.storage, "RECEIVED_DIR", tmp_path / "received")
    private_key, public_key = generate_rsa_keypair()
    logger = AuditLogger(tmp_path / "audit.jsonl")
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    stop = threading.Event()
    thread = threading.Thread(target=serve_forever,
                              kwargs={"host": "127.0.0.1", "port": port,
                                      "private_key": private_key, "logger": logger,
                                      "stop_event": stop}, daemon=True)
    thread.start()
    time.sleep(0.1)
    try:
        content = b"socket demo"
        original = build_packet_for(content, "original.txt", public_key)
        accepted = send_raw(original, "127.0.0.1", port)
        assert accepted["status_code"] == STATUS_OK
        received_dir = tmp_path / "received"
        assert len(list(received_dir.iterdir())) == 1

        tampered = send_raw(tamper_packet(original), "127.0.0.1", port)
        assert tampered["status_code"] == STATUS_INTEGRITY_FAILED
        assert len(list(received_dir.iterdir())) == 1

        replay = send_raw(original, "127.0.0.1", port)
        assert replay["status_code"] == STATUS_REPLAY
        assert len(list(received_dir.iterdir())) == 1

        stale_packet = build_packet_for(content, "stale.txt", public_key,
                                        timestamp=int(time.time()) - 61)
        stale = send_raw(stale_packet, "127.0.0.1", port)
        assert stale["status_code"] == STATUS_STALE_TIMESTAMP
        assert len(list(received_dir.iterdir())) == 1

        oversized = _send_oversized_length("127.0.0.1", port, MAX_PACKET_BYTES + 1)
        assert oversized["status_code"] == STATUS_TOO_LARGE
        assert len(list(received_dir.iterdir())) == 1

        traversal_packet = build_packet_for(content, "../../escape.txt", public_key)
        traversal = send_raw(traversal_packet, "127.0.0.1", port)
        assert traversal["status_code"] == STATUS_OK
        saved = list(received_dir.iterdir())
        assert len(saved) == 2 and any(path.name.endswith("_escape.txt") for path in saved)
        assert all(path.parent == received_dir for path in saved)
        assert not (tmp_path / "escape.txt").exists()
    finally:
        stop.set()
        thread.join(timeout=2)

    assert [event["event_type"] for event in logger.read_events(20)] == [
        "TRANSFER_ACCEPTED", "INTEGRITY_VIOLATION", "REPLAY_REJECTED",
        "STALE_TIMESTAMP", "OVERSIZE_REJECTED", "TRANSFER_ACCEPTED",
    ]


def test_gateway_openapi_matches_spec_contract():
    from gateway.main import app

    schema = app.openapi()
    assert set(schema["paths"]) == {
        "/api/status", "/api/transfer", "/api/simulate/tamper",
        "/api/simulate/replay", "/api/logs", "/api/logs/verify",
    }
    models = schema["components"]["schemas"]
    assert list(models["TransferResult"]["properties"]) == [
        "status", "message_id", "filename", "size_bytes", "reason", "steps", "duration_ms",
    ]
    assert list(models["TransferStep"]["properties"]) == ["name", "ok", "detail"]
    assert list(models["StatusResult"]["properties"]) == [
        "server_reachable", "fingerprint", "algorithms", "replay_window_seconds",
    ]
    upload = schema["paths"]["/api/transfer"]["post"]["requestBody"]
    assert "multipart/form-data" in upload["content"]
    optional_upload = schema["paths"]["/api/simulate/tamper"]["post"]["requestBody"]
    assert optional_upload.get("required") is not True


def test_gateway_status_to_steps_mapping():
    from config import (STATUS_DECRYPT_FAILED, STATUS_INTEGRITY_FAILED, STATUS_INTERNAL,
                        STATUS_MALFORMED, STATUS_OK, STATUS_REPLAY,
                        STATUS_STALE_TIMESTAMP, STATUS_TOO_LARGE)
    from gateway.main import _steps

    progress = ["encrypt", "wrap_key", "integrity_tag", "transmit"]
    cases = [
        (STATUS_MALFORMED, [False, False, False, False, False]),
        (STATUS_INTEGRITY_FAILED, [False, False, False, False, False]),
        (STATUS_STALE_TIMESTAMP, [True, False, False, False, False]),
        (STATUS_REPLAY, [True, True, False, False, False]),
        (STATUS_DECRYPT_FAILED, [True, True, True, False, False]),
        (STATUS_TOO_LARGE, [False, False, False, False, False]),
        (STATUS_INTERNAL, [False, False, False, False, False]),
        (STATUS_OK, [True, True, True, True, True]),
    ]
    for status_code, expected in cases:
        server_steps = _steps(progress, status_code, "check rejected")[4:]
        assert [step.ok for step in server_steps] == expected
    failed_decrypt = _steps(progress, STATUS_DECRYPT_FAILED, "bad tag")[4:]
    assert [step.name for step in failed_decrypt] == [
        "verify_hmac", "freshness", "replay_check", "decrypt", "store",
    ]
    assert failed_decrypt[0].ok and failed_decrypt[1].ok and failed_decrypt[2].ok
    assert failed_decrypt[3].ok is False and failed_decrypt[3].detail == "bad tag"


def test_gateway_cors_has_both_local_origins():
    from fastapi.middleware.cors import CORSMiddleware
    from gateway.main import app

    options = next(middleware.kwargs for middleware in app.user_middleware
                   if middleware.cls is CORSMiddleware)
    assert options["allow_origins"] == [
        "http://localhost:5173", "http://127.0.0.1:5173",
    ]


def test_gateway_audit_access_is_read_only(tmp_path, monkeypatch):
    import gateway.main
    from unittest.mock import Mock
    from types import SimpleNamespace
    from audit.logger import AuditLogger

    audit_path = tmp_path / "logs" / "audit.jsonl"
    logger = AuditLogger(audit_path)
    assert logger.read_events(50) == []
    assert logger.verify_chain() == (True, None)
    assert not audit_path.parent.exists()

    read_only = SimpleNamespace(
        read_events=Mock(return_value=[]),
        verify_chain=Mock(return_value=(True, None)),
        append_event=Mock(side_effect=AssertionError("gateway must not append audit events")),
    )
    monkeypatch.setattr(gateway.main, "AuditLogger", lambda: read_only)
    assert gateway.main.logs() == []
    assert gateway.main.verify_logs().chain_valid


def test_gateway_transfer_returns_503_when_tcp_server_is_down(tmp_path, monkeypatch):
    import gateway.main
    from crypto.keys import save_public

    _, public_key = generate_rsa_keypair()
    public_path = tmp_path / "server_public.pem"
    save_public(public_key, public_path)
    monkeypatch.setattr(gateway.main, "PUBLIC_KEY_PATH", public_path)
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    monkeypatch.setattr(gateway.main, "HOST", "127.0.0.1")
    monkeypatch.setattr(gateway.main, "PORT", port)
    with pytest.raises(HTTPException) as unavailable:
        gateway.main.transfer(UploadFile(filename="offline.txt", file=io.BytesIO(b"offline")))
    assert unavailable.value.status_code == 503
    assert "TCP server unavailable" in unavailable.value.detail


def test_server_main_handles_keyboard_interrupt(monkeypatch, capsys):
    import server.server
    from types import SimpleNamespace

    key = SimpleNamespace(public_key=lambda: object())
    logger = SimpleNamespace(append_event=lambda *_args: None)
    monkeypatch.setattr(server.server, "_load_or_create_private_key", lambda: key)
    monkeypatch.setattr(server.server, "fingerprint", lambda _key: "fingerprint")
    monkeypatch.setattr(server.server, "AuditLogger", lambda: logger)
    monkeypatch.setattr(server.server, "serve_forever",
                        lambda **_kwargs: (_ for _ in ()).throw(KeyboardInterrupt))
    server.server.main()
    output = capsys.readouterr().out
    assert output.splitlines()[-1] == "Server stopped"
    assert "Traceback" not in output


def test_gateway_status_transfer_and_replay_use_tcp_server(tmp_path, monkeypatch):
    import gateway.main
    import gateway.state
    import server.storage

    monkeypatch.setattr(server.storage, "RECEIVED_DIR", tmp_path / "received")
    private_key, public_key = generate_rsa_keypair()
    public_path = tmp_path / "server_public.pem"
    from crypto.keys import save_public
    save_public(public_key, public_path)
    monkeypatch.setattr(gateway.main, "PUBLIC_KEY_PATH", public_path)
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    monkeypatch.setattr(gateway.main, "HOST", "127.0.0.1")
    monkeypatch.setattr(gateway.main, "PORT", port)
    monkeypatch.setattr(gateway.state, "_last_successful", None)
    logger = AuditLogger(tmp_path / "audit.jsonl")
    stop = threading.Event()
    thread = threading.Thread(target=serve_forever,
                              kwargs={"host": "127.0.0.1", "port": port,
                                      "private_key": private_key, "logger": logger,
                                      "stop_event": stop}, daemon=True)
    thread.start()
    time.sleep(0.1)
    try:
        status_result = gateway.main.status()
        assert status_result.server_reachable
        assert status_result.fingerprint
        with pytest.raises(HTTPException) as missing_replay:
            gateway.main.simulate_replay()
        assert missing_replay.value.status_code == 409
        result = gateway.main.transfer(UploadFile(filename="from-gateway.txt", file=io.BytesIO(b"via gateway")))
        assert result.status == "accepted"
        assert [step.name for step in result.steps] == [
            "encrypt", "wrap_key", "integrity_tag", "transmit", "verify_hmac",
            "freshness", "replay_check", "decrypt", "store",
        ]
        tampered = gateway.main.simulate_tamper(
            UploadFile(filename="tampered.txt", file=io.BytesIO(b"tamper me")))
        assert tampered.status == "rejected"
        assert tampered.steps[4].ok is False
        replay = gateway.main.simulate_replay()
        assert replay.status == "rejected"
        assert replay.message_id == result.message_id
        assert replay.steps[6].ok is False
        assert [path.read_bytes() for path in (tmp_path / "received").iterdir()] == [b"via gateway"]
    finally:
        stop.set()
        thread.join(timeout=2)
