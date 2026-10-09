"""In-memory state for replaying the last successful gateway transfer."""

import threading

_lock = threading.Lock()
_last_successful: dict | None = None


def set_last_successful(value: dict) -> None:
    global _last_successful
    with _lock:
        _last_successful = value.copy()


def get_last_successful() -> dict | None:
    with _lock:
        return _last_successful.copy() if _last_successful is not None else None
