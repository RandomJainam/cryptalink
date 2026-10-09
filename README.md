# CryptaLink

Secure file transfer over a framed TCP connection using RSA-OAEP, AES-256-GCM, and HMAC-SHA256.

## Phase 2 verification notes

- After packet structure validation, RSA unwrap failures and HMAC failures return status 2 (`INTEGRITY_FAILED`). Parser `MalformedPacket` errors return status 1 (`MALFORMED`); unrelated cryptography `ValueError`s are not treated as malformed packets.
- If GCM authentication succeeds but the decrypted filename is invalid UTF-8 or its length prefix exceeds the available plaintext, the pipeline returns status 5 (`DECRYPT_FAILED`) and saves nothing.
- Every handled pipeline result, including `MALFORMED` and `INTERNAL`, writes an audit event before returning. The audit logger itself must be writable for that event to be recorded.
- A valid HMAC and fresh timestamp cause the message ID to be inserted before GCM decryption. Therefore, a packet with a valid HMAC and an invalid GCM tag returns `DECRYPT_FAILED` and consumes its ID.

## Demo timing

Run `scripts\demo.bat <file>` with the TCP server port available. The replay step resends the exact packet from the normal send, so run the demo within 60 seconds of that send; otherwise freshness rejects it as stale before replay detection.

The demo prints normal, tamper, replay, and stale results, then verifies the audit chain with `scripts\verify_log.py`.
