"""Tamper, replay, and stale-packet demo helpers."""

import argparse
from pathlib import Path
import socket
import sys
import time

from config import HOST, PORT, PUBLIC_KEY_PATH, STATUS_INTEGRITY_FAILED, STATUS_OK, STATUS_REPLAY, STATUS_STALE_TIMESTAMP
from crypto.keys import load_public
from crypto.packet import parse_packet


def tamper_packet(raw: bytes, offset=None) -> bytes:
    packet = parse_packet(raw)
    start = 4 + 1 + 16 + 8 + 12 + 2 + len(packet.enc_session_key) + 8
    position = 0 if offset is None else offset
    if not 0 <= position < len(packet.ciphertext):
        raise ValueError("tamper offset must point inside the ciphertext")
    changed = bytearray(raw)
    changed[start + position] ^= 1
    return bytes(changed)


def _recv_exact(connection, size):
    result = bytearray()
    while len(result) < size:
        part = connection.recv(size - len(result))
        if not part:
            raise ConnectionError("server closed before response was complete")
        result.extend(part)
    return bytes(result)


def send_raw(raw: bytes, host=HOST, port=PORT, progress=None) -> dict:
    with socket.create_connection((host, port), timeout=10) as connection:
        connection.sendall(len(raw).to_bytes(4, "big") + raw)
        if progress is not None:
            progress.append("transmit")
        response_length = int.from_bytes(_recv_exact(connection, 4), "big")
        body = _recv_exact(connection, response_length)
    if len(body) < 19:
        raise ValueError("malformed server response")
    reason_length = int.from_bytes(body[17:19], "big")
    if len(body) != 19 + reason_length:
        raise ValueError("malformed server response length")
    return {
        "status_code": body[0],
        "message_id": body[1:17].hex(),
        "reason": body[19:].decode("utf-8"),
    }


def _show(label, result):
    print(f"{label}: status={result['status_code']} message_id={result['message_id']} reason={result['reason']}")


def main(argv=None):
    parser = argparse.ArgumentParser(prog="python -m client.attacks")
    subparsers = parser.add_subparsers(dest="command", required=True)
    demo_parser = subparsers.add_parser("demo")
    demo_parser.add_argument("file")
    args = parser.parse_args(argv)
    if args.command != "demo":
        return 2

    path = Path(args.file)
    content = path.read_bytes()
    from client.client import build_packet_for

    public_key = load_public(PUBLIC_KEY_PATH)
    raw = build_packet_for(content, path.name, public_key)
    normal = send_raw(raw, HOST, PORT)
    _show("normal", normal)
    tampered = send_raw(tamper_packet(raw), HOST, PORT)
    _show("tamper", tampered)
    replayed = send_raw(raw, HOST, PORT)
    _show("replay", replayed)
    stale_packet = build_packet_for(content, path.name, public_key, timestamp=int(time.time()) - 61)
    stale = send_raw(stale_packet, HOST, PORT)
    _show("stale", stale)
    return 0 if [normal["status_code"], tampered["status_code"], replayed["status_code"], stale["status_code"]] == [
        STATUS_OK, STATUS_INTEGRITY_FAILED, STATUS_REPLAY, STATUS_STALE_TIMESTAMP] else 1


if __name__ == "__main__":
    sys.exit(main())
