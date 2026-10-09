import React from 'react';
import { motion, useReducedMotion } from 'framer-motion';

export function ChainStrip({ logs, verificationResult, isVerifying, onVerify }) {
  const recentLogs = logs.slice(-8); // Show up to last 8 events in strip
  const { chain_valid, broken_at_seq } = verificationResult || {};
  const shouldReduceMotion = useReducedMotion();

  return (
    <div className="panel" aria-label="Hash chain integrity verification">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h3 style={{ fontSize: '0.875rem', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
            Audit Log Hash Chain
          </h3>
          <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            Each log entry is cryptographically bound to the previous block via SHA-256.
          </p>
        </div>

        <motion.button
          className="btn btn-secondary"
          onClick={onVerify}
          disabled={isVerifying}
          style={{ fontSize: '0.8125rem', padding: '6px 14px' }}
          whileTap={shouldReduceMotion ? {} : { scale: 0.97 }}
        >
          {isVerifying ? 'Verifying Chain...' : 'Verify Log Integrity'}
        </motion.button>
      </div>

      {verificationResult && (
        <motion.div
          style={{ marginTop: '12px', fontSize: '0.8125rem' }}
          initial={{ opacity: 0, y: shouldReduceMotion ? 0 : 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
        >
          {chain_valid ? (
            <span style={{ color: 'var(--accent-green)', fontWeight: 600 }}>
              &check; Cryptographic chain verified: All event blocks match forward hashes.
            </span>
          ) : (
            <span style={{ color: 'var(--accent-red)', fontWeight: 600 }}>
              &cross; Chain integrity breach detected at Sequence #{broken_at_seq}!
            </span>
          )}
        </motion.div>
      )}

      <div className="chain-strip-wrap" role="region" aria-label="Visual chain blocks">
        {recentLogs.map((log, index) => {
          let nodeClass = '';
          let linkClass = '';

          if (verificationResult) {
            if (chain_valid) {
              nodeClass = 'verified';
              linkClass = 'verified';
            } else {
              if (broken_at_seq != null && log.seq >= broken_at_seq) {
                nodeClass = 'broken';
                linkClass = 'broken';
              } else {
                nodeClass = 'verified';
                linkClass = 'verified';
              }
            }
          }

          return (
            <div key={`${log.seq}-${log.ts}`} className="chain-block">
              {index > 0 && <div className={`chain-link ${linkClass}`} />}
              <motion.div
                className={`chain-node ${nodeClass}`}
                title={`Seq #${log.seq}: ${log.event_type}`}
                animate={{
                  scale: verificationResult ? (nodeClass === 'broken' ? 1.08 : 1) : 1
                }}
                transition={{ duration: shouldReduceMotion ? 0.01 : 0.25 }}
              >
                #{log.seq}
              </motion.div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
