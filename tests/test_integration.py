import json
import socket
import threading
import time

from audit.logger import AuditLogger
from client.client import send_file
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
