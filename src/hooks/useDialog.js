import { useEffect, useRef } from 'react';

const FOCUSABLE = [
  'a[href]', 'button:not([disabled])', 'input:not([disabled])', 'select:not([disabled])',
  'textarea:not([disabled])', '[tabindex]:not([tabindex="-1"])',
].join(',');

/**
 * Modal dialog behaviour (WAI-ARIA dialog pattern) for the panel in `ref`:
 * focus moves inside on open (keeping an autofocused field), Tab / Shift+Tab cycle within
 * the dialog, Escape closes it, and focus returns to whatever opened it.
 *
 * @param {{ current: HTMLElement|null }} ref  the dialog panel
 * @param {{ active?: boolean, onClose?: () => void }} opts
 */
export function useDialog(ref, { active = true, onClose } = {}) {
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; });

  useEffect(() => {
    const panel = ref.current;
    if (!active || !panel) return;
    const opener = document.activeElement;
    const focusables = () => [...panel.querySelectorAll(FOCUSABLE)]
      .filter(el => el.getClientRects().length > 0); // visible only

    if (!panel.contains(document.activeElement)) {
      (focusables()[0] || panel).focus();
    }

    // Capture phase: runs before the app's global shortcuts and Monaco's handlers
    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCloseRef.current?.();
        return;
      }
      if (e.key !== 'Tab') return;
      const items = focusables();
      if (items.length === 0) { e.preventDefault(); panel.focus(); return; }
      const first = items[0];
      const last = items[items.length - 1];
      const current = document.activeElement;
      if (!panel.contains(current)) { e.preventDefault(); first.focus(); }
      else if (e.shiftKey && current === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && current === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKeyDown, true);

    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      if (opener && opener !== document.body && document.contains(opener)) opener.focus?.();
    };
  }, [active, ref]);
}
