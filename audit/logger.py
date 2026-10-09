"""Append-only JSONL audit log with a SHA-256 hash chain."""

from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import threading

from config import AUDIT_LOG_PATH


def _canonical(event: dict) -> bytes:
    return json.dumps(event, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


class AuditLogger:
    def __init__(self, path: str | Path = AUDIT_LOG_PATH):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        self._seq = 0
        self._prev_hash = "0" * 64
        if self.path.exists():
            lines = self.path.read_text(encoding="utf-8").splitlines()
            if lines:
                last = json.loads(lines[-1])
                self._seq = int(last["seq"])
                self._prev_hash = last["hash"]

    def append_event(self, event_type: str, message_id: str | None, source_ip: str,
                     result: str, reason: str, size_bytes: int) -> dict:
        with self._lock:
            event = {
                "seq": self._seq + 1,
                "ts": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
                "event_type": event_type,
                "message_id": message_id,
                "source_ip": source_ip,
                "result": result,
                "reason": reason,
                "size_bytes": size_bytes,
                "prev_hash": self._prev_hash,
            }
            event_hash = hashlib.sha256(self._prev_hash.encode("ascii") + _canonical(event)).hexdigest()
            record = {**event, "hash": event_hash}
            with self.path.open("a", encoding="utf-8", newline="\n") as output:
                output.write(json.dumps(record, sort_keys=True, separators=(",", ":"), ensure_ascii=False) + "\n")
            self._seq = record["seq"]
            self._prev_hash = event_hash
            return record

    def read_events(self, limit: int = 50) -> list[dict]:
        if limit < 0:
            raise ValueError("limit must be non-negative")
        if not self.path.exists() or limit == 0:
            return []
        events = [json.loads(line) for line in self.path.read_text(encoding="utf-8").splitlines()]
        return events[-limit:]

    def verify_chain(self) -> tuple[bool, int | None]:
        if not self.path.exists():
            return True, None
        previous = "0" * 64
        expected_seq = 1
        for line_number, line in enumerate(self.path.read_text(encoding="utf-8").splitlines(), 1):
            try:
                record = json.loads(line)
                event = {key: value for key, value in record.items() if key != "hash"}
                actual = hashlib.sha256(previous.encode("ascii") + _canonical(event)).hexdigest()
                if (record.get("seq") != expected_seq or record.get("prev_hash") != previous
                        or record.get("hash") != actual):
                    return False, record.get("seq", line_number)
                previous = record["hash"]
                expected_seq += 1
            except (ValueError, TypeError, KeyError, UnicodeError):
                return False, line_number
        return True, None
