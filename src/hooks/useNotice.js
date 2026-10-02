import { useState, useCallback, useEffect } from 'react';

/** Transient status-bar notice: notify(type, text) shows it for 6 seconds. */
export function useNotice() {
  const [notice, setNotice] = useState(null);
  const notify = useCallback((type, text) => setNotice({ type, text, id: Date.now() }), []);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 6000);
    return () => clearTimeout(t);
  }, [notice]);
  return { notice, notify };
}
