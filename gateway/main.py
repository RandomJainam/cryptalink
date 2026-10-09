"""Synchronous FastAPI gateway that forwards transfers over the TCP client."""

import socket
import time

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from audit.logger import AuditLogger
from client.attacks import send_raw, tamper_packet
from client.client import build_packet_for
from config import (HOST, MAX_FILE_BYTES, PORT, PUBLIC_KEY_PATH, REPLAY_WINDOW_SECONDS,
                    STATUS_DECRYPT_FAILED, STATUS_INTEGRITY_FAILED, STATUS_MALFORMED,
                    STATUS_OK, STATUS_REPLAY, STATUS_STALE_TIMESTAMP, STATUS_TOO_LARGE)
from crypto.keys import fingerprint, load_public
from gateway.schemas import (LogEvent, LogVerification, StatusResult,
                             TransferResult, TransferStep)
from gateway.state import get_last_successful, set_last_successful


app = FastAPI(title="CryptaLink Gateway", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

_SERVER_STEPS = ["verify_hmac", "freshness", "replay_check", "decrypt", "store"]


def _steps(client_progress: list[str], status_code: int, reason: str | None) -> list[TransferStep]:
    details = {
        "encrypt": "AES-256-GCM encrypted the file",
        "wrap_key": "RSA-OAEP wrapped the session secret",
        "integrity_tag": "HMAC-SHA256 computed over the signed packet region",
        "transmit": "framed request sent over TCP",
    }
    steps = [TransferStep(name=name, ok=name in client_progress,
                          detail=details[name] if name in client_progress else "skipped")
             for name in ("encrypt", "wrap_key", "integrity_tag", "transmit")]
    state = {name: (False, "skipped: server-side result not reached") for name in _SERVER_STEPS}
    if status_code == STATUS_OK:
        state = {name: (True, "server check passed") for name in _SERVER_STEPS}
    elif status_code == STATUS_INTEGRITY_FAILED:
        state["verify_hmac"] = (False, reason or "integrity verification failed")
    elif status_code == STATUS_STALE_TIMESTAMP:
        state["verify_hmac"] = (True, "HMAC verified")
        state["freshness"] = (False, reason or "timestamp was stale")
    elif status_code == STATUS_REPLAY:
        state["verify_hmac"] = (True, "HMAC verified")
        state["freshness"] = (True, "timestamp is fresh")
        state["replay_check"] = (False, reason or "message ID was already seen")
    elif status_code == STATUS_DECRYPT_FAILED:
        state["verify_hmac"] = (True, "HMAC verified")
        state["freshness"] = (True, "timestamp is fresh")
        state["replay_check"] = (True, "message ID is new")
        state["decrypt"] = (False, reason or "decryption failed")
    elif status_code in (STATUS_MALFORMED, STATUS_TOO_LARGE):
        detail = reason or "packet rejected before verification"
        state = {name: (False, detail if name == "verify_hmac" else "skipped")
                 for name in _SERVER_STEPS}
    for name in _SERVER_STEPS:
        ok, detail = state[name]
        steps.append(TransferStep(name=name, ok=ok, detail=detail))
    return steps


def _transfer_result(filename: str, size_bytes: int, response: dict,
                     progress: list[str], started: float, status_override: str | None = None):
    status_code = response["status_code"]
    success = status_code == STATUS_OK
    return TransferResult(
        status=status_override or ("accepted" if success else "rejected"),
        message_id=response["message_id"],
        filename=filename,
        size_bytes=size_bytes,
        reason=None if success else response["reason"],
        steps=_steps(progress, status_code, response["reason"]),
        duration_ms=round((time.perf_counter() - started) * 1000, 3),
    )


def _read_upload(upload: UploadFile | None):
    if upload is None:
        return b"CryptaLink tamper demonstration sample", "sample.txt"
    content = upload.file.read(MAX_FILE_BYTES + 1)
    if len(content) > MAX_FILE_BYTES:
        raise HTTPException(status_code=413, detail="Upload exceeds the 10 MiB limit")
    return content, upload.filename or "upload.bin"


def _run_transfer(content: bytes, filename: str, tamper=False, replay=False):
    started = time.perf_counter()
    progress: list[str] = []
    saved = None
    try:
        if replay:
            saved = get_last_successful()
            if saved is None:
                raise HTTPException(status_code=409, detail="No successful transfer is available to replay")
            raw = saved["raw"]
            filename = saved["filename"]
            content_size = saved["size_bytes"]
        else:
            public_key = load_public(PUBLIC_KEY_PATH)
            raw = build_packet_for(content, filename, public_key, progress=progress)
            content_size = len(content)
            if tamper:
                raw = tamper_packet(raw)
        response = send_raw(raw, HOST, PORT, progress=progress)
    except HTTPException:
        raise
    except (OSError, ConnectionError, TimeoutError) as exc:
        raise HTTPException(status_code=503, detail=f"TCP server unavailable at {HOST}:{PORT}") from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not replay and not tamper and response["status_code"] == STATUS_OK:
        set_last_successful({"raw": raw, "filename": filename, "size_bytes": content_size})
    if replay:
        filename = saved["filename"]
        content_size = saved["size_bytes"]
    return _transfer_result(filename, content_size, response, progress, started,
                            status_override="rejected" if tamper or replay else None)


@app.get("/api/status", response_model=StatusResult)
def status():
    try:
        with socket.create_connection((HOST, PORT), timeout=0.5):
            reachable = True
    except OSError:
        reachable = False
    public_fingerprint = None
    if PUBLIC_KEY_PATH.exists():
        public_fingerprint = fingerprint(load_public(PUBLIC_KEY_PATH))
    return StatusResult(
        server_reachable=reachable,
        fingerprint=public_fingerprint,
        algorithms=["RSA-3072 OAEP-SHA256", "AES-256-GCM", "HMAC-SHA256"],
        replay_window_seconds=REPLAY_WINDOW_SECONDS,
    )


@app.post("/api/transfer", response_model=TransferResult)
def transfer(file: UploadFile = File(...)):
    content, filename = _read_upload(file)
    return _run_transfer(content, filename)


@app.post("/api/simulate/tamper", response_model=TransferResult)
def simulate_tamper(file: UploadFile | None = File(default=None)):
    content, filename = _read_upload(file)
    return _run_transfer(content, filename, tamper=True, replay=False)


@app.post("/api/simulate/replay", response_model=TransferResult)
def simulate_replay():
    return _run_transfer(b"", "", replay=True)


@app.get("/api/logs", response_model=list[LogEvent])
def logs(limit: int = 50):
    try:
        events = AuditLogger().read_events(limit)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return [{key: event.get(key) for key in ("seq", "ts", "event_type", "message_id",
                                               "result", "reason", "source_ip")} for event in events]


@app.get("/api/logs/verify", response_model=LogVerification)
def verify_logs():
    valid, broken_seq = AuditLogger().verify_chain()
    return LogVerification(chain_valid=valid, broken_at_seq=broken_seq)
