// Tiny DOM confetti burst (no canvas, no dependency). Skipped for reduced-motion users.
const TONES = ['--accent-green', '--accent-yellow', '--accent-pink', '--accent-cyan', '--accent-violet', '--accent-orange'];

export function prefersReducedMotion() {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Burst confetti out of an element (or the centre of the screen).
 * @param {Element|null} origin
 * @param {{ count?: number }} [opts]
 */
export function burstConfetti(origin, { count = 28 } = {}) {
  if (typeof document === 'undefined' || prefersReducedMotion()) return;
  const rect = origin?.getBoundingClientRect?.() ?? { left: innerWidth / 2, top: innerHeight / 2, width: 0, height: 0 };
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;

  const layer = document.createElement('div');
  layer.className = 'pg-confetti';
  layer.setAttribute('aria-hidden', 'true');

  for (let i = 0; i < count; i++) {
    const piece = document.createElement('span');
    const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.6;
    const power = 70 + Math.random() * 110;
    const size = 6 + Math.random() * 6;
    piece.style.left = `${x}px`;
    piece.style.top = `${y}px`;
    piece.style.width = `${size}px`;
    piece.style.height = `${Math.random() > 0.5 ? size : size * 0.45}px`;
    piece.style.borderRadius = Math.random() > 0.6 ? '50%' : '2px';
    piece.style.background = `var(${TONES[i % TONES.length]})`;
    piece.style.setProperty('--dx', `${Math.cos(angle) * power}px`);
    piece.style.setProperty('--dy', `${Math.sin(angle) * power - 40}px`);
    piece.style.setProperty('--rot', `${(Math.random() - 0.5) * 720}deg`);
    piece.style.animationDelay = `${Math.random() * 60}ms`;
    layer.appendChild(piece);
  }

  document.body.appendChild(layer);
  setTimeout(() => layer.remove(), 1500);
}
