"""Binary CryptaLink request packet encoding."""

from dataclasses import dataclass
import struct
import uuid

from config import (GCM_NONCE_BYTES, GCM_TAG_BYTES, MAX_PACKET_BYTES,
                    MAX_FILENAME_BYTES, MESSAGE_ID_BYTES, PROTOCOL_MAGIC,
                    PROTOCOL_VERSION, RSA_KEY_BYTES)

_HEADER = struct.Struct(">4sB16sQ12sH")
_U64 = struct.Struct(">Q")


class MalformedPacket(ValueError):
    pass


@dataclass(frozen=True)
class Packet:
    message_id: bytes
    timestamp: int
    gcm_nonce: bytes
    enc_session_key: bytes
    ciphertext: bytes
    hmac_tag: bytes


def header_aad(packet: Packet) -> bytes:
    if len(packet.message_id) != MESSAGE_ID_BYTES or not 0 <= packet.timestamp < 2**64:
        raise ValueError("invalid message ID or timestamp")
    return PROTOCOL_MAGIC + bytes([PROTOCOL_VERSION]) + packet.message_id + struct.pack(">Q", packet.timestamp)


def signed_region(raw: bytes) -> bytes:
    if len(raw) < 32:
        raise ValueError("packet is shorter than its HMAC")
    return raw[:-32]


def build_packet(packet: Packet) -> bytes:
    if (len(packet.message_id) != MESSAGE_ID_BYTES or len(packet.gcm_nonce) != GCM_NONCE_BYTES
            or len(packet.enc_session_key) != RSA_KEY_BYTES or len(packet.ciphertext) < GCM_TAG_BYTES
            or len(packet.hmac_tag) != 32 or len(packet.enc_session_key) >= 2**16):
        raise ValueError("invalid packet field length")
    if len(packet.ciphertext) + len(packet.enc_session_key) + _HEADER.size + 8 + 32 > MAX_PACKET_BYTES:
        raise ValueError("packet exceeds maximum size")
    region = (_HEADER.pack(PROTOCOL_MAGIC, PROTOCOL_VERSION, packet.message_id,
                           packet.timestamp, packet.gcm_nonce, len(packet.enc_session_key))
              + packet.enc_session_key + _U64.pack(len(packet.ciphertext)) + packet.ciphertext)
    return region + packet.hmac_tag


def parse_packet(raw: bytes) -> Packet:
    if len(raw) > MAX_PACKET_BYTES or len(raw) < _HEADER.size + 2 + 8 + GCM_TAG_BYTES + 32:
        raise MalformedPacket("invalid packet size")
    magic, version, message_id, timestamp, nonce, key_len = _HEADER.unpack_from(raw)
    if magic != PROTOCOL_MAGIC:
        raise MalformedPacket("invalid packet magic")
    if version != PROTOCOL_VERSION:
        raise MalformedPacket("unsupported packet version")
    if key_len != RSA_KEY_BYTES:
        raise MalformedPacket("invalid encrypted key length")
    offset = _HEADER.size
    if offset + key_len + 8 > len(raw):
        raise MalformedPacket("truncated packet")
    wrapped = raw[offset:offset + key_len]
    offset += key_len
    cipher_len = _U64.unpack_from(raw, offset)[0]
    offset += 8
    if cipher_len < GCM_TAG_BYTES or cipher_len > MAX_PACKET_BYTES or offset + cipher_len + 32 != len(raw):
        raise MalformedPacket("invalid ciphertext length")
    return Packet(message_id, timestamp, nonce, wrapped,
                  raw[offset:offset + cipher_len], raw[-32:])


def new_message_id() -> bytes:
    return uuid.uuid4().bytes


def encode_plaintext(filename: str, file_bytes: bytes) -> bytes:
    encoded = filename.encode("utf-8")
    if len(encoded) > MAX_FILENAME_BYTES:
        raise ValueError("filename exceeds 255 UTF-8 bytes")
    return struct.pack(">H", len(encoded)) + encoded + file_bytes


def decode_plaintext(plaintext: bytes) -> tuple[str, bytes]:
    if len(plaintext) < 2:
        raise ValueError("truncated plaintext")
    name_len = struct.unpack_from(">H", plaintext)[0]
    if name_len > MAX_FILENAME_BYTES or len(plaintext) < 2 + name_len:
        raise ValueError("invalid filename length")
    try:
        name = plaintext[2:2 + name_len].decode("utf-8")
    except UnicodeDecodeError as exc:
        raise ValueError("filename is not UTF-8") from exc
    return name, plaintext[2 + name_len:]
