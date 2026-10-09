import pytest

from audit.logger import AuditLogger
from config import (STATUS_DECRYPT_FAILED, STATUS_INTEGRITY_FAILED, STATUS_INTERNAL,
                    MAX_FILE_BYTES, STATUS_MALFORMED, STATUS_OK, STATUS_REPLAY,
                    STATUS_STALE_TIMESTAMP, STATUS_TOO_LARGE)
from crypto.encryption import encrypt
from crypto.integrity import make_tag
from crypto.keys import generate_rsa_keypair
from crypto.packet import Packet, build_packet, encode_plaintext, parse_packet, signed_region
from crypto.session import new_session_key, split, wrap
from server.pipeline import process
from server.replay_cache import ReplayCache


@pytest.fixture(scope="module")
def key_pair():
    return generate_rsa_keypair()


def make_raw(public_key, filename="note.txt", content=b"hello", timestamp=100,
             message_id=b"m" * 16, bad_gcm_tag=False, plaintext=None):
    secret = new_session_key()
    aes_key, hmac_key = split(secret)
    aad = b"CLNK\x01" + message_id + timestamp.to_bytes(8, "big")
    payload = encode_plaintext(filename, content) if plaintext is None else plaintext
    nonce, ciphertext = encrypt(aes_key, payload, aad)
    if bad_gcm_tag:
        ciphertext = ciphertext[:-1] + bytes([ciphertext[-1] ^ 1])
    unsigned = Packet(message_id, timestamp, nonce, wrap(secret, public_key), ciphertext, b"\0" * 32)
    region = signed_region(build_packet(unsigned))
    packet = Packet(message_id, timestamp, nonce, unsigned.enc_session_key,
                    ciphertext, make_tag(hmac_key, region))
    return build_packet(packet)


def run(raw, private_key, tmp_path, now=100):
    logger = AuditLogger(tmp_path / "audit.jsonl")
    return process(raw, "127.0.0.1", private_key, ReplayCache(), logger, now=now)


def test_corrupted_enc_session_key_is_integrity_failed_not_malformed(key_pair, tmp_path):
    private_key, public_key = key_pair
    raw = bytearray(make_raw(public_key))
    raw[43] ^= 1
    status, _, _ = run(bytes(raw), private_key, tmp_path)
    assert status == STATUS_INTEGRITY_FAILED
    assert not (tmp_path / "received").exists()


@pytest.mark.parametrize("offset", [21, 43, 435], ids=["timestamp", "enc_session_key", "ciphertext"])
def test_packet_tampering_returns_integrity_failed(offset, key_pair, tmp_path):
    private_key, public_key = key_pair
    raw = bytearray(make_raw(public_key))
    raw[offset] ^= 1
    assert run(bytes(raw), private_key, tmp_path)[0] == STATUS_INTEGRITY_FAILED
    assert not (tmp_path / "received").exists()


def test_bad_hmac_does_not_poison_cache(key_pair, tmp_path, monkeypatch):
    import server.storage

    private_key, public_key = key_pair
    monkeypatch.setattr(server.storage, "RECEIVED_DIR", tmp_path / "received")
    raw = bytearray(make_raw(public_key))
    raw[-1] ^= 1
    cache = ReplayCache()
    logger = AuditLogger(tmp_path / "audit.jsonl")
    assert process(bytes(raw), "127.0.0.1", private_key, cache, logger, now=100)[0] == STATUS_INTEGRITY_FAILED
    assert process(make_raw(public_key), "127.0.0.1", private_key, cache, logger, now=100)[0] == STATUS_OK


def test_valid_hmac_bad_gcm_tag_consumes_message_id(key_pair, tmp_path, monkeypatch):
    import server.storage

    monkeypatch.setattr(server.storage, "RECEIVED_DIR", tmp_path / "received")
    private_key, public_key = key_pair
    cache = ReplayCache()
    logger = AuditLogger(tmp_path / "audit.jsonl")
    message_id = b"g" * 16
    invalid_gcm = make_raw(public_key, message_id=message_id, bad_gcm_tag=True)
    valid = make_raw(public_key, message_id=message_id)
    assert process(invalid_gcm, "127.0.0.1", private_key, cache, logger, now=100)[0] == STATUS_DECRYPT_FAILED
    assert process(valid, "127.0.0.1", private_key, cache, logger, now=100)[0] == STATUS_REPLAY
    assert list((tmp_path / "received").glob("*")) == []


@pytest.mark.parametrize("timestamp,expected", [(40, STATUS_OK), (160, STATUS_OK),
                                                   (39, STATUS_STALE_TIMESTAMP), (161, STATUS_STALE_TIMESTAMP)])
def test_timestamp_boundary(timestamp, expected, key_pair, tmp_path, monkeypatch):
    import server.storage

    monkeypatch.setattr(server.storage, "RECEIVED_DIR", tmp_path / "received")
    private_key, public_key = key_pair
    status, _, _ = run(make_raw(public_key, timestamp=timestamp), private_key, tmp_path, now=100)
    assert status == expected


def test_success_saves_exact_bytes(key_pair, tmp_path, monkeypatch):
    import server.storage

    monkeypatch.setattr(server.storage, "RECEIVED_DIR", tmp_path / "received")
    private_key, public_key = key_pair
    status, _, _ = run(make_raw(public_key, content=b"identical"), private_key, tmp_path)
    assert status == STATUS_OK
    assert [p.read_bytes() for p in (tmp_path / "received").iterdir()] == [b"identical"]


def test_path_traversal_filename_is_saved_inside_received_directory(key_pair, tmp_path, monkeypatch):
    import server.storage

    monkeypatch.setattr(server.storage, "RECEIVED_DIR", tmp_path / "received")
    private_key, public_key = key_pair
    status, message_id, _ = run(make_raw(public_key, filename="../../outside.txt"), private_key, tmp_path)
    saved = list((tmp_path / "received").iterdir())
    assert status == STATUS_OK
    assert len(saved) == 1 and saved[0].parent == tmp_path / "received"
    assert saved[0].name == f"{message_id.hex()}_outside.txt"
    assert not (tmp_path / "outside.txt").exists()


@pytest.mark.parametrize("plaintext", [b"\x00\x01\xff", b"\x00\x10short"],
                         ids=["invalid_utf8_filename", "bad_filename_length"])
def test_bad_decrypted_plaintext_is_decrypt_failed_and_not_saved(plaintext, key_pair, tmp_path, monkeypatch):
    import server.storage

    monkeypatch.setattr(server.storage, "RECEIVED_DIR", tmp_path / "received")
    private_key, public_key = key_pair
    status, _, _ = run(make_raw(public_key, plaintext=plaintext), private_key, tmp_path)
    assert status == STATUS_DECRYPT_FAILED
    assert not (tmp_path / "received").exists()


@pytest.mark.parametrize("raw,status,event_type", [
    (b"bad", STATUS_MALFORMED, "MALFORMED_PACKET"),
    (None, STATUS_INTERNAL, "INTERNAL_ERROR"),
])
def test_malformed_and_internal_exits_are_audited(raw, status, event_type,
                                                   key_pair, tmp_path, monkeypatch):
    import server.pipeline

    private_key, public_key = key_pair
    logger = AuditLogger(tmp_path / "audit.jsonl")
    replay_cache = ReplayCache()
    packet = make_raw(public_key)
    if raw is None:
        monkeypatch.setattr(server.pipeline, "save_file", lambda *_: (_ for _ in ()).throw(OSError("disk")))
        raw = packet
    result = process(raw, "127.0.0.1", private_key, replay_cache, logger, now=100)
    assert result[0] == status
    assert logger.read_events(1)[0]["event_type"] == event_type


@pytest.mark.parametrize("failure", ["malformed", "integrity", "stale", "replay",
                                      "decrypt", "too_large", "internal"])
def test_rejections_never_save_files(failure, key_pair, tmp_path, monkeypatch):
    import server.pipeline
    import server.storage

    monkeypatch.setattr(server.storage, "RECEIVED_DIR", tmp_path / "received")
    private_key, public_key = key_pair
    cache = ReplayCache()
    if failure == "malformed":
        raw, expected = b"bad", STATUS_MALFORMED
    elif failure == "integrity":
        raw = bytearray(make_raw(public_key))
        raw[-1] ^= 1
        raw, expected = bytes(raw), STATUS_INTEGRITY_FAILED
    elif failure == "stale":
        raw, expected = make_raw(public_key, timestamp=38), STATUS_STALE_TIMESTAMP
    elif failure == "replay":
        raw = make_raw(public_key)
        cache.check_and_add(parse_packet(raw).message_id, 100)
        expected = STATUS_REPLAY
    elif failure == "decrypt":
        raw, expected = make_raw(public_key, bad_gcm_tag=True), STATUS_DECRYPT_FAILED
    elif failure == "too_large":
        raw, expected = make_raw(public_key, content=b"x" * (MAX_FILE_BYTES + 1)), STATUS_TOO_LARGE
    else:
        raw, expected = make_raw(public_key), STATUS_INTERNAL
        monkeypatch.setattr(server.pipeline, "save_file", lambda *_: (_ for _ in ()).throw(OSError("disk")))
    logger = AuditLogger(tmp_path / "audit.jsonl")
    assert process(raw, "127.0.0.1", private_key, cache, logger, now=100)[0] == expected
    assert not (tmp_path / "received").exists() or list((tmp_path / "received").iterdir()) == []
