"""Generate the CryptaLink server RSA keypair."""

import os
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from config import PRIVATE_KEY_PATH, PUBLIC_KEY_PATH
from crypto.keys import fingerprint, generate_rsa_keypair, save_private, save_public


def main():
    private_key, public_key = generate_rsa_keypair()
    passphrase = os.getenv("KEY_PASSPHRASE") or None
    save_private(private_key, PRIVATE_KEY_PATH, passphrase)
    save_public(public_key, PUBLIC_KEY_PATH)
    print(f"Generated keypair. SHA-256 fingerprint: {fingerprint(public_key)}")


if __name__ == "__main__":
    main()
