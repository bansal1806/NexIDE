// Shared console-line helpers for the JS and Python runners.
export const MAX_OUTPUT_LINES = 2000;

let lineSeq = 0;

export function makeLine(type, text) {
  return {
    id: ++lineSeq,
    type,
    text,
    time: new Date().toLocaleTimeString('en', { hour12: false }),
  };
}

/** Append lines, keeping only the newest MAX_OUTPUT_LINES (a noisy setInterval can't exhaust memory). */
export function appendLines(prev, lines) {
  const next = prev.concat(lines);
  if (next.length <= MAX_OUTPUT_LINES) return next;
  const trimmed = next.slice(next.length - MAX_OUTPUT_LINES + 1);
  return [makeLine('system', `… older output trimmed (keeping last ${MAX_OUTPUT_LINES} lines)`), ...trimmed];
}
