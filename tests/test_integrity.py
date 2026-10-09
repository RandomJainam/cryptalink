from crypto.integrity import make_tag, verify_tag


def test_hmac_valid_and_one_flipped_bit_rejected():
    tag = make_tag(b"k" * 32, b"packet")
    assert verify_tag(b"k" * 32, b"packet", tag)
    changed = bytes([tag[0] ^ 1]) + tag[1:]
    assert not verify_tag(b"k" * 32, b"packet", changed)
