import hashlib

from cryptography.hazmat.primitives import serialization

from crypto.keys import (fingerprint, generate_rsa_keypair, load_private,
                         load_public, save_private, save_public)
from crypto.session import new_session_key, unwrap, wrap


def test_wrap_unwrap_round_trip(tmp_path):
    private, public = generate_rsa_keypair()
    private_path, public_path = tmp_path / "private.pem", tmp_path / "public.pem"
    save_private(private, private_path, "demo-pass")
    save_public(public, public_path)
    loaded_private, loaded_public = load_private(private_path, "demo-pass"), load_public(public_path)
    session_key = new_session_key()
    assert unwrap(wrap(session_key, loaded_public), loaded_private) == session_key


def test_fingerprint_is_sha256_of_der_spki():
    _, public = generate_rsa_keypair()
    der = public.public_bytes(serialization.Encoding.DER,
                              serialization.PublicFormat.SubjectPublicKeyInfo)
    assert fingerprint(public) == hashlib.sha256(der).hexdigest()
