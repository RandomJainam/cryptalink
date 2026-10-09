"""Pydantic response models for the frozen gateway API."""

from pydantic import BaseModel


class TransferStep(BaseModel):
    name: str
    ok: bool
    detail: str


class TransferResult(BaseModel):
    status: str
    message_id: str
    filename: str
    size_bytes: int
    reason: str | None
    steps: list[TransferStep]
    duration_ms: float


class StatusResult(BaseModel):
    server_reachable: bool
    fingerprint: str | None
    algorithms: list[str]
    replay_window_seconds: int


class LogEvent(BaseModel):
    seq: int
    ts: str
    event_type: str
    message_id: str | None
    result: str
    reason: str
    source_ip: str


class LogVerification(BaseModel):
    chain_valid: bool
    broken_at_seq: int | None
