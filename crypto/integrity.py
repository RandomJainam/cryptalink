"""HMAC-SHA256 integrity tags."""

import hashlib
import hmac


def make_tag(key: bytes, data: bytes) -> bytes:
    return hmac.new(key, data, hashlib.sha256).digest()


def verify_tag(key: bytes, data: bytes, tag: bytes) -> bool:
    return hmac.compare_digest(make_tag(key, data), tag)
