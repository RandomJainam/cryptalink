import pytest
import struct

from crypto.packet import (MalformedPacket, Packet, build_packet, decode_plaintext,
                           encode_plaintext, header_aad, parse_packet, signed_region)


def test_packet_round_trip_and_structure_checks():
    packet = Packet(b"i" * 16, 123, b"n" * 12, b"k" * 384, b"c" * 16, b"h" * 32)
    raw = build_packet(packet)
    assert parse_packet(raw) == packet
    assert signed_region(raw) == raw[:-32]
    assert header_aad(packet) == b"CLNK\x01" + packet.message_id + packet.timestamp.to_bytes(8, "big")


@pytest.mark.parametrize("broken", ["truncated", "wrong_magic", "wrong_version",
                                    "wrong_key_length", "ciphertext_length_mismatch"])
def test_packet_rejects_malformed_layouts(broken):
    packet = Packet(b"i" * 16, 123, b"n" * 12, b"k" * 384, b"c" * 16, b"h" * 32)
    raw = bytearray(build_packet(packet))
    if broken == "truncated":
        raw = raw[:-1]
    elif broken == "wrong_magic":
        raw[:4] = b"XXXX"
    elif broken == "wrong_version":
        raw[4] = 2
    elif broken == "wrong_key_length":
        struct.pack_into(">H", raw, 41, 383)
    else:
        struct.pack_into(">Q", raw, 43 + 384, 17)
    with pytest.raises(MalformedPacket):
        parse_packet(bytes(raw))


def test_packet_rejects_oversize():
    with pytest.raises(MalformedPacket):
        parse_packet(b"x" * (10 * 1024 * 1024 + 1000))


def test_filename_over_255_utf8_bytes_rejected():
    with pytest.raises(ValueError):
        encode_plaintext("é" * 128, b"data")


def test_filename_encoding_round_trip_and_invalid_utf8():
    assert decode_plaintext(encode_plaintext("demo.txt", b"data")) == ("demo.txt", b"data")
    with pytest.raises(ValueError):
        decode_plaintext(b"\x00\x01\xff")
