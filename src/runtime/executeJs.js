import { checkSyntax, instrumentJS } from './instrument';
import { usesModules, toCommonJS, createModuleSystem, collectBareImports, isValidPackageSpec, loadPinnedPackage } from './modules';

const CAP_MISSING = Symbol('missing');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

export const DEFAULT_MAX_STEPS = 10000;
const STEP_BATCH = 250;
const MAX_DEPTH = 4;
const MAX_ITEMS = 100;

/** Human-readable console formatting (handles circular refs, Map/Set, errors, functions…). */
export function formatValue(value, depth = 0, seen = new WeakSet()) {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  const t = typeof value;
  if (t === 'string') return depth === 0 ? value : JSON.stringify(value);
  if (t === 'number' || t === 'boolean') return String(value);
  if (t === 'bigint') return `${value}n`;
  if (t === 'symbol') return value.toString();
  if (t === 'function') return `ƒ ${value.name || '(anonymous)'}()`;
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  if (seen.has(value)) return '[Circular]';
  if (depth >= MAX_DEPTH) return Array.isArray(value) ? '[Array]' : '[Object]';
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      const items = value.slice(0, MAX_ITEMS).map(v => formatValue(v, depth + 1, seen));
      if (value.length > MAX_ITEMS) items.push(`… ${value.length - MAX_ITEMS} more`);
      return `[${items.join(', ')}]`;
    }
    if (value instanceof Map) {
      const items = Array.from(value).slice(0, MAX_ITEMS)
        .map(([k, v]) => `${formatValue(k, depth + 1, seen)} => ${formatValue(v, depth + 1, seen)}`);
      return `Map(${value.size}) {${items.join(', ')}}`;
    }
    if (value instanceof Set) {
      const items = Array.from(value).slice(0, MAX_ITEMS).map(v => formatValue(v, depth + 1, seen));
      return `Set(${value.size}) {${items.join(', ')}}`;
    }
    if (value instanceof Date) return value.toISOString();
    if (value instanceof RegExp) return value.toString();
    const entries = Object.entries(value).slice(0, MAX_ITEMS)
      .map(([k, v]) => `${k}: ${formatValue(v, depth + 1, seen)}`);
    const name = value.constructor && value.constructor !== Object ? `${value.constructor.name} ` : '';
    return `${name}{${entries.join(', ')}}`;
  } finally {
    seen.delete(value);
  }
}

/** JSON-compatible snapshot of a value for the variable inspector. */
export function snapshotValue(value, depth = 0, seen = new WeakSet()) {
  const t = typeof value;
  if (value === null || t === 'string' || t === 'boolean') return value;
  if (t === 'number') return Number.isFinite(value) ? value : String(value);
  if (t === 'bigint') return `${value}n`;
  if (t === 'symbol') return value.toString();
  if (t === 'function') return `ƒ ${value.name || '(anonymous)'}()`;
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  if (seen.has(value)) return '[Circular]';
  if (depth >= MAX_DEPTH) return Array.isArray(value) ? '[Array]' : '[Object]';
  seen.add(value);
  try {
    if (Array.isArray(value)) return value.slice(0, MAX_ITEMS).map(v => snapshotValue(v, depth + 1, seen) ?? null);
    if (value instanceof Map) {
      const obj = {};
      Array.from(value).slice(0, MAX_ITEMS).forEach(([k, v]) => { obj[formatValue(k)] = snapshotValue(v, depth + 1, seen); });
      return obj;
    }
    if (value instanceof Set) return Array.from(value).slice(0, MAX_ITEMS).map(v => snapshotValue(v, depth + 1, seen));
    if (value instanceof Date) return value.toISOString();
    if (value instanceof RegExp) return value.toString();
    const obj = {};
    for (const [k, v] of Object.entries(value).slice(0, MAX_ITEMS)) {
      const s = snapshotValue(v, depth + 1, seen);
      if (s !== undefined) obj[k] = s;
    }
    return obj;
  } finally {
    seen.delete(value);
  }
}

/** Best-effort line number of a runtime error inside the generated function. */
export function errorLine(err) {
  const stack = String(err?.stack || '');
  // V8: "at eval (eval at …, <anonymous>:5:3)"; Firefox: "anonymous@…Function:5:3"
  const m = stack.match(/<anonymous>:(\d+):\d+/) || stack.match(/Function:(\d+):\d+/);
  if (!m) return null;
  const line = Number(m[1]) - 2; // the Function constructor adds a 2-line header
  return line > 0 ? line : null;
}

function makeConsole(emit) {
  const counters = {};
  const timers = {};
  const fmt = args => args.map(a => formatValue(a)).join(' ');
  return {
    log:   (...a) => emit('log', fmt(a)),
    info:  (...a) => emit('info', fmt(a)),
    warn:  (...a) => emit('warn', fmt(a)),
    error: (...a) => emit('error', fmt(a)),
    debug: (...a) => emit('log', fmt(a)),
    trace: (...a) => emit('log', fmt(a)),
    dir:   (v) => emit('log', formatValue(v, 1)),
    table: (v) => emit('info', formatValue(v, 1)),
    assert: (cond, ...a) => { if (!cond) emit('error', `Assertion failed${a.length ? ': ' + fmt(a) : ''}`); },
    count: (label = 'default') => { counters[label] = (counters[label] || 0) + 1; emit('log', `${label}: ${counters[label]}`); },
    countReset: (label = 'default') => { counters[label] = 0; },
    time: (label = 'default') => { timers[label] = Date.now(); },
    timeEnd: (label = 'default') => {
      if (timers[label] !== undefined) { emit('log', `${label}: ${Date.now() - timers[label]}ms`); delete timers[label]; }
    },
    group: (...a) => { if (a.length) emit('log', fmt(a)); },
    groupEnd: () => {},
    clear: () => {},
  };
}

/**
 * Execute JavaScript (already transpiled from TS if needed).
 *
 * @param {string} code
 * @param {object} opts
 * @param {boolean} [opts.debug]
 * @param {number}  [opts.maxSteps]
 * @param {(type: string, text: string) => void} opts.onLog
 * @param {(steps: object[]) => void} [opts.onSteps]  batches of debug snapshots
 * @param {string} [opts.path]   entry file path (resolves relative imports)
 * @param {Record<string, string>} [opts.files]  workspace files available to `import`
 * @returns {Promise<{ ok: boolean, error?: string, line?: number|null, steps: number }>}
 */
export async function executeJs(code, {
  debug = false, maxSteps = DEFAULT_MAX_STEPS, onLog, onSteps, path = 'main.js', files = {},
  loadPackage = loadPinnedPackage, // (spec, lockedId) → { id, namespace, fromLock }
  packageLock = {},                  // spec → exact esm.sh id, per workspace
} = {}) {
  let lastLog = null;
  const emit = (type, text) => { lastLog = text; onLog?.(type, text); };
  const fakeConsole = makeConsole(emit);

  // import/export → CommonJS + workspace require() (only when the code uses modules, so plain
  // scripts can still declare their own `require` / `module` / `exports`)
  const isModule = usesModules(code);
  if (isModule) {
    try {
      checkSyntax(code, 'module');
    } catch (err) {
      return { ok: false, error: `SyntaxError: ${err.message}`, line: err.loc?.line ?? null, steps: 0 };
    }
  }

  // npm packages: fetch every bare import up front (require() is synchronous)
  const packages = {};
  const pins = {}; // returned so the app can persist the workspace's package lock
  if (isModule) {
    for (const spec of collectBareImports(code, path, files)) {
      if (!isValidPackageSpec(spec)) {
        return { ok: false, error: `Invalid package name "${spec}"`, line: null, steps: 0 };
      }
      try {
        const { id, namespace, fromLock } = await loadPackage(spec, packageLock[spec]);
        packages[spec] = namespace;
        pins[spec] = id;
        emit('system', fromLock ? `📦 ${id}` : `📦 ${spec} → ${id} (pinned for this workspace)`);
      } catch (err) {
        return { ok: false, error: `Could not load package "${spec}" from esm.sh: ${err?.message || err}`, line: null, steps: 0 };
      }
    }
  }

  // ── Debug recording (one set of helpers per file, so steps know where they are) ──
  let stepCount = 0;
  let pending = [];
  const callStack = [];
  const flush = () => {
    if (pending.length && onSteps) onSteps(pending);
    pending = [];
  };

  const makeHelpers = (file) => ({
    __record(line, state) {
      if (++stepCount > maxSteps) {
        throw new Error(`Debugger: exceeded ${maxSteps} steps — possible infinite loop.`);
      }
      const clean = {};
      for (const k of Object.keys(state)) {
        const v = state[k];
        if (v === CAP_MISSING || v === undefined) continue;
        clean[k] = snapshotValue(v);
      }
      pending.push({
        file,
        line,
        state: clean,
        callStack: callStack.map(f => ({ ...f })),
        consoleOutput: lastLog,
      });
      if (pending.length >= STEP_BATCH) flush();
    },
    __cap(getter) {
      try { return getter(); } catch { return CAP_MISSING; }
    },
    __enter(name, line) { callStack.push({ name, line, file }); },
    __exit() { callStack.pop(); },
    __exitWith(value) { callStack.pop(); return value; },
  });

  let moduleScope = null;
  let source;
  try {
    let script = code;
    if (isModule) {
      script = toCommonJS(code, path.replace(/\.(ts|mts|cts)$/, '.js'));
      moduleScope = createModuleSystem(files, fakeConsole, packages,
        debug ? { instrument: instrumentJS, helpersFor: makeHelpers } : null).entry(path);
    }
    source = debug ? instrumentJS(script) : (checkSyntax(script), script);
  } catch (err) {
    return { ok: false, error: `SyntaxError: ${err.message}`, line: err.loc?.line ?? null, steps: 0 };
  }

  try {
    const scope = { console: fakeConsole, ...(moduleScope || {}), ...makeHelpers(path) };
    const fn = new AsyncFunction(...Object.keys(scope), source);
    await fn(...Object.values(scope));
    flush();
    return { ok: true, steps: stepCount, pins };
  } catch (err) {
    flush();
    const name = err?.name || 'Error';
    const message = err?.message ?? String(err);
    return { ok: false, error: `${name}: ${message}`, line: errorLine(err), steps: stepCount, pins };
  }
}

