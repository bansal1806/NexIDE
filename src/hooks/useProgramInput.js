import { useCallback } from 'react';
import { usePersistentState } from './usePersistentState';

const MAX_FILES = 50;
const MAX_CHARS = 10_000;

/**
 * Console "Input" box contents, remembered per file across reloads.
 * @returns {{ stdinFor: (path) => string, setStdinFor: (path, text) => void }}
 */
export function useProgramInput() {
  const [byPath, setByPath] = usePersistentState('nexide:stdin', {});

  const stdinFor = useCallback((path) => (path && byPath[path]) || '', [byPath]);

  const setStdinFor = useCallback((path, text) => {
    if (!path) return;
    setByPath(prev => {
      const next = { ...prev };
      delete next[path];
      if (text) next[path] = text.slice(0, MAX_CHARS); // re-insert last = most recently used
      const keys = Object.keys(next);
      keys.slice(0, Math.max(0, keys.length - MAX_FILES)).forEach(k => delete next[k]);
      return next;
    });
  }, [setByPath]);

  return { stdinFor, setStdinFor };
}
