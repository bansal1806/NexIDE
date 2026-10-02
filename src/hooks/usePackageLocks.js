import { useCallback } from 'react';
import { usePersistentState } from './usePersistentState';

/**
 * npm package pins per workspace (spec → exact esm.sh id). Pinned URLs are immutable, so runs
 * are reproducible and the service worker can serve the packages offline.
 */
export function usePackageLocks() {
  const [locks, setLocks] = usePersistentState('nexide:npm-lock', {});

  const lockFor = useCallback((workspaceKey) => locks[workspaceKey] || {}, [locks]);

  const savePins = useCallback((workspaceKey, pins) => {
    if (!pins || Object.keys(pins).length === 0) return;
    setLocks(prev => {
      const current = prev[workspaceKey] || {};
      if (Object.entries(pins).every(([spec, id]) => current[spec] === id)) return prev;
      return { ...prev, [workspaceKey]: { ...current, ...pins } };
    });
  }, [setLocks]);

  const clearPins = useCallback((workspaceKey) => {
    setLocks(prev => {
      const next = { ...prev };
      delete next[workspaceKey];
      return next;
    });
  }, [setLocks]);

  // Drop one pin: that package re-resolves to its latest version on the next run
  const unpin = useCallback((workspaceKey, spec) => {
    setLocks(prev => {
      if (!prev[workspaceKey]?.[spec]) return prev;
      const pins = { ...prev[workspaceKey] };
      delete pins[spec];
      return { ...prev, [workspaceKey]: pins };
    });
  }, [setLocks]);

  return { lockFor, savePins, clearPins, unpin };
}
