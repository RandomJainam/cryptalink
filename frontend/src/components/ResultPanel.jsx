import React, { useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';

export function ResultPanel({ result }) {
  const [copiedId, setCopiedId] = useState(false);
  const shouldReduceMotion = useReducedMotion();

  if (!result) return null;

  const isAccepted = result.status === 'accepted';
  const msgId = result.message_id || 'unknown';
  const shortMsgId = msgId.length > 14 ? msgId.slice(0, 7) + '...' + msgId.slice(-6) : msgId;

  const copyMessageId = () => {
    navigator.clipboard?.writeText(msgId);
    setCopiedId(true);
    setTimeout(() => setCopiedId(false), 2000);
  };

  const formatBytes = (bytes) => {
    if (!bytes && bytes !== 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KiB', 'MiB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + (sizes[i] || 'B');
  };

  // Staggered variants for cards
  const containerVariants = {
    hidden: { opacity: 0 },
    show: {
      opacity: 1,
      transition: {
        staggerChildren: shouldReduceMotion ? 0 : 0.04
      }
    }
  };

  const cardVariants = {
    hidden: { opacity: 0, y: shouldReduceMotion ? 0 : 8 },
    show: { opacity: 1, y: 0, transition: { duration: shouldReduceMotion ? 0.01 : 0.2 } }
  };

  return (
    <motion.section
      className="panel result-panel"
      aria-label="Transfer evaluation result"
      initial={{ opacity: 0, y: shouldReduceMotion ? 0 : 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: shouldReduceMotion ? 0.01 : 0.25 }}
    >
      <div className="result-summary-row">
        <AnimatePresence mode="wait">
          <motion.div
            key={result.status}
            className={`result-badge ${isAccepted ? 'badge-accepted' : 'badge-rejected'}`}
            initial={{ opacity: 0, scale: shouldReduceMotion ? 1 : 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: shouldReduceMotion ? 1 : 0.95 }}
            transition={{ duration: 0.15 }}
          >
            <span>{isAccepted ? '✓ STATUS: ACCEPTED' : '✕ STATUS: REJECTED'}</span>
          </motion.div>
        </AnimatePresence>

        {result.reason && (
          <div style={{ color: isAccepted ? 'var(--accent-green)' : 'var(--accent-red)', fontSize: '0.875rem', fontWeight: 600 }}>
            {result.reason}
          </div>
        )}
      </div>

      <div className="result-meta-grid">
        <div className="meta-box">
          <div className="meta-label">Message ID</div>
          <div
            className="meta-val mono"
            onClick={copyMessageId}
            style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}
            title="Click to copy message ID"
          >
            <span>{shortMsgId}</span>
            <span style={{ fontSize: '0.6875rem', color: 'var(--accent-cyan)' }}>
              {copiedId ? 'COPIED' : 'COPY'}
            </span>
          </div>
        </div>

        <div className="meta-box">
          <div className="meta-label">Payload Filename</div>
          <div className="meta-val">{result.filename || 'packet.bin'}</div>
        </div>

        <div className="meta-box">
          <div className="meta-label">Payload Size</div>
          <div className="meta-val mono">{formatBytes(result.size_bytes)}</div>
        </div>

        <div className="meta-box">
          <div className="meta-label">Pipeline Duration</div>
          <div className="meta-val mono">{result.duration_ms} ms</div>
        </div>
      </div>

      <div>
        <h3 style={{ fontSize: '0.875rem', fontWeight: 700, marginBottom: '12px', color: 'var(--text-secondary)' }}>
          PROTOCOL VERIFICATION STEPS
        </h3>
        <motion.div
          className="steps-grid"
          variants={containerVariants}
          initial="hidden"
          animate="show"
        >
          {result.steps?.map((step, idx) => {
            const isOk = step.ok;
            const isSkipped = !step.ok && typeof step.detail === 'string' && step.detail.toLowerCase().startsWith('skipped');
            const statusClass = isSkipped ? 'skipped' : isOk ? 'ok' : 'fail';

            return (
              <motion.div
                key={step.name}
                className={`step-card ${statusClass}`}
                variants={cardVariants}
              >
                <div className="step-top">
                  <span className="step-name mono">
                    {idx + 1}. {step.name}
                  </span>
                  <span style={{ fontSize: '0.75rem', fontWeight: 700 }}>
                    {isSkipped ? 'SKIPPED' : isOk ? 'PASSED' : 'FAILED'}
                  </span>
                </div>
                <div className="step-detail">{step.detail}</div>
              </motion.div>
            );
          })}
        </motion.div>
      </div>
    </motion.section>
  );
}
