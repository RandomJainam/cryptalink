"""Per-transfer session secrets and RSA-OAEP key transport."""

import os

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import padding

from config import AES_KEY_BYTES, SESSION_SECRET_BYTES


def new_session_key() -> bytes:
    return os.urandom(SESSION_SECRET_BYTES)


def split(session_key: bytes) -> tuple[bytes, bytes]:
    if len(session_key) != SESSION_SECRET_BYTES:
        raise ValueError("session secret must be 64 bytes")
    return session_key[:AES_KEY_BYTES], session_key[AES_KEY_BYTES:]


def wrap(session_key: bytes, public_key) -> bytes:
    return public_key.encrypt(
        session_key,
        padding.OAEP(mgf=padding.MGF1(algorithm=hashes.SHA256()),
                    algorithm=hashes.SHA256(), label=None),
    )


def unwrap(blob: bytes, private_key) -> bytes:
    return private_key.decrypt(
        blob,
        padding.OAEP(mgf=padding.MGF1(algorithm=hashes.SHA256()),
                    algorithm=hashes.SHA256(), label=None),
    )
