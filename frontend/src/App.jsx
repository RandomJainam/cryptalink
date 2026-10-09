import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { api } from './api.js';
import { useTransfer } from './hooks/useTransfer.js';
import { usePolling } from './hooks/usePolling.js';
import { Header } from './components/Header.jsx';
import { ControlPanel } from './components/ControlPanel.jsx';
import { Pipeline } from './components/Pipeline.jsx';
import { ResultPanel } from './components/ResultPanel.jsx';
import { SecurityStatus } from './components/SecurityStatus.jsx';
import { EventLog } from './components/EventLog.jsx';
import { ChainStrip } from './components/ChainStrip.jsx';

export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('ErrorBoundary caught error:', error, errorInfo);
  }

  resetError = () => {
    this.setState({ hasError: false, error: null });
    if (this.props.onReset) {
      this.props.onReset();
    }
  };

  render() {
    if (this.state.hasError) {
      return (
        <div
          className="panel"
          role="alert"
          style={{
            border: '1px solid var(--accent-red)',
            padding: '24px',
            margin: '20px 0',
            background: 'rgba(239, 68, 68, 0.05)'
          }}
        >
          <h2 style={{ color: 'var(--accent-red)', fontSize: '1.25rem', marginBottom: '8px' }}>
            Application Render Error
          </h2>
          <p style={{ color: 'var(--text-secondary)', marginBottom: '16px', fontSize: '0.875rem' }}>
            A client-side error occurred while rendering the dashboard. Click below to reset.
          </p>
          <pre
            className="mono"
            style={{
              background: 'var(--bg-base)',
              padding: '12px',
              borderRadius: '4px',
              color: '#fca5a5',
              overflowX: 'auto',
              fontSize: '0.75rem',
              marginBottom: '16px'
            }}
          >
            {this.state.error?.message || String(this.state.error)}
          </pre>
          <button className="btn btn-secondary" onClick={this.resetError}>
            Reset Dashboard
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  const [serverStatus, setServerStatus] = useState(null);
  const [isReachable, setIsReachable] = useState(true);
  const [logs, setLogs] = useState([]);
  const [verificationResult, setVerificationResult] = useState(null);
  const [isVerifying, setIsVerifying] = useState(false);

  const shouldReduceMotion = useReducedMotion();

  const {
    phase,
    actionType,
    file,
    result,
    error,
    lastCompletedResult,
    selectFile,
    startTransfer,
    startTamper,
    startReplay,
    finishReveal,
    skipReveal,
    replayAnimation,
    timelineControllerRef
  } = useTransfer();

  // Poll server status every 5 seconds while visible
  const pollStatus = useCallback(async () => {
    try {
      const data = await api.getStatus();
      setServerStatus(data);
      setIsReachable(Boolean(data.server_reachable));
    } catch {
      setIsReachable(false);
    }
  }, []);
  usePolling(pollStatus, 5000);

  // Poll event logs every 2 seconds while visible
  const pollLogs = useCallback(async () => {
    try {
      const data = await api.getLogs(50);
      setLogs(data);
    } catch {
      // Keep existing logs on temporary poll failure
    }
  }, []);
  usePolling(pollLogs, 2000);

  // Verification call
  const handleVerifyChain = async () => {
    setIsVerifying(true);
    try {
      const data = await api.verifyLogs();
      setVerificationResult(data);
    } catch {
      setVerificationResult({ chain_valid: false, broken_at_seq: null });
    } finally {
      setIsVerifying(false);
    }
  };

  // Keyboard shortcut: Esc to skip reveal
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && phase === 'revealing') {
        skipReveal();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [phase, skipReveal]);

  const isBusy = phase === 'sending' || phase === 'revealing';
  const hasPreviousSuccess = Boolean(lastCompletedResult?.status === 'accepted' || (api.isMock && true));

  return (
    <div className="app-container">
      <Header serverStatus={serverStatus} isReachable={isReachable} />

      <ErrorBoundary onReset={() => window.location.reload()}>
        <AnimatePresence>
          {error && (
            <motion.div
              className="error-banner"
              role="alert"
              initial={{ opacity: 0, y: shouldReduceMotion ? 0 : -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: shouldReduceMotion ? 0 : -10 }}
              transition={{ duration: 0.2 }}
            >
              <div>
                <strong>{error.status ? `Error ${error.status}: ` : 'Error: '}</strong>
                {error.message}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <ControlPanel
          file={file}
          onSelectFile={selectFile}
          onTransfer={startTransfer}
          onTamper={startTamper}
          onReplay={startReplay}
          isBusy={isBusy}
          hasPreviousSuccess={hasPreviousSuccess}
          error={error}
        />

        <Pipeline
          phase={phase}
          actionType={actionType}
          result={result || lastCompletedResult}
          error={error}
          file={file}
          onSkip={skipReveal}
          onReplay={replayAnimation}
          onFinishReveal={finishReveal}
          timelineControllerRef={timelineControllerRef}
        />

        {(result || lastCompletedResult) && (
          <ResultPanel result={result || lastCompletedResult} />
        )}

        <div className="two-col-grid">
          <SecurityStatus status={serverStatus} />
          <ChainStrip
            logs={logs}
            verificationResult={verificationResult}
            isVerifying={isVerifying}
            onVerify={handleVerifyChain}
          />
        </div>

        <EventLog logs={logs} />
      </ErrorBoundary>
    </div>
  );
}
