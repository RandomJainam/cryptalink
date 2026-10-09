// Unified API client: switches to mock fixtures when VITE_USE_MOCK is true
import {
  mockStatus,
  createSuccessResult,
  createTamperResult,
  createReplayResult,
  mockState
} from './mock/fixtures.js';

export const IS_MOCK = import.meta.env.VITE_USE_MOCK === 'true';
const BASE_URL = import.meta.env.VITE_API_BASE || 'http://localhost:8000/api';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomDelay() {
  return Math.floor(600 + Math.random() * 600); // 600ms - 1200ms
}

class ApiError extends Error {
  constructor(status, detail) {
    super(detail || `HTTP Error ${status}`);
    this.status = status;
    this.detail = detail || `HTTP Error ${status}`;
  }
}

async function handleResponse(res) {
  if (!res.ok) {
    let detail = `Server responded with ${res.status}`;
    try {
      const data = await res.json();
      if (data && data.detail) {
        detail = data.detail;
      }
    } catch {
      // Non-JSON error payload
    }
    throw new ApiError(res.status, detail);
  }
  return res.json();
}

export const api = {
  isMock: IS_MOCK,

  async getStatus() {
    if (IS_MOCK) {
      await sleep(250);
      if (mockState.simulate503) {
        throw new ApiError(503, 'TCP gateway offline (service unavailable)');
      }
      return { ...mockStatus };
    }
    const res = await fetch(`${BASE_URL}/status`);
    return handleResponse(res);
  },

  async sendTransfer(file) {
    if (IS_MOCK) {
      await sleep(randomDelay());
      if (mockState.simulate503) {
        throw new ApiError(503, 'TCP secure transfer server unreachable');
      }
      const filename = file ? file.name : 'document.bin';
      const sizeBytes = file ? file.size : 1024;
      const result = createSuccessResult(filename, sizeBytes);
      mockState.lastSuccess = {
        message_id: result.message_id,
        filename: result.filename,
        size_bytes: result.size_bytes
      };
      mockState.addLog({
        event_type: 'TRANSFER',
        message_id: result.message_id,
        result: result.status,
        reason: result.reason
      });
      return result;
    }

    const formData = new FormData();
    formData.append('file', file);
    const res = await fetch(`${BASE_URL}/transfer`, {
      method: 'POST',
      body: formData
    });
    return handleResponse(res);
  },

  async simulateTamper(file) {
    if (IS_MOCK) {
      await sleep(randomDelay());
      if (mockState.simulate503) {
        throw new ApiError(503, 'TCP secure transfer server unreachable');
      }
      const filename = file ? file.name : 'tampered_packet.bin';
      const sizeBytes = file ? file.size : 2048;
      const result = createTamperResult(filename, sizeBytes);
      mockState.addLog({
        event_type: 'TAMPER_ATTEMPT',
        message_id: result.message_id,
        result: result.status,
        reason: result.reason
      });
      return result;
    }

    const formData = new FormData();
    if (file) {
      formData.append('file', file);
    }
    const res = await fetch(`${BASE_URL}/simulate/tamper`, {
      method: 'POST',
      body: file ? formData : undefined
    });
    return handleResponse(res);
  },

  async simulateReplay() {
    if (IS_MOCK) {
      await sleep(randomDelay());
      if (!mockState.lastSuccess) {
        throw new ApiError(409, 'No previous successful transfer exists in replay cache to replay');
      }
      const prev = mockState.lastSuccess;
      const result = createReplayResult(prev.message_id, prev.filename, prev.size_bytes);
      mockState.addLog({
        event_type: 'REPLAY_ATTEMPT',
        message_id: result.message_id,
        result: result.status,
        reason: result.reason
      });
      return result;
    }

    const res = await fetch(`${BASE_URL}/simulate/replay`, {
      method: 'POST'
    });
    return handleResponse(res);
  },

  async getLogs(limit = 50) {
    if (IS_MOCK) {
      return [...mockState.logs].slice(-limit);
    }
    const res = await fetch(`${BASE_URL}/logs?limit=${limit}`);
    return handleResponse(res);
  },

  async verifyLogs() {
    if (IS_MOCK) {
      await sleep(400);
      return {
        chain_valid: !mockState.brokenChain,
        broken_at_seq: mockState.brokenChain ? 2 : null
      };
    }
    const res = await fetch(`${BASE_URL}/logs/verify`);
    return handleResponse(res);
  }
};
