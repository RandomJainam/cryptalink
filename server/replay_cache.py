"""Thread-safe in-memory replay protection."""

import threading

from config import REPLAY_WINDOW_SECONDS


class ReplayCache:
    def __init__(self):
        self._entries: dict[bytes, float] = {}
        self._lock = threading.Lock()

    def check_and_add(self, message_id: bytes, now: float) -> bool:
        with self._lock:
            expired = [key for key, expiry in self._entries.items() if expiry <= now]
            for key in expired:
                del self._entries[key]
            if message_id in self._entries:
                return False
            self._entries[message_id] = now + 2 * REPLAY_WINDOW_SECONDS
            return True
