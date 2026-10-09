import { useState, useCallback, useRef } from 'react';
import { api } from '../api.js';

// State machine phases: idle -> sending -> revealing -> done | error
export function useTransfer() {
  const [phase, setPhase] = useState('idle'); // idle | sending | revealing | done | error
  const [actionType, setActionType] = useState(null); // 'transfer' | 'tamper' | 'replay'
  const [file, setFile] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [lastCompletedResult, setLastCompletedResult] = useState(null);

  // Active abort / cancel reference
  const abortControllerRef = useRef(null);
  const timelineControllerRef = useRef(null);

  const resetPipeline = useCallback(() => {
    if (timelineControllerRef.current?.kill) {
      timelineControllerRef.current.kill();
    }
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
  }, []);

  const selectFile = useCallback((newFile) => {
    if (newFile && newFile.size > 10 * 1024 * 1024) {
      setError({
        status: 400,
        message: `File "${newFile.name}" exceeds 10 MiB client limit (${(newFile.size / (1024 * 1024)).toFixed(2)} MiB).`
      });
      setPhase('error');
      setFile(null);
      return false;
    }
    setError(null);
    setFile(newFile);
    return true;
  }, []);

  const executeAction = useCallback(
    async (type, executeFn) => {
      resetPipeline();

      setActionType(type);
      setPhase('sending');
      setError(null);
      setResult(null);

      try {
        const res = await executeFn();
        setResult(res);
        setPhase('revealing');
      } catch (err) {
        setPhase('error');
        setError({
          status: err.status || null,
          message: err.detail || err.message || 'Operation failed'
        });
      }
    },
    [resetPipeline]
  );

  const startTransfer = useCallback(() => {
    if (!file) {
      setError({ status: null, message: 'Please select a file to transmit' });
      setPhase('error');
      return;
    }
    executeAction('transfer', () => api.sendTransfer(file));
  }, [file, executeAction]);

  const startTamper = useCallback(() => {
    executeAction('tamper', () => api.simulateTamper(file));
  }, [file, executeAction]);

  const startReplay = useCallback(() => {
    executeAction('replay', () => api.simulateReplay());
  }, [executeAction]);

  // Invoked by GSAP when the reveal timeline completes or skips
  const finishReveal = useCallback(() => {
    setPhase('done');
    setLastCompletedResult((prev) => result || prev);
  }, [result]);

  const skipReveal = useCallback(() => {
    if (timelineControllerRef.current?.skip) {
      timelineControllerRef.current.skip();
    } else {
      finishReveal();
    }
  }, [finishReveal]);

  const replayAnimation = useCallback(() => {
    if (!result && !lastCompletedResult) return;
    const currentResult = result || lastCompletedResult;
    setResult(currentResult);
    setPhase('revealing');
  }, [result, lastCompletedResult]);

  return {
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
  };
}
