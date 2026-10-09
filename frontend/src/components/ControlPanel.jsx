import React, { useRef, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';

export function ControlPanel({
  file,
  onSelectFile,
  onTransfer,
  onTamper,
  onReplay,
  isBusy,
  hasPreviousSuccess,
  error
}) {
  const fileInputRef = useRef(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const shouldReduceMotion = useReducedMotion();

  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = () => {
    setIsDragOver(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      onSelectFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileChange = (e) => {
    if (e.target.files && e.target.files[0]) {
      onSelectFile(e.target.files[0]);
    }
  };

  const formatSize = (bytes) => {
    if (!bytes) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KiB', 'MiB', 'GiB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const tapEffect = shouldReduceMotion ? {} : { whileTap: { scale: 0.97 } };

  return (
    <div className="panel control-panel">
      <div
        className={`dropzone ${isDragOver ? 'drag-active' : ''} ${file ? 'has-file' : ''}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') fileInputRef.current?.click();
        }}
        aria-label="Upload payload file"
      >
        <input
          type="file"
          ref={fileInputRef}
          style={{ display: 'none' }}
          onChange={handleFileChange}
        />
        {file ? (
          <div>
            <div style={{ fontWeight: 600, color: 'var(--accent-cyan)' }}>{file.name}</div>
            <div style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>
              Size: {formatSize(file.size)} &bull; Click or drop another to replace
            </div>
          </div>
        ) : (
          <div>
            <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
              Drop a file here, or click to browse
            </div>
            <div style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
              Max size 10 MiB &bull; Supports binary, text, or sample files
            </div>
          </div>
        )}
      </div>

      <div className="actions-group">
        <motion.button
          className="btn btn-primary"
          onClick={onTransfer}
          disabled={isBusy || !file}
          aria-label="Send file with full protocol encryption"
          {...tapEffect}
        >
          Secure Send
        </motion.button>

        <motion.button
          className="btn btn-danger"
          onClick={onTamper}
          disabled={isBusy}
          aria-label="Simulate packet tampering during transit"
          {...tapEffect}
        >
          Simulate Tampering
        </motion.button>

        <div className="replay-wrap">
          <motion.button
            className="btn btn-secondary"
            onClick={onReplay}
            disabled={isBusy}
            aria-label="Replay previous packet transmission"
            {...tapEffect}
          >
            Replay Last Packet
          </motion.button>
          {!hasPreviousSuccess && (
            <span className="replay-hint">
              Requires 1 successful transfer first (avoids 409)
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
