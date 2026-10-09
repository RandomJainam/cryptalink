import pytest
from cryptography.exceptions import InvalidTag

from crypto.encryption import decrypt, encrypt
from crypto.session import new_session_key, split


def test_aes_gcm_round_trip():
    aes_key, _ = split(new_session_key())
    nonce, encrypted = encrypt(aes_key, b"payload", b"aad")
    assert decrypt(aes_key, nonce, encrypted, b"aad") == b"payload"


def test_aes_gcm_rejects_wrong_aad():
    aes_key, _ = split(new_session_key())
    nonce, encrypted = encrypt(aes_key, b"payload", b"aad")
    with pytest.raises(InvalidTag):
        decrypt(aes_key, nonce, encrypted, b"wrong")


def test_aes_gcm_rejects_modified_ciphertext():
    aes_key, _ = split(new_session_key())
    nonce, encrypted = encrypt(aes_key, b"payload", b"aad")
    altered = encrypted[:-1] + bytes([encrypted[-1] ^ 1])
    with pytest.raises(InvalidTag):
        decrypt(aes_key, nonce, altered, b"aad")
