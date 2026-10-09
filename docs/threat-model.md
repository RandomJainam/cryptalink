# CryptaLink threat model

CryptaLink protects file confidentiality on the TCP hop and detects packet modification, stale requests, replays, path traversal attempts, and local audit-log edits. The gateway demo receives plaintext over local HTTP before it creates the encrypted TCP packet.

| Threat | Defense | Residual risk |
| --- | --- | --- |
| Eavesdropping | AES-256-GCM with a fresh per-transfer key and nonce | Traffic size and timing remain visible |
| Tampering | HMAC-SHA256 over the packet plus the GCM tag | Detailed demo statuses disclose failure stage |
| Replay | 60-second timestamp window and 120-second in-memory ID cache | Cache state is lost on restart |
| Cache poisoning | IDs enter the cache only after HMAC and freshness pass | CPU and memory exhaustion remain possible |
| Path traversal | Basename, character filtering, and message-ID prefix | Prototype assumes a local filesystem |
| Oversized input | Frame length checked before body read; 10 MiB file cap | No rate limiting or throttling |
| Audit modification | SHA-256 chain detects changed or deleted entries | An attacker can rewrite the full chain |
| Public-key substitution | SHA-256 fingerprint and trust-on-first-use | Fingerprint must be verified independently |
| Sender impersonation | Not addressed | Anyone holding the public key can send |

Further limitations: browser-to-gateway is plain HTTP; RSA unwrap work occurs before packet HMAC verification; keys are not rotated automatically; and the entire file is held in memory. This project is an educational prototype, not a production service.
