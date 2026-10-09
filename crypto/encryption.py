"""AES-256-GCM encryption and decryption."""

import os

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from config import GCM_NONCE_BYTES


def encrypt(aes_key: bytes, plaintext: bytes, aad: bytes) -> tuple[bytes, bytes]:
    nonce = os.urandom(GCM_NONCE_BYTES)
    return nonce, AESGCM(aes_key).encrypt(nonce, plaintext, aad)


def decrypt(aes_key: bytes, nonce: bytes, ciphertext: bytes, aad: bytes) -> bytes:
    return AESGCM(aes_key).decrypt(nonce, ciphertext, aad)
