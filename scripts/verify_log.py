"""Verify the local audit log hash chain."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from audit.logger import AuditLogger


def main():
    valid, broken_seq = AuditLogger().verify_chain()
    if valid:
        print("Audit log chain: valid")
        return 0
    print(f"Audit log chain: BROKEN at sequence {broken_seq}")
    return 1


if __name__ == "__main__":
    sys.exit(main())
