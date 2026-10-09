# CryptaLink: Technical Specification

*Secure file transfer using hybrid cryptography. One-day build spec, written to be handed to Claude/GPT (backend) and Antigravity (web UI).*

## 1. Project summary

CryptaLink is a client-server secure file transfer system with its own binary protocol over TCP. The sender encrypts a file with AES-256-GCM, protects the session key with RSA-OAEP, adds an HMAC-SHA256 integrity layer, and attaches a message ID and timestamp. The server verifies, checks freshness, rejects replays, decrypts, stores the file, and writes a tamper-evident audit log. A small web UI lets you demo normal transfers and two simulated attacks (tampering, replay).

**Core claim for resume and viva:** a custom authenticated protocol over raw TCP with hybrid cryptography, replay protection, and audit logging, validated against simulated attacks.

## 2. Scope

**In scope**

- Hybrid crypto engine (RSA-OAEP, AES-256-GCM, HMAC-SHA256)
- Custom packet format and TCP framing
- Multi-step server verification pipeline
- Timestamp window and replay cache
- Hash-chained JSONL audit log
- CLI client, tamper and replay demo scripts
- Unit and integration tests
- Thin FastAPI gateway and single-page React UI (optional, built last)

**Out of scope (do not build today)**

- User accounts, login, roles
- Key rotation automation, HSMs, certificate authority
- Browser-side encryption (WebCrypto)
- Database, Docker, cloud deployment
- Resumable or chunked transfers

## 3. Tech stack

| Layer | Choice | Why |
| --- | --- | --- |
| Language | Python 3.11+ | Fast to build, strong crypto library |
| Crypto | `cryptography` (pyca) | Audited; RSA-OAEP, AESGCM, HMAC all included |
| Transport | Python `socket` + `socketserver.ThreadingTCPServer` | Real TCP, simple threading, no async complexity |
| Gateway | FastAPI + Uvicorn + python-multipart | Typed schemas, auto docs at /docs |
| Frontend | React + Vite (+ Tailwind optional) | Built by Antigravity against the API contract |
| Storage | Files on disk + JSONL log | No DB needed |
| Testing | pytest | Unit, tamper, replay tests |
| Config | `config.py` + `.env` | Ports, limits, paths in one place |

`requirements.txt`: cryptography, fastapi, uvicorn, python-multipart, pytest, python-dotenv.

## 4. System architecture

There are two entry paths into the same secure core. Path A is the real secure channel. Path B is a demo convenience.

```
PATH A (primary):   CLI client  ──TCP──▶  CryptaLink Server

PATH B (demo UI):   Browser ──HTTP──▶ FastAPI gateway ──TCP──▶ CryptaLink Server
                    (React)           (uses client lib)

 CryptaLink Server
 ┌────────────────────────────────────────────┐
 │ framing → parse → RSA unwrap → HMAC verify │
 │ → timestamp check → replay check           │
 │ → AES-GCM decrypt → store → audit log      │
 └────────────────────────────────────────────┘
```

**Honesty note (put in README):** in Path B the browser sends the file to the local gateway over plain HTTP before encryption, so only the gateway-to-server hop is protected. Path A is the true end-to-end secure channel. The web UI is labelled a demo front-end.

**Processes and ports**

| Process | Port | Command |
| --- | --- | --- |
| CryptaLink TCP server | 9000 | `python -m server.server` |
| FastAPI gateway | 8000 | `uvicorn gateway.main:app --port 8000` |
| React dev server | 5173 | `npm run dev` in frontend/ |

## 5. Security design

| Mechanism | Parameters | Purpose |
| --- | --- | --- |
| RSA-OAEP | 3072-bit key, SHA-256 for OAEP hash and MGF1 | Transport the 64-byte session key |
| AES-256-GCM | 32-byte key, 12-byte random nonce, 16-byte tag | File confidentiality and authenticated encryption |
| HMAC-SHA256 | 32-byte key, constant-time compare | Explicit integrity layer over the whole packet (syllabus requirement) |
| Timestamp | Unix seconds, window of +/- 60 s | Freshness |
| Message ID | 16 random bytes (UUID4) | Replay detection |
| Audit log | JSONL with SHA-256 hash chain | Tamper-evident security record |

**Design note on HMAC:** AES-GCM already authenticates. HMAC is kept as a deliberate second layer that also covers header fields and the encrypted session key. Explain this in the viva as defence in depth plus syllabus coverage.

### Session key

Per transfer, the client generates 64 random bytes with `os.urandom(64)`.

```
AES_KEY  = session_key[:32]
HMAC_KEY = session_key[32:]
```

The 64 bytes are RSA-OAEP encrypted with the server public key. Never reuse a session key or nonce.

### Key management

- Server generates its RSA keypair on first start (`scripts/gen_keys.py`): `keys/server_private.pem`, `keys/server_public.pem`
- Private key stored with file mode 600, optionally encrypted with a passphrase from `.env`
- Client holds only `server_public.pem`
- Public key fingerprint (SHA-256 of DER) is printed on server start and shown in the UI; the user verifies it once (trust on first use)
- `keys/` is gitignored

### AAD and HMAC coverage

- **GCM AAD** = magic + version + message\_id + timestamp (header is authenticated even though it is not encrypted)
- **HMAC input** = every packet byte except the HMAC field itself: header, nonce, encrypted session key, ciphertext+tag

## 6. Wire protocol

### Framing

Every message on the TCP stream is: **4-byte big-endian length** followed by that many bytes. Use a `recv_exact(n)` helper because TCP does not preserve message boundaries. Reject any length above `MAX_PACKET_BYTES` before reading the body.

### Request packet layout (big-endian)

| Field | Size | Notes |
| --- | --- | --- |
| magic | 4 | ASCII `CLNK` |
| version | 1 | `0x01` |
| message\_id | 16 | Random UUID bytes |
| timestamp | 8 | uint64 Unix seconds |
| gcm\_nonce | 12 | Random |
| enc\_key\_len | 2 | uint16 (384 for RSA-3072) |
| enc\_session\_key | variable | RSA-OAEP output |
| ciphertext\_len | 8 | uint64, includes the 16-byte GCM tag |
| ciphertext | variable | AES-GCM output (tag appended) |
| hmac | 32 | HMAC-SHA256 over all preceding bytes |

**Plaintext inside GCM:** `filename_len (2 bytes) + filename (UTF-8) + file bytes`. The filename is therefore encrypted too.

### Response packet

Framing as above. Body: `status (1 byte) + message_id (16 bytes) + reason_len (2) + reason (UTF-8)`.

| Code | Name | Meaning |
| --- | --- | --- |
| 0 | OK | Accepted and stored |
| 1 | MALFORMED | Bad magic, version, or lengths |
| 2 | INTEGRITY\_FAILED | RSA unwrap or HMAC failed (tampering) |
| 3 | STALE\_TIMESTAMP | Outside the freshness window |
| 4 | REPLAY | Message ID already processed |
| 5 | DECRYPT\_FAILED | GCM tag check failed |
| 6 | TOO\_LARGE | Exceeds size limit |
| 7 | INTERNAL | Unexpected server error |

(In a production system you would return one uniform error to avoid acting as an oracle. Distinct codes are kept here so the demo can show what happened.)

## 7. Server verification pipeline

**Order matters.** The HMAC key lives inside the RSA-encrypted session key, so the server must unwrap first.

1. Read frame; enforce size limit (TOO\_LARGE)
2. Parse and validate magic, version, field lengths (MALFORMED)
3. RSA-OAEP decrypt `enc_session_key` (failure becomes INTEGRITY\_FAILED); split into AES\_KEY and HMAC\_KEY
4. Recompute HMAC over the packet; compare with `hmac.compare_digest` (INTEGRITY\_FAILED)
5. Check `abs(now - timestamp) <= 60` (STALE\_TIMESTAMP)
6. Check and insert message\_id in the replay cache (REPLAY). **Only now, after HMAC passes, is the ID recorded**, so attackers cannot poison the cache with junk IDs
7. AES-GCM decrypt with AAD (DECRYPT\_FAILED)
8. Parse filename; sanitize with `os.path.basename`, strip odd characters, prefix with message\_id to avoid overwrites and path traversal
9. Write to `storage/received/`; log; send OK

Every exit path writes an audit event and sends a response.

## 8. Replay protection

- `ReplayCache`: dict of `message_id -> expiry_time`, guarded by a `threading.Lock`
- `check_and_add(message_id, now)` returns False if present; purges expired entries on each call
- Entries live for `2 * REPLAY_WINDOW_SECONDS`, which bounds memory
- Restart weakness: the cache is in memory, but the 60 s timestamp window still limits replay after a restart. Document this.
- **Key viva point:** HMAC does not prevent replay, because a replayed packet carries a perfectly valid HMAC. Freshness plus the cache does.

## 9. Audit log

File: `storage/logs/audit.jsonl`, one JSON object per line, append-only.

Fields: `seq`, `ts` (ISO 8601 UTC), `event_type`, `message_id`, `source_ip`, `result`, `reason`, `size_bytes`, `prev_hash`, `hash`.

Hash chain: `hash = SHA256(prev_hash + canonical entry contents)`. `verify_chain()` walks the file and reports the first broken line. Include a `scripts/verify_log.py` and mention it in the demo.

Event types: SERVER\_START, TRANSFER\_ACCEPTED, INTEGRITY\_VIOLATION, REPLAY\_REJECTED, STALE\_TIMESTAMP, MALFORMED\_PACKET, DECRYPT\_FAILED, OVERSIZE\_REJECTED.

Never log keys, plaintext, or file contents.

## 10. Gateway API contract (freeze this before the UI)

Base URL `http://localhost:8000/api`. CORS allows `http://localhost:5173`. All responses are JSON.

**Common `TransferResult` object**

| Field | Type | Notes |
| --- | --- | --- |
| status | string | `accepted` or `rejected` |
| message\_id | string | Hex |
| filename | string | Original name |
| size\_bytes | number |  |
| reason | string or null | Present when rejected |
| steps | array | Each: `name`, `ok` (bool), `detail` |
| duration\_ms | number |  |

`steps[].name` values in order: `encrypt`, `wrap_key`, `integrity_tag`, `transmit`, `verify_hmac`, `freshness`, `replay_check`, `decrypt`, `store`. On failure, steps after the failing one are `ok: false` with detail `skipped`.

**Endpoints**

| Method | Path | Request | Response |
| --- | --- | --- | --- |
| GET | /status | none | `server_reachable`, `fingerprint`, `algorithms` (list), `replay_window_seconds` |
| POST | /transfer | multipart `file` | TransferResult |
| POST | /simulate/tamper | optional multipart `file` (defaults to a built-in sample) | TransferResult, status always `rejected` |
| POST | /simulate/replay | none (replays the last successful packet) | TransferResult, status `rejected`; HTTP 409 if no previous transfer |
| GET | /logs?limit=50 | none | Array of events: `seq`, `ts`, `event_type`, `message_id`, `result`, `reason`, `source_ip` |
| GET | /logs/verify | none | `chain_valid` (bool), `broken_at_seq` (number or null) |

Errors: HTTP 4xx/5xx with `detail` string. Max upload size 10 MB.

## 11. File structure

```
cryptalink/
├── README.md
├── requirements.txt
├── .gitignore
├── .env.example
├── config.py
│
├── crypto/
│   ├── __init__.py
│   ├── keys.py          # RSA generate/load/save, fingerprint
│   ├── session.py       # session key gen, split, RSA wrap/unwrap
│   ├── encryption.py    # AES-GCM encrypt/decrypt with AAD
│   ├── integrity.py     # HMAC compute/verify
│   └── packet.py        # build_packet, parse_packet, constants
│
├── server/
│   ├── __init__.py
│   ├── server.py        # ThreadingTCPServer, recv_exact, framing
│   ├── pipeline.py      # verification steps, returns status codes
│   ├── replay_cache.py
│   └── storage.py       # safe filename, save file
│
├── client/
│   ├── __init__.py
│   ├── client.py        # send_file(), CLI entry point
│   └── attacks.py       # tamper_packet(), replay helpers
│
├── audit/
│   ├── __init__.py
│   └── logger.py        # append_event, read_events, verify_chain
│
├── gateway/
│   ├── __init__.py
│   ├── main.py          # FastAPI app, CORS, routes
│   ├── schemas.py       # Pydantic models (TransferResult etc.)
│   └── state.py         # last_packet for replay demo
│
├── frontend/            # built by Antigravity
│   ├── package.json
│   ├── vite.config.js
│   ├── .env             # VITE_API_BASE=http://localhost:8000/api
│   └── src/
│       ├── main.jsx
│       ├── App.jsx
│       ├── api.js
│       └── components/
│           ├── FileDropzone.jsx
│           ├── SecurityStatus.jsx
│           ├── TransferSteps.jsx
│           ├── SimulatorButtons.jsx
│           └── EventLog.jsx
│
├── scripts/
│   ├── gen_keys.py
│   ├── verify_log.py
│   └── demo.sh          # runs normal, tamper, replay in sequence
│
├── tests/
│   ├── test_keys.py
│   ├── test_encryption.py
│   ├── test_integrity.py
│   ├── test_packet.py
│   ├── test_replay_cache.py
│   ├── test_tamper.py
│   ├── test_replay.py
│   ├── test_stale.py
│   └── test_integration.py   # starts server in thread, sends file
│
├── docs/
│   ├── architecture.png
│   ├── threat-model.md
│   └── screenshots/
│
├── keys/                # gitignored
└── storage/             # gitignored
    ├── received/
    └── logs/audit.jsonl
```

## 12. Module specifications

**config.py**: `HOST`, `PORT=9000`, `REPLAY_WINDOW_SECONDS=60`, `MAX_FILE_BYTES=10*1024*1024`, `MAX_PACKET_BYTES=MAX_FILE_BYTES+4096`, `RSA_BITS=3072`, key and storage paths, `SOCKET_TIMEOUT=10`.

**crypto/keys.py**: `generate_rsa_keypair() -> (private, public)`; `save_private(key, path, passphrase=None)`; `save_public(key, path)`; `load_private(path, passphrase=None)`; `load_public(path)`; `fingerprint(public_key) -> str`.

**crypto/session.py**: `new_session_key() -> bytes` (64 bytes); `split(session_key) -> (aes_key, hmac_key)`; `wrap(session_key, public_key) -> bytes`; `unwrap(blob, private_key) -> bytes`.

**crypto/encryption.py**: `encrypt(aes_key, plaintext, aad) -> (nonce, ciphertext_with_tag)`; `decrypt(aes_key, nonce, ciphertext, aad) -> bytes` (raises on tag failure).

**crypto/integrity.py**: `compute_hmac(hmac_key, data) -> bytes`; `verify_hmac(hmac_key, data, tag) -> bool` using `hmac.compare_digest`.

**crypto/packet.py**: `@dataclass Packet`; `build_packet(...) -> bytes`; `parse_packet(raw) -> Packet` (validates lengths, raises `MalformedPacket`); `header_aad(packet) -> bytes`; `signed_region(raw) -> bytes` (everything except the last 32 bytes).

**server/pipeline.py**: `process(raw, source_ip, private_key, replay_cache, logger) -> (status_code, message_id, reason)`. Pure function of its inputs so it is easy to unit-test without sockets.

**server/server.py**: handler reads one frame, calls `process`, writes the response frame, closes. Set `socket.settimeout`. Catch all exceptions and return INTERNAL.

**client/client.py**: `send_file(path_or_bytes, filename, host, port, public_key) -> ResponseInfo`; CLI: `python -m client.client send <file>`. Also `build_packet_for(file_bytes, filename, public_key) -> bytes` so the gateway and attack helpers can reuse it.

**client/attacks.py**: `tamper_packet(raw, offset=None) -> bytes` flips one byte inside the ciphertext region; `send_raw(raw, host, port)` sends an arbitrary packet.

**audit/logger.py**: `append_event(...)`; `read_events(limit)`; `verify_chain() -> (bool, broken_seq)`. Use a lock around writes.

## 13. Configuration and environment

`.env.example`: `CRYPTALINK_HOST=127.0.0.1`, `CRYPTALINK_PORT=9000`, `KEY_PASSPHRASE=` (optional), `REPLAY_WINDOW_SECONDS=60`.

`.gitignore`: `keys/`, `storage/`, `.env`, `__pycache__/`, `node_modules/`, `frontend/dist/`.

Bind the server to `127.0.0.1` by default. Mention that for a two-machine demo you set the host to the LAN IP.

## 14. Testing plan

| Test | Expectation |
| --- | --- |
| RSA wrap/unwrap round trip | Same 64 bytes returned |
| AES-GCM round trip | Plaintext recovered; wrong AAD fails |
| HMAC | Valid passes; one flipped bit fails |
| Packet build/parse | Round trip identical; truncated packet raises MalformedPacket |
| Tamper (flip one ciphertext byte) | Status 2 INTEGRITY\_FAILED, nothing saved |
| Tamper (flip timestamp byte) | Status 2 |
| Tamper (flip enc\_session\_key byte) | Status 2 |
| Replay (send same packet twice) | First 0, second 4 |
| Stale (timestamp 5 minutes old, valid HMAC) | Status 3 |
| Oversize | Status 6 |
| Path traversal filename (`../../x`) | Saved safely inside `storage/received/` |
| Junk IDs before valid packet | Cache not polluted (IDs recorded only after HMAC) |
| Integration | Server in thread; client sends file; bytes identical on disk |
| Audit chain | Edit one line in the log; `verify_chain` reports the break |

Target: all tests green before any UI work starts.

## 15. Demo script (for viva and screenshots)

1. Start server; show fingerprint and SERVER\_START log line
2. Send a file: status OK, file appears in `storage/received/`
3. Tamper demo: status INTEGRITY\_FAILED, no file written, log shows INTEGRITY\_VIOLATION
4. Replay demo: first send OK, resend same bytes gives REPLAY
5. Stale demo: old timestamp gives STALE\_TIMESTAMP
6. Edit a log line by hand; run `verify_log.py` and show the chain break
7. (Optional) Wireshark on loopback port 9000 to show the payload is unreadable

Capture a screenshot of each step for the README.

## 16. Threat model

| Threat | Attacker action | Defence | Residual risk |
| --- | --- | --- | --- |
| Eavesdropping | Sniffs TCP traffic | AES-256-GCM, RSA-wrapped key | Traffic size and timing visible |
| Tampering | Modifies packet in transit | HMAC plus GCM tag | None for covered fields |
| Replay | Resends a captured valid packet | Timestamp window plus message-ID cache | Cache lost on restart (window still applies) |
| Cache poisoning | Floods fake message IDs | ID recorded only after HMAC passes | Resource exhaustion by volume |
| Path traversal | Malicious filename | basename, sanitization, ID prefix | None expected |
| Oversized upload / DoS | Huge length field | Length checks before read, socket timeout | No rate limiting |
| Log tampering | Edits audit log | SHA-256 hash chain | Attacker with disk access can rewrite the whole chain |
| Man-in-the-middle key swap | Substitutes public key | Fingerprint check (TOFU) | Relies on user verifying fingerprint |
| Client impersonation | Anyone with the public key can send | **Not addressed** | Add RSA signatures or client certificates as future work |

## 17. Build plan with ownership

| Hours | Task | Owner |
| --- | --- | --- |
| 0-1 | Repo, venv, config, key generation, tests for keys | Claude/GPT |
| 1-3 | session, encryption, integrity, packet modules with unit tests | Claude/GPT |
| 3-4.5 | pipeline, replay cache, audit logger, TCP server and client | Claude/GPT |
| 4.5-6 | tamper, replay, stale, integration tests; demo script | Claude/GPT |
| 6-7 | FastAPI gateway to the frozen contract | Claude/GPT |
| 6-8 | React UI against a mock, then real gateway | Antigravity |
| 8-9 | README, diagram, threat model, screenshots | You |

**Cut order if you run late:** drop the UI first, then the hash chain, then the stale test. Never cut tamper and replay demos.

## 18. Hand-off briefs

**For the backend AI:** Build the project exactly per this spec. Work module by module, writing tests for each before moving on. Do not add features beyond section 2. Use the `cryptography` library only; no custom crypto. Follow the verification order in section 7 exactly. Explain each module briefly so the developer can answer viva questions.

**For Antigravity (UI only):** Build a single-page React + Vite app that consumes the API contract in section 10 and nothing else. Read the base URL from `VITE_API_BASE`. Components: file dropzone with Secure Send button; security status panel (fingerprint, algorithms, server reachable); step-by-step transfer progress rendered from `steps`; two buttons, Simulate Tampering and Replay Last Packet; event log table polling `/logs` every 2 seconds, with rejected events highlighted in red; a Verify Log Integrity button. Clean dark technical style. No authentication, routing, or extra pages. Build against a mock first (a static JSON fixture or msw), then switch to the real gateway.

## 19. README outline and resume

**README sections:** overview; architecture diagram; security mechanisms table; packet format; verification order; threat model summary; setup and run commands; demo walkthrough with screenshots; test results; limitations; future work.

**Resume bullet (primary):**

> Built CryptaLink, a secure client-server file transfer system over a custom TCP protocol, combining RSA-OAEP key transport, AES-256-GCM encryption and HMAC-SHA256 integrity verification; implemented timestamp and message-ID replay protection and a hash-chained audit log, and validated against simulated tampering, replay and stale-packet attacks with an automated test suite.

**Secondary bullet (if UI is done):**

> Exposed the transfer engine through a FastAPI gateway and React dashboard showing per-step verification results and live security events.

**Skills line:** Python, cryptography (RSA, AES-GCM, HMAC, SHA-256), TCP sockets, FastAPI, React, pytest, threat modelling, audit logging.

## 20. Likely viva questions

- **Why hybrid encryption?** RSA is slow and size-limited; AES handles bulk data, RSA only protects the key.
- **Why not RSA the whole file?** Size limit of OAEP and performance.
- **GCM already authenticates, why HMAC?** Defence in depth; HMAC also covers the encrypted session key and header; syllabus coverage.
- **Why unwrap the RSA key before checking HMAC?** The HMAC key is inside the wrapped session key.
- **Does HMAC stop replay?** No. A replayed packet has a valid HMAC; freshness and the ID cache stop it.
- **Why record the message ID only after HMAC passes?** Prevents cache poisoning.
- **Why a 12-byte random nonce?** GCM standard size; with a fresh key per transfer, nonce reuse risk is negligible.
- **What if the server restarts?** Cache is empty, but the 60 s window still bounds replay.
- **What does the server not verify?** Who the sender is. Anyone with the public key can send; signatures or client certificates are future work.
- **Why a hash chain on logs?** Edits or deletions break the chain and are detectable.
- **Which syllabus topics does it cover?** RSA, AES and GCM mode, SHA-256, HMAC, key management, authentication and integrity concepts, TCP networking, security monitoring.

## 21. Known limitations (state these honestly)

- No sender authentication
- Web UI path exposes plaintext to the local gateway
- Replay cache is in memory
- No rate limiting or connection throttling
- Single-server, single-key design with no rotation automation
- Whole file is held in memory, hence the 10 MB limit

Stating limitations clearly reads as security maturity, not weakness.
