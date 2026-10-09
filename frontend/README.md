# CryptaLink Frontend Dashboard

Secure file transfer educational demo dashboard for college cybersecurity projects. It visualizes the pipeline of cryptographic operations and attack simulations (tampering and replay attacks) based directly on protocol verification data.

---

## Windows Commands

### 1. Install Dependencies
```powershell
npm install
```
*(If PowerShell restricts scripts, run `npm.cmd install`)*

### 2. Configure Environment
Copy `.env.example` to `.env`:
```powershell
Copy-Item .env.example .env
```

### 3. Run in Mock Mode (Default)
In `.env`:
```ini
VITE_API_BASE=http://localhost:8000/api
VITE_USE_MOCK=true
```
Start the development server:
```powershell
npm.cmd run dev
```
Open [http://localhost:5173](http://localhost:5173). The dashboard displays a `MOCK DATA` badge and simulates responses with realistic delays (600–1200ms) for success, tampering, replay attacks, and stale timestamps.

### 4. Run Against Real Gateway
Once the Python backend is running:
In `.env`:
```ini
VITE_API_BASE=http://localhost:8000/api
VITE_USE_MOCK=false
```
Then start the development server:
```powershell
npm.cmd run dev
```

### 5. Production Build
```powershell
npm.cmd run build
```
Preview the built application:
```powershell
npm.cmd run preview
```

---

## How the Animation Maps to the Protocol

The transfer pipeline consists of nine sequential cryptographic and transmission steps divided between the Sender (client) and Receiver (server):

| Step # | Node Name | Cryptographic Primitive / Function | Description |
|---|---|---|---|
| 1 | `encrypt` | AES-256-GCM | Encrypts payload data with a single-use symmetric session key |
| 2 | `wrap_key` | RSA-OAEP | Asymmetrically wraps session key using receiver's public key |
| 3 | `integrity_tag` | HMAC-SHA256 | Computes keyed integrity tag across encrypted payload & header |
| 4 | `transmit` | TCP Socket Link | Streams encrypted frames over the wire to the server |
| 5 | `verify_hmac` | HMAC-SHA256 Verification | Server checks integrity; fails if any byte was tampered in transit |
| 6 | `freshness` | &plusmn;60s Timestamp Check | Validates packet freshness against system clock to prevent delayed frames |
| 7 | `replay_check` | Nonce & ID Cache | Ensures message ID has not already been processed in the replay window |
| 8 | `decrypt` | AES-256-GCM Decryption | Unwraps session key and decrypts ciphertext into verified plaintext |
| 9 | `store` | Secure Vault | Writes authenticated file to persistent storage |

### Protocol Honesty & Reveal Timing
- **No speculative animations:** While a network request is in flight, the packet token pulses neutrally at the sender. The frontend never guesses or displays success/failure before the server returns the authoritative response.
- **Data-driven reveal:** When the response arrives, the animation steps through the real `steps` array returned by the API.
- **Deterministic stop:** On any failure, the token immediately halts at the failed node with a shake effect, and subsequent steps are marked as skipped. No tokens ever advance past a failed node.
- **Replayability:** The reveal timeline takes &le;2.5 seconds, can be skipped via `Esc` or clicking the skip button, and can be replayed from the stored result without re-issuing a network call.
