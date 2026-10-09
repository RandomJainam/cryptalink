"""Ordered packet verification and storage pipeline."""

import time

from cryptography.exceptions import InvalidTag

from config import (MAX_FILE_BYTES, REPLAY_WINDOW_SECONDS, STATUS_DECRYPT_FAILED, STATUS_INTEGRITY_FAILED,
                    STATUS_INTERNAL, STATUS_MALFORMED, STATUS_OK, STATUS_REPLAY,
                    STATUS_STALE_TIMESTAMP, STATUS_TOO_LARGE)
from crypto.encryption import decrypt
from crypto.integrity import verify_tag
from crypto.packet import MalformedPacket, decode_plaintext, header_aad, parse_packet, signed_region
from crypto.session import split, unwrap
from server.storage import save_file


def process(raw: bytes, source_ip: str, private_key, replay_cache, logger, now=None):
    current = time.time() if now is None else now
    state = {"message_id": b"\0" * 16, "size_bytes": 0}

    def finish(status: int, reason: str, event_type: str):
        logger.append_event(event_type, state["message_id"].hex(), source_ip,
                            "accepted" if status == STATUS_OK else "rejected",
                            reason, state["size_bytes"])
        return status, state["message_id"], reason

    try:
        return _process(raw, private_key, replay_cache, current, state, finish)
    except Exception:
        return finish(STATUS_INTERNAL, "internal processing error", "INTERNAL_ERROR")


def _process(raw, private_key, replay_cache, current, state, finish):
    try:
        packet = parse_packet(raw)
    except MalformedPacket as exc:
        return finish(STATUS_MALFORMED, str(exc), "MALFORMED_PACKET")

    state["message_id"] = packet.message_id
    try:
        session_key = unwrap(packet.enc_session_key, private_key)
    except Exception:
        return finish(STATUS_INTEGRITY_FAILED, "RSA session-key unwrap failed", "INTEGRITY_VIOLATION")
    try:
        aes_key, hmac_key = split(session_key)
    except ValueError:
        return finish(STATUS_INTEGRITY_FAILED, "invalid session key", "INTEGRITY_VIOLATION")
    if not verify_tag(hmac_key, signed_region(raw), packet.hmac_tag):
        return finish(STATUS_INTEGRITY_FAILED, "HMAC verification failed", "INTEGRITY_VIOLATION")
    if abs(current - packet.timestamp) > REPLAY_WINDOW_SECONDS:
        return finish(STATUS_STALE_TIMESTAMP, "timestamp outside the 60-second window", "STALE_TIMESTAMP")
    if not replay_cache.check_and_add(state["message_id"], current):
        return finish(STATUS_REPLAY, "message ID already processed", "REPLAY_REJECTED")
    try:
        plaintext = decrypt(aes_key, packet.gcm_nonce, packet.ciphertext, header_aad(packet))
        filename, file_bytes = decode_plaintext(plaintext)
    except (InvalidTag, ValueError):
        return finish(STATUS_DECRYPT_FAILED, "GCM decryption or plaintext parsing failed", "DECRYPT_FAILED")
    state["size_bytes"] = len(file_bytes)
    if state["size_bytes"] > MAX_FILE_BYTES:
        return finish(STATUS_TOO_LARGE, "file exceeds 10 MiB limit", "OVERSIZE_REJECTED")
    try:
        save_file(filename, state["message_id"], file_bytes)
    except Exception:
        return finish(STATUS_INTERNAL, "file could not be stored", "INTERNAL_ERROR")
    return finish(STATUS_OK, "accepted", "TRANSFER_ACCEPTED")
