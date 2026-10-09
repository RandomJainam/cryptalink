import React from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';

export function EventLog({ logs }) {
  const shouldReduceMotion = useReducedMotion();

  const formatTime = (ts) => {
    if (!ts) return '-';
    try {
      const d = new Date(ts);
      return (
        d.toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }) +
        '.' +
        String(d.getMilliseconds()).padStart(3, '0')
      );
    } catch {
      return ts;
    }
  };

  const reversedLogs = [...logs].reverse();

  return (
    <section className="panel" aria-label="Security event logs">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ fontSize: '0.875rem', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
          Real-Time Audit Event Log ({logs.length} events)
        </h3>
        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
          Polled every 2s &bull; Auto-paused when tab inactive
        </span>
      </div>

      <div className="table-container">
        <table className="log-table" aria-label="System events table">
          <thead>
            <tr>
              <th>Seq / Time</th>
              <th>Event Type</th>
              <th>Result</th>
              <th>Reason</th>
              <th>Message ID</th>
              <th>Source IP</th>
            </tr>
          </thead>
          <tbody>
            {reversedLogs.length === 0 ? (
              <tr>
                <td colSpan="6" style={{ textAlign: 'center', padding: '24px', color: 'var(--text-muted)' }}>
                  No audit logs recorded yet.
                </td>
              </tr>
            ) : (
              <AnimatePresence initial={false}>
                {reversedLogs.map((log) => {
                  const isRejected = log.result === 'rejected';

                  return (
                    <motion.tr
                      key={log.seq}
                      className={isRejected ? 'log-row-rejected' : ''}
                      initial={{
                        opacity: 0,
                        x: shouldReduceMotion ? 0 : -8
                      }}
                      animate={{
                        opacity: 1,
                        x: 0
                      }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: shouldReduceMotion ? 0.01 : 0.2 }}
                    >
                      <td className="mono" style={{ whiteSpace: 'nowrap' }}>
                        <span style={{ color: 'var(--accent-cyan)', marginRight: '8px' }}>#{log.seq}</span>
                        <span>{formatTime(log.ts)}</span>
                      </td>
                      <td className="mono" style={{ fontWeight: 600 }}>{log.event_type}</td>
                      <td>
                        <span
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px',
                            fontWeight: 700,
                            color: isRejected ? 'var(--accent-red)' : 'var(--accent-green)'
                          }}
                        >
                          {isRejected ? '✕ REJECTED' : '✓ ACCEPTED'}
                        </span>
                      </td>
                      <td style={{ maxWidth: '240px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {log.reason || '-'}
                      </td>
                      <td className="mono" style={{ fontSize: '0.75rem' }}>
                        {log.message_id ? (log.message_id.length > 12 ? log.message_id.slice(0, 10) + '…' : log.message_id) : '-'}
                      </td>
                      <td className="mono" style={{ fontSize: '0.75rem' }}>{log.source_ip || '127.0.0.1'}</td>
                    </motion.tr>
                  );
                })}
              </AnimatePresence>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
