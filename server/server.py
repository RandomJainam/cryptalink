"""One-request-per-connection TCP server."""

import os
import socket
import threading

from config import (HOST, MAX_PACKET_BYTES, PORT, PRIVATE_KEY_PATH, PUBLIC_KEY_PATH,
                    SOCKET_TIMEOUT, STATUS_INTERNAL, STATUS_MALFORMED,
                    STATUS_TOO_LARGE)
from audit.logger import AuditLogger
from crypto.keys import (fingerprint, generate_rsa_keypair, load_private,
                         save_private, save_public)
from server.pipeline import process
from server.replay_cache import ReplayCache


def recv_exact(connection: socket.socket, size: int) -> bytes:
    chunks = bytearray()
    while len(chunks) < size:
        part = connection.recv(size - len(chunks))
        if not part:
            raise EOFError("connection closed before frame was complete")
        chunks.extend(part)
    return bytes(chunks)


def _send_response(connection, status, message_id, reason):
    encoded = reason.encode("utf-8")[:65535]
    body = bytes([status]) + message_id[:16].ljust(16, b"\0") + len(encoded).to_bytes(2, "big") + encoded
    connection.sendall(len(body).to_bytes(4, "big") + body)


def _handle_connection(connection, address, private_key, replay_cache, logger):
    source_ip = address[0]
    message_id = b"\0" * 16
    try:
        connection.settimeout(SOCKET_TIMEOUT)
        frame_length = int.from_bytes(recv_exact(connection, 4), "big")
        if frame_length > MAX_PACKET_BYTES:
            logger.append_event("OVERSIZE_REJECTED", message_id.hex(), source_ip,
                                "rejected", "packet exceeds maximum size", 0)
            _send_response(connection, STATUS_TOO_LARGE, message_id, "packet exceeds maximum size")
            return
        raw = recv_exact(connection, frame_length)
        status, message_id, reason = process(raw, source_ip, private_key, replay_cache, logger)
        _send_response(connection, status, message_id, reason)
    except EOFError as exc:
        logger.append_event("MALFORMED_PACKET", message_id.hex(), source_ip,
                            "rejected", str(exc), 0)
        try:
            _send_response(connection, STATUS_MALFORMED, message_id, "incomplete request frame")
        except OSError:
            pass
    except Exception:
        logger.append_event("INTERNAL_ERROR", message_id.hex(), source_ip,
                            "rejected", "internal server error", 0)
        try:
            _send_response(connection, STATUS_INTERNAL, message_id, "internal server error")
        except OSError:
            pass


def _load_or_create_private_key():
    passphrase = os.getenv("KEY_PASSPHRASE") or None
    if PRIVATE_KEY_PATH.exists() and PUBLIC_KEY_PATH.exists():
        return load_private(PRIVATE_KEY_PATH, passphrase)
    private_key, public_key = generate_rsa_keypair()
    save_private(private_key, PRIVATE_KEY_PATH, passphrase)
    save_public(public_key, PUBLIC_KEY_PATH)
    return private_key


def serve_forever(host=HOST, port=PORT, private_key=None, replay_cache=None,
                  logger=None, stop_event=None):
    private_key = private_key or _load_or_create_private_key()
    replay_cache = replay_cache or ReplayCache()
    logger = logger or AuditLogger()
    stopping = stop_event or threading.Event()
    listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    listener.bind((host, port))
    listener.listen()
    listener.settimeout(0.5)
    try:
        while not stopping.is_set():
            try:
                connection, address = listener.accept()
            except socket.timeout:
                continue
            threading.Thread(target=_handle_connection,
                             args=(connection, address, private_key, replay_cache, logger),
                             daemon=True).start()
    finally:
        listener.close()


def main():
    private_key = _load_or_create_private_key()
    public_key = private_key.public_key()
    logger = AuditLogger()
    logger.append_event("SERVER_START", None, HOST, "accepted", "server started", 0)
    print(f"CryptaLink listening on {HOST}:{PORT}")
    print(f"Server public-key SHA-256 fingerprint: {fingerprint(public_key)}")
    try:
        serve_forever(private_key=private_key, logger=logger)
    except KeyboardInterrupt:
        print("Server stopped")


if __name__ == "__main__":
    main()
