"""RSA key generation, PEM persistence, and public-key fingerprinting."""

import os
from pathlib import Path

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa

from config import RSA_BITS


def generate_rsa_keypair():
    private_key = rsa.generate_private_key(public_exponent=65537, key_size=RSA_BITS)
    return private_key, private_key.public_key()


def save_private(key, path: str | Path, passphrase: str | None = None) -> None:
    password = passphrase.encode("utf-8") if passphrase else None
    encryption = (serialization.BestAvailableEncryption(password) if password
                  else serialization.NoEncryption())
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(key.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8,
        encryption,
    ))
    try:
        os.chmod(target, 0o600)
    except OSError:
        pass


def save_public(key, path: str | Path) -> None:
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(key.public_bytes(
        serialization.Encoding.PEM,
        serialization.PublicFormat.SubjectPublicKeyInfo,
    ))


def load_private(path: str | Path, passphrase: str | None = None):
    password = passphrase.encode("utf-8") if passphrase else None
    return serialization.load_pem_private_key(Path(path).read_bytes(), password=password)


def load_public(path: str | Path):
    return serialization.load_pem_public_key(Path(path).read_bytes())


def fingerprint(public_key) -> str:
    der = public_key.public_bytes(
        serialization.Encoding.DER,
        serialization.PublicFormat.SubjectPublicKeyInfo,
    )
    digest = hashes.Hash(hashes.SHA256())
    digest.update(der)
    return digest.finalize().hex()
