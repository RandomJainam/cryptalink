// Mock fixtures matching section 10 and section 9 of docs/SPEC.md
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

function randomHex32() {
  const chars = '0123456789abcdef';
  let str = '';
  for (let i = 0; i < 32; i++) {
    str += chars[Math.floor(Math.random() * chars.length)];
  }
  return str;
}

export const mockStatus = {
  server_reachable: true,
  fingerprint: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  algorithms: ['RSA-OAEP-3072', 'AES-256-GCM', 'HMAC-SHA256', 'SHA-256 Hash Chain'],
  replay_window_seconds: 60
};

export function createSuccessResult(filename = 'confidential.pdf', sizeBytes = 1048576) {
  return {
    status: 'accepted',
    message_id: randomHex32(),
    filename: filename,
    size_bytes: sizeBytes,
    reason: null,
    duration_ms: Math.floor(180 + Math.random() * 80),
    steps: [
      { name: 'encrypt', ok: true, detail: 'AES-256-GCM encrypted payload' },
      { name: 'wrap_key', ok: true, detail: 'Session key wrapped with RSA-OAEP' },
      { name: 'integrity_tag', ok: true, detail: 'HMAC-SHA256 computed over frame' },
      { name: 'transmit', ok: true, detail: 'TCP frame streamed to port 9000' },
      { name: 'verify_hmac', ok: true, detail: 'HMAC authentication verified' },
      { name: 'freshness', ok: true, detail: 'Timestamp delta within +/-60s window' },
      { name: 'replay_check', ok: true, detail: 'Message ID unique; registered in cache' },
      { name: 'decrypt', ok: true, detail: 'Decrypted with unwrap session key' },
      { name: 'store', ok: true, detail: 'Written to storage/received/' }
    ]
  };
}

export function createTamperResult(filename = 'tampered_packet.bin', sizeBytes = 524288) {
  return {
    status: 'rejected',
    message_id: randomHex32(),
    filename: filename,
    size_bytes: sizeBytes,
    reason: 'HMAC verification failed: 1 byte modified in transit (INTEGRITY_FAILED)',
    duration_ms: Math.floor(120 + Math.random() * 50),
    steps: [
      { name: 'encrypt', ok: true, detail: 'AES-256-GCM encrypted payload' },
      { name: 'wrap_key', ok: true, detail: 'Session key wrapped with RSA-OAEP' },
      { name: 'integrity_tag', ok: true, detail: 'HMAC-SHA256 computed over frame' },
      { name: 'transmit', ok: true, detail: 'TCP frame streamed to port 9000' },
      { name: 'verify_hmac', ok: false, detail: 'HMAC digest mismatch' },
      { name: 'freshness', ok: false, detail: 'skipped' },
      { name: 'replay_check', ok: false, detail: 'skipped' },
      { name: 'decrypt', ok: false, detail: 'skipped' },
      { name: 'store', ok: false, detail: 'skipped' }
    ]
  };
}

export function createReplayResult(previousMsgId = null, filename = 'replay_packet.bin', sizeBytes = 524288) {
  return {
    status: 'rejected',
    message_id: previousMsgId || randomHex32(),
    filename: filename,
    size_bytes: sizeBytes,
    reason: 'Message ID already processed in active 60s cache (REPLAY)',
    duration_ms: Math.floor(130 + Math.random() * 40),
    steps: [
      { name: 'encrypt', ok: true, detail: 'AES-256-GCM encrypted payload' },
      { name: 'wrap_key', ok: true, detail: 'Session key wrapped with RSA-OAEP' },
      { name: 'integrity_tag', ok: true, detail: 'HMAC-SHA256 computed over frame' },
      { name: 'transmit', ok: true, detail: 'TCP frame streamed to port 9000' },
      { name: 'verify_hmac', ok: true, detail: 'HMAC authentication verified' },
      { name: 'freshness', ok: true, detail: 'Timestamp delta within +/-60s window' },
      { name: 'replay_check', ok: false, detail: 'Duplicate message ID in cache' },
      { name: 'decrypt', ok: false, detail: 'skipped' },
      { name: 'store', ok: false, detail: 'skipped' }
    ]
  };
}

export function createStaleResult(filename = 'stale_packet.bin', sizeBytes = 262144) {
  return {
    status: 'rejected',
    message_id: randomHex32(),
    filename: filename,
    size_bytes: sizeBytes,
    reason: 'Timestamp exceeds +/-60s window (STALE_TIMESTAMP)',
    duration_ms: Math.floor(125 + Math.random() * 40),
    steps: [
      { name: 'encrypt', ok: true, detail: 'AES-256-GCM encrypted payload' },
      { name: 'wrap_key', ok: true, detail: 'Session key wrapped with RSA-OAEP' },
      { name: 'integrity_tag', ok: true, detail: 'HMAC-SHA256 computed over frame' },
      { name: 'transmit', ok: true, detail: 'TCP frame streamed to port 9000' },
      { name: 'verify_hmac', ok: true, detail: 'HMAC authentication verified' },
      { name: 'freshness', ok: false, detail: 'Timestamp skewed (+120s exceeds +/-60s)' },
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
    ts: new Date(Date.now() - 30000).toISOString(),
    event_type: 'SERVER_START',
    message_id: '00000000000000000000000000000000',
    result: 'accepted',
    reason: null,
    source_ip: '127.0.0.1'
  },
  {
    seq: 2,
    ts: new Date(Date.now() - 15000).toISOString(),
    event_type: 'TRANSFER_ACCEPTED',
    message_id: '4f9a12c8e310467ba9d2e1c78490bf31',
    result: 'accepted',
    reason: null,
    source_ip: '127.0.0.1'
  }
];

let lastSuccessfulTransfer = {
  message_id: '4f9a12c8e310467ba9d2e1c78490bf31',
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
