"""CryptaLink transfer client and CLI."""

import argparse
from pathlib import Path
import sys
import time

from config import (HOST, MAX_FILE_BYTES, PORT, PUBLIC_KEY_PATH, STATUS_OK)
from client.attacks import _recv_exact, send_raw
from crypto.encryption import encrypt
from crypto.integrity import make_tag
from crypto.keys import load_public
from crypto.packet import (Packet, build_packet, encode_plaintext, header_aad,
                           new_message_id, signed_region)
from crypto.session import new_session_key, split, wrap


def build_packet_for(file_bytes: bytes, filename: str, public_key, timestamp=None, progress=None) -> bytes:
    if len(file_bytes) > MAX_FILE_BYTES:
        raise ValueError("file exceeds 10 MiB limit")
    plaintext = encode_plaintext(filename, file_bytes)
    message_id = new_message_id()
    timestamp = int(time.time()) if timestamp is None else timestamp
    session_key = new_session_key()
    aes_key, hmac_key = split(session_key)
    placeholder = Packet(message_id, timestamp, b"\0" * 12, b"", b"", b"")
    nonce, ciphertext = encrypt(aes_key, plaintext, header_aad(placeholder))
    if progress is not None:
        progress.append("encrypt")
    wrapped = wrap(session_key, public_key)
    if progress is not None:
        progress.append("wrap_key")
    unsigned = Packet(message_id, timestamp, nonce, wrapped, ciphertext, b"\0" * 32)
    tag = make_tag(hmac_key, signed_region(build_packet(unsigned)))
    if progress is not None:
        progress.append("integrity_tag")
    return build_packet(Packet(message_id, timestamp, nonce, wrapped, ciphertext, tag))


def send_file(path_or_bytes, filename, host, port, public_key) -> dict:
    if isinstance(path_or_bytes, (str, Path)):
        path = Path(path_or_bytes)
        filename = filename or path.name
        file_bytes = path.read_bytes()
    else:
        file_bytes = bytes(path_or_bytes)
    return send_raw(build_packet_for(file_bytes, filename, public_key), host, port)


def main(argv=None):
    parser = argparse.ArgumentParser(prog="python -m client.client")
    subparsers = parser.add_subparsers(dest="command", required=True)
    send_parser = subparsers.add_parser("send")
    send_parser.add_argument("file")
    args = parser.parse_args(argv)
    if args.command == "send":
        path = Path(args.file)
        result = send_file(path, path.name, HOST, PORT, load_public(PUBLIC_KEY_PATH))
        print(f"status={result['status_code']} message_id={result['message_id']} reason={result['reason']}")
        return 0 if result["status_code"] == STATUS_OK else 1
    return 2


if __name__ == "__main__":
    sys.exit(main())
