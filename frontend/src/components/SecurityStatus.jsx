import React from 'react';

export function SecurityStatus({ status }) {
  const algorithms = status?.algorithms || ['AES-256-GCM', 'RSA-OAEP', 'HMAC-SHA256', 'SHA-256 Hash Chain'];
  const replayWindow = status?.replay_window_seconds ?? 60;

  return (
    <div className="panel" aria-label="Security and cryptographic status">
      <h3 style={{ fontSize: '0.875rem', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
        Cryptographic Suite & Parameters
      </h3>

      <div style={{ marginTop: '12px', fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>
        Active Ciphers & Hash Functions:
      </div>
      <div className="algo-list mono">
        {algorithms.map((algo) => (
          <span key={algo} className="algo-tag">
            {algo}
          </span>
        ))}
      </div>

      <div style={{ marginTop: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid var(--border-subtle)', paddingTop: '12px' }}>
        <span style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>Replay Detection Window:</span>
        <span className="mono" style={{ fontSize: '0.875rem', fontWeight: 700, color: 'var(--accent-cyan)' }}>
          &plusmn;{replayWindow} seconds
        </span>
      </div>
    </div>
  );
}
