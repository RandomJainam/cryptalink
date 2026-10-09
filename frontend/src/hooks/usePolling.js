import { useEffect, useRef } from 'react';

// Runs polling callback only while document is visible, clearing on hide/unmount
export function usePolling(callback, intervalMs, enabled = true) {
  const savedCallback = useRef(callback);
  savedCallback.current = callback;

  useEffect(() => {
    if (!enabled || intervalMs <= 0) return;

    let timerId = null;
    let isMounted = true;

    const tick = async () => {
      if (document.visibilityState === 'visible' && isMounted) {
        try {
          await savedCallback.current();
        } catch {
          // Polling errors handled by callback
        }
      }
    };

    const startTimer = () => {
      if (timerId) clearInterval(timerId);
      timerId = setInterval(tick, intervalMs);
    };

    const stopTimer = () => {
      if (timerId) {
        clearInterval(timerId);
        timerId = null;
      }
    };

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        tick();
        startTimer();
      } else {
        stopTimer();
      }
    };

    // Initial immediate tick and interval setup if tab is active
    if (document.visibilityState === 'visible') {
      tick();
      startTimer();
    }

    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      isMounted = false;
      stopTimer();
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [intervalMs, enabled]);
}
