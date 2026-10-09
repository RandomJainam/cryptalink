"""Safe, non-overwriting storage for decrypted transfers."""

import os
from pathlib import Path
import re

from config import RECEIVED_DIR


def save_file(filename: str, message_id: bytes, data: bytes) -> Path:
    base = os.path.basename(filename.replace("\\", "/"))
    safe = re.sub(r"[^A-Za-z0-9._ -]", "_", base).strip(" .") or "file"
    prefix = message_id.hex()
    max_name_bytes = 255 - len(prefix) - 1
    safe = safe.encode("utf-8")[:max_name_bytes].decode("utf-8", "ignore") or "file"
    directory = Path(RECEIVED_DIR)
    directory.mkdir(parents=True, exist_ok=True)
    target = directory / f"{prefix}_{safe}"
    descriptor = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "wb") as output:
        output.write(data)
    return target
