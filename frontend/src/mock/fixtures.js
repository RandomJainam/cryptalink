// Mock fixtures and in-memory simulated backend matching the frozen API contract
const STEP_NAMES = [
  'encrypt',
  'wrap_key',
  'integrity_tag',
  'transmit',
  'verify_hmac',
  'freshness',
  'replay_check',
  'decrypt',
  'store'
];

export const mockStatus = {
  server_reachable: true,
  fingerprint: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  algorithms: ['AES-256-GCM', 'RSA-OAEP', 'HMAC-SHA256', 'SHA-256 Hash Chain'],
  replay_window_seconds: 60
};

export function createSuccessResult(filename = 'confidential.pdf', sizeBytes = 1048576) {
  const msgId = 'msg_' + Math.random().toString(36).substring(2, 10);
  return {
    status: 'accepted',
    message_id: msgId,
    filename: filename,
    size_bytes: sizeBytes,
    reason: null,
    duration_ms: Math.floor(180 + Math.random() * 90),
    steps: [
      { name: 'encrypt', ok: true, detail: 'AES-256-GCM encrypted payload' },
      { name: 'wrap_key', ok: true, detail: 'Session key wrapped with RSA-OAEP' },
      { name: 'integrity_tag', ok: true, detail: 'HMAC-SHA256 generated' },
      { name: 'transmit', ok: true, detail: 'Transmitted via TCP socket' },
      { name: 'verify_hmac', ok: true, detail: 'HMAC authentication verified' },
      { name: 'freshness', ok: true, detail: 'Delta +0.4s within +/-60s window' },
      { name: 'replay_check', ok: true, detail: 'Nonce & ID unique in cache' },
      { name: 'decrypt', ok: true, detail: 'Decrypted with session key' },
      { name: 'store', ok: true, detail: 'Written to secure vault' }
    ]
  };
}

export function createTamperResult(filename = 'tampered_packet.bin', sizeBytes = 524288) {
  const msgId = 'msg_' + Math.random().toString(36).substring(2, 10);
  return {
    status: 'rejected',
    message_id: msgId,
    filename: filename,
    size_bytes: sizeBytes,
    reason: 'HMAC verification failed: 1 byte modified in transit',
    duration_ms: Math.floor(120 + Math.random() * 60),
    steps: [
      { name: 'encrypt', ok: true, detail: 'AES-256-GCM encrypted payload' },
      { name: 'wrap_key', ok: true, detail: 'Session key wrapped with RSA-OAEP' },
      { name: 'integrity_tag', ok: true, detail: 'HMAC-SHA256 generated' },
      { name: 'transmit', ok: true, detail: 'Transmitted via TCP socket' },
      { name: 'verify_hmac', ok: false, detail: 'HMAC verification failed: digest mismatch' },
      { name: 'freshness', ok: false, detail: 'skipped' },
      { name: 'replay_check', ok: false, detail: 'skipped' },
      { name: 'decrypt', ok: false, detail: 'skipped' },
      { name: 'store', ok: false, detail: 'skipped' }
    ]
  };
}

export function createReplayResult(previousMsgId = 'msg_prev882', filename = 'replay_packet.bin', sizeBytes = 524288) {
  return {
    status: 'rejected',
    message_id: previousMsgId,
    filename: filename,
    size_bytes: sizeBytes,
    reason: 'Replay detected: message ID already seen in active 60s window',
    duration_ms: Math.floor(140 + Math.random() * 50),
    steps: [
      { name: 'encrypt', ok: true, detail: 'AES-256-GCM encrypted payload' },
      { name: 'wrap_key', ok: true, detail: 'Session key wrapped with RSA-OAEP' },
      { name: 'integrity_tag', ok: true, detail: 'HMAC-SHA256 generated' },
      { name: 'transmit', ok: true, detail: 'Transmitted via TCP socket' },
      { name: 'verify_hmac', ok: true, detail: 'HMAC authentication verified' },
      { name: 'freshness', ok: true, detail: 'Delta +1.2s within +/-60s window' },
      { name: 'replay_check', ok: false, detail: 'Duplicate message ID in cache' },
      { name: 'decrypt', ok: false, detail: 'skipped' },
      { name: 'store', ok: false, detail: 'skipped' }
    ]
  };
}

export function createStaleResult(filename = 'stale_packet.bin', sizeBytes = 262144) {
  const msgId = 'msg_' + Math.random().toString(36).substring(2, 10);
  return {
    status: 'rejected',
    message_id: msgId,
    filename: filename,
    size_bytes: sizeBytes,
    reason: 'Timestamp rejected: skew exceeds +/-60s tolerance',
    duration_ms: Math.floor(130 + Math.random() * 40),
    steps: [
      { name: 'encrypt', ok: true, detail: 'AES-256-GCM encrypted payload' },
      { name: 'wrap_key', ok: true, detail: 'Session key wrapped with RSA-OAEP' },
      { name: 'integrity_tag', ok: true, detail: 'HMAC-SHA256 generated' },
      { name: 'transmit', ok: true, detail: 'Transmitted via TCP socket' },
      { name: 'verify_hmac', ok: true, detail: 'HMAC authentication verified' },
      { name: 'freshness', ok: false, detail: 'Timestamp delta (+128s) exceeds +/-60s' },
      { name: 'replay_check', ok: false, detail: 'skipped' },
      { name: 'decrypt', ok: false, detail: 'skipped' },
      { name: 'store', ok: false, detail: 'skipped' }
    ]
  };
}

// In-memory mock store
let mockLogs = [
  {
    seq: 1,
    ts: new Date(Date.now() - 24000).toISOString(),
    event_type: 'HANDSHAKE',
    message_id: 'sys_init_01',
    result: 'accepted',
    reason: null,
    source_ip: '127.0.0.1'
  },
  {
    seq: 2,
    ts: new Date(Date.now() - 15000).toISOString(),
    event_type: 'TRANSFER',
    message_id: 'msg_init77a',
    result: 'accepted',
    reason: null,
    source_ip: '127.0.0.1'
  }
];

let lastSuccessfulTransfer = {
  message_id: 'msg_init77a',
  filename: 'initial_doc.pdf',
  size_bytes: 412000
};

let simulate503 = false;
let mockBrokenChain = false;

export const mockState = {
  get lastSuccess() {
    return lastSuccessfulTransfer;
  },
  set lastSuccess(val) {
    lastSuccessfulTransfer = val;
  },
  get logs() {
    return mockLogs;
  },
  get simulate503() {
    return simulate503;
  },
  set simulate503(val) {
    simulate503 = val;
  },
  get brokenChain() {
    return mockBrokenChain;
  },
  set brokenChain(val) {
    mockBrokenChain = val;
  },
  addLog(event) {
    const seq = mockLogs.length > 0 ? mockLogs[mockLogs.length - 1].seq + 1 : 1;
    const newEntry = {
      seq,
      ts: new Date().toISOString(),
      source_ip: '127.0.0.1',
      ...event
    };
    mockLogs.push(newEntry);
    if (mockLogs.length > 50) {
      mockLogs = mockLogs.slice(mockLogs.length - 50);
    }
    return newEntry;
  }
};
