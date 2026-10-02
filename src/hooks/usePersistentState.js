import { useState, useEffect } from 'react';

/** useState backed by localStorage (JSON). Falls back to in-memory if storage is unavailable. */
export function usePersistentState(key, initial) {
  const [value, setValue] = useState(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? initial : JSON.parse(raw);
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage full/blocked */ }
  }, [key, value]);
  return [value, setValue];
}
