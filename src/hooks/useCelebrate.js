import { useEffect, useRef } from 'react';
import { burstConfetti } from '../components/fx/confetti';

/**
 * Confetti from the Run button on the first successful run of the session, and whenever a
 * run succeeds right after one failed ("you fixed it!"). Not on every run — that gets old.
 * @param {'idle'|'running'|'success'|'error'} status
 */
export function useCelebrate(status, originSelector = '#btn-run-code') {
  const previous = useRef(status);
  const celebratedOnce = useRef(false);
  const lastOutcome = useRef(null);

  useEffect(() => {
    if (previous.current === 'running' && status === 'success') {
      if (!celebratedOnce.current || lastOutcome.current === 'error') {
        burstConfetti(document.querySelector(originSelector));
        celebratedOnce.current = true;
      }
    }
    if (status === 'success' || status === 'error') lastOutcome.current = status;
    previous.current = status;
  }, [status, originSelector]);
}
