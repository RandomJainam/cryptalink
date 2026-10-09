import React, { useState } from 'react';
import { api } from '../api.js';

export function Header({ serverStatus, gatewayReachable = true, serverReachable = true }) {
  const [copied, setCopied] = useState(false);
  const [showTooltip, setShowTooltip] = useState(false);

  const fullFp = serverStatus?.fingerprint || 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
  const shortFp = fullFp.slice(0, 8) + '...' + fullFp.slice(-8);

  const handleCopy = () => {
    navigator.clipboard?.writeText(fullFp);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const isOnline = gatewayReachable && serverReachable;
  const statusLabel = !gatewayReachable
    ? 'GATEWAY UNREACHABLE'
    : !serverReachable
    ? 'TCP SERVER DOWN'
    : 'GATEWAY ONLINE';

  return (
    <header className="header">
      <div className="brand-section">
        <div className="brand-title-wrap">
          <h1 className="brand-title">CryptaLink</h1>
          {api.isMock && <span className="badge-mock">MOCK DATA</span>}
        </div>
        <p className="brand-subtitle">Secure file transfer, educational demo</p>
      </div>

      <div className="header-meta">
        <div
          className={`status-chip ${isOnline ? 'online' : 'offline'}`}
          aria-label={`Server status: ${statusLabel}`}
        >
          <span className="status-dot" />
          <span>{statusLabel}</span>
        </div>

        <div
          className="fingerprint-card mono"
          onClick={handleCopy}
          onMouseEnter={() => setShowTooltip(true)}
          onMouseLeave={() => setShowTooltip(false)}
          onFocus={() => setShowTooltip(true)}
          onBlur={() => setShowTooltip(false)}
          tabIndex={0}
          role="button"
          aria-label={`Server Fingerprint ${fullFp}. Click to copy.`}
        >
          <span style={{ color: 'var(--text-muted)' }}>FP:</span>
          <span>{shortFp}</span>
          <span style={{ fontSize: '0.75rem', color: 'var(--accent-cyan)' }}>
            {copied ? 'COPIED' : 'COPY'}
          </span>

          {showTooltip && (
            <div className="tooltip mono" role="tooltip">
              {fullFp}
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
