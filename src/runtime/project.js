// Pure helpers for project mode (no WebContainer dependency, unit-tested).

/** `{ path, content }` records → the nested tree `WebContainer.mount()` expects. */
export function toFileSystemTree(files) {
  const root = {};
  for (const { path, content } of files) {
    const parts = path.split('/').filter(Boolean);
    if (!parts.length) continue;
    let dir = root;
    for (const part of parts.slice(0, -1)) {
      if (!dir[part]) dir[part] = { directory: {} };
      dir = dir[part].directory; // undefined when a file already claims this name
      if (!dir) break;
    }
    const name = parts[parts.length - 1];
    if (dir && !dir[name]) dir[name] = { file: { contents: content } };
  }
  return root;
}

// Generated / dependency folders whose changes never sync back to the workspace
const IGNORED_DIRS = new Set(['node_modules', 'dist', 'build', 'out', 'coverage', '__pycache__']);
export const MAX_SYNC_BYTES = 512 * 1024;

/**
 * Should a file the runtime changed show up in the workspace? Same rules as opening a local
 * folder: no hidden entries (.git, .next, .cache…), no dependency/build output, text files only.
 */
export function shouldSyncPath(path, isBinaryName = () => false) {
  const parts = String(path || '').split('/').filter(Boolean);
  if (!parts.length) return false;
  if (parts.some(p => p.startsWith('.') || IGNORED_DIRS.has(p))) return false;
  return !isBinaryName(parts[parts.length - 1]);
}

/** Normalise a watcher filename ("./src/a.js", "/src/a.js", "src\a.js", bytes) to "src/a.js". */
export function normalizeWatchPath(filename) {
  const text = typeof filename === 'string' ? filename : new TextDecoder().decode(filename);
  return text.replace(/\\/g, '/').replace(/^(\.\/)+/, '').replace(/^\/+/, '').replace(/\/+$/, '');
}

/** Known files removed when `path` (a file or a whole directory) disappears. */
export function removedPaths(path, knownPaths) {
  return [...knownPaths].filter(p => p === path || p.startsWith(path + '/'));
}

/** Parse package.json text; null when missing or invalid. */
export function parsePackageJson(text) {
  if (typeof text !== 'string') return null;
  try {
    const pkg = JSON.parse(text);
    return pkg && typeof pkg === 'object' && !Array.isArray(pkg) ? pkg : null;
  } catch {
    return null;
  }
}

/** The npm script that starts a dev server: dev, then start, then serve. */
export function pickDevScript(pkg) {
  const scripts = pkg?.scripts || {};
  return ['dev', 'start', 'serve'].find(name => typeof scripts[name] === 'string') || null;
}

/** Lowest major.minor a semver range can resolve to ("^15.5.0" → [15, 5]); null if unknown. */
export function minVersion(range) {
  const match = String(range || '').match(/(\d+)(?:\.(\d+))?/);
  return match ? [Number(match[1]), Number(match[2] || 0)] : null;
}

/**
 * Known incompatibilities with the in-browser runtime, as human-readable warnings.
 * Next.js after 15.4 fails to render pages there; Turbopack needs native binaries.
 */
export function compatibilityWarnings(pkg) {
  const warnings = [];
  const deps = { ...pkg?.dependencies, ...pkg?.devDependencies };
  const next = minVersion(deps.next);
  if (next && (next[0] > 15 || (next[0] === 15 && next[1] > 4))) {
    warnings.push(`Next.js ${deps.next} may fail to render pages in the browser runtime. ` +
      'Versions up to 15.4.x work — try "next": "15.4.11" in package.json.');
  }
  const script = pkg?.scripts?.[pickDevScript(pkg)] || '';
  if (/--turbo(pack)?\b/.test(script)) {
    warnings.push('Turbopack needs native binaries, which the browser runtime cannot load. Remove --turbo / --turbopack from the dev script.');
  }
  return warnings;
}

/** Rolling text log with subscribers (terminal output that survives remounts). */
export class OutputLog {
  constructor(limit = 256 * 1024) {
    this.limit = limit;
    this.text = '';
    this.listeners = new Set();
  }

  append(chunk) {
    if (!chunk) return;
    this.text += chunk;
    if (this.text.length > this.limit) this.text = this.text.slice(-this.limit);
    this.listeners.forEach(fn => fn(chunk));
  }

  clear() {
    this.text = '';
    this.listeners.forEach(fn => fn(null)); // null = reset
  }

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}

/**
 * Notices a process that stops making progress (e.g. npm install on a slow or blocked network).
 * Call activity() whenever it prints something. After `warnAfter` ms of silence onWarn() fires once
 * (onRecover() when output resumes); after `failAfter` ms, onFail(). stop() when the process ends.
 */
export function createStallWatch({ warnAfter, failAfter, onWarn, onRecover, onFail, interval = 5000, now = () => Date.now() }) {
  let last = now();
  let warned = false;
  let done = false;
  const timer = setInterval(() => {
    if (done) return;
    const idle = now() - last;
    if (idle >= failAfter) {
      done = true;
      clearInterval(timer);
      onFail?.();
    } else if (idle >= warnAfter && !warned) {
      warned = true;
      onWarn?.();
    }
  }, interval);
  return {
    activity() {
      last = now();
      if (warned && !done) { warned = false; onRecover?.(); }
    },
    stop() { done = true; clearInterval(timer); },
  };
}

/**
 * Does a chunk of terminal output show real progress? npm keeps redrawing a spinner (| / - \ or
 * braille dots) even while stuck, so spinner frames and bare cursor/erase codes don't count.
 */
export function isProgressChunk(chunk) {
  // Matching the terminal's escape character (\x1b) is the point here
  /* eslint-disable no-control-regex */
  const text = String(chunk || '')
    .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')   // ANSI CSI: colours, cursor moves, erase line
    .replace(/\x1b\][^\x07]*\x07/g, '')       // OSC (window title…)
    .replace(/[\r\b]/g, '')
    .replace(/[|/\\\-⠀-⣿]/g, '')     // spinner frames: | / - \ and braille dots
    .trim();
  /* eslint-enable no-control-regex */
  return text.length > 0;
}

// ── Package managers ───────────────────────────────────────────────
// The runtime ships npm 10, pnpm 8 and yarn 1. Yarn 2+ (Berry, Plug'n'Play) isn't supported there.
export const LOCKFILES = { npm: 'package-lock.json', pnpm: 'pnpm-lock.yaml', yarn: 'yarn.lock' };

/**
 * Which package manager a project uses: package.json's "packageManager" field, else its lockfile,
 * else npm. `files` are the workspace's `{ path, content }` records. Returns { name, lockfile, reason, warning? }.
 */
export function detectPackageManager(pkg, files = []) {
  const at = (path) => files.find(f => f.path === path);
  const berry = (text) => /^__metadata:/m.test(text || '');
  const field = String(pkg?.packageManager || '').match(/^(npm|pnpm|yarn)@(\d+)/);
  const npmFallback = (why) => ({ name: 'npm', lockfile: LOCKFILES.npm, reason: 'fallback',
    warning: `${why} isn't supported in the browser runtime, so npm is used instead (it ignores yarn.lock).` });

  if (field) {
    const [, name, major] = field;
    if (name === 'yarn' && Number(major) >= 2) return npmFallback(`Yarn ${major}`);
    return { name, lockfile: LOCKFILES[name], reason: 'packageManager field' };
  }
  if (at(LOCKFILES.pnpm)) return { name: 'pnpm', lockfile: LOCKFILES.pnpm, reason: LOCKFILES.pnpm };
  if (at(LOCKFILES.yarn)) {
    if (berry(at(LOCKFILES.yarn).content)) return npmFallback('Yarn 2+ (Berry)');
    return { name: 'yarn', lockfile: LOCKFILES.yarn, reason: LOCKFILES.yarn };
  }
  return { name: 'npm', lockfile: LOCKFILES.npm, reason: at(LOCKFILES.npm) ? LOCKFILES.npm : 'default' };
}

/** A user's choice in Settings ('auto' | 'npm' | 'pnpm' | 'yarn') applied on top of detection. */
export function choosePackageManager(override, detected) {
  if (override && override !== 'auto' && LOCKFILES[override]) {
    return { name: override, lockfile: LOCKFILES[override], reason: 'Settings' };
  }
  return detected;
}
