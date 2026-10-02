import { useEffect, useRef } from 'react';

/**
 * App-wide keyboard shortcuts. Bindings are read through a ref, so the window listener is
 * attached once and always calls the latest callbacks.
 *
 * F5 debug · F10 step · F8 / Shift+F8 next/prev breakpoint · Esc leave debugging
 * Ctrl/Cmd + P palette · S save · Enter run · B sidebar · \ AI panel · ` terminal · , settings
 */
export function useGlobalShortcuts(bindings) {
  const ref = useRef(bindings);
  useEffect(() => { ref.current = bindings; });

  useEffect(() => {
    const handler = (e) => {
      const b = ref.current;
      if (e.key === 'F5') { e.preventDefault(); b.onDebug(); return; }
      if (b.isDebugging) {
        if (e.key === 'F10') { e.preventDefault(); b.onStep(); return; }
        if (e.key === 'F8')  { e.preventDefault(); (e.shiftKey ? b.onPrevBreakpoint : b.onNextBreakpoint)(); return; }
        if (e.key === 'Escape' && !b.anyModalOpen) { b.onExitDebug(); return; }
      }

      if (!(e.ctrlKey || e.metaKey)) return;
      const action = {
        p: b.onTogglePalette,
        s: b.onSave,
        enter: b.onRun,
        b: b.onToggleSidebar,
        '\\': b.onToggleAi,
        '`': b.onToggleTerminal,
        ',': b.onOpenSettings,
      }[e.key.toLowerCase()];
      if (action) { e.preventDefault(); action(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);
}
