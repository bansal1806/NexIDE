// public/pyodide.worker.js
/* global loadPyodide */

// Runs Pyodide in a separate thread so infinite loops don't freeze the UI.
// The main thread terminates and respawns this worker to stop a run.

// Must match the `pyodide` npm package (checked by tests/pyodideVersion.test.js).
const PYODIDE_VERSION = '0.28.3';
// Core runtime is self-hosted (vite.config.js copies it from node_modules/pyodide)…
const PYODIDE_URL = `/pyodide/v${PYODIDE_VERSION}/`;
// …optional packages (numpy, pandas, …) are fetched from the official distribution.
const PACKAGE_BASE_URL = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;
const MAX_STEPS = 10000;
const FLUSH_MS = 50;

importScripts(`${PYODIDE_URL}pyodide.js`);

let currentRunId = null;
let outBuffer = [];
let stepBuffer = [];
let flushTimer = null;

function flush() {
  flushTimer = null;
  if (outBuffer.length) {
    self.postMessage({ type: 'output', runId: currentRunId, chunks: outBuffer });
    outBuffer = [];
  }
  if (stepBuffer.length) {
    self.postMessage({ type: 'steps', runId: currentRunId, steps: stepBuffer });
    stepBuffer = [];
  }
}

function scheduleFlush() {
  if (!flushTimer) flushTimer = setTimeout(flush, FLUSH_MS);
}

// print() issues several write() calls per line; buffer per stream and emit whole lines
const partial = { stdout: '', stderr: '' };

function flushPartialLines() {
  for (const stream of Object.keys(partial)) {
    if (partial[stream]) outBuffer.push({ stream, text: partial[stream] });
    partial[stream] = '';
  }
}

// Called from Python (plain strings cross the boundary without proxies)
self.nexideOutput = (stream, text) => {
  const lines = (partial[stream] + text).split('\n');
  partial[stream] = lines.pop();
  for (const line of lines) outBuffer.push({ stream, text: line });
  if (partial[stream].length > 10_000) flushPartialLines();
  scheduleFlush();
};

self.nexideStep = (line, localsJson, stackJson) => {
  stepBuffer.push({ line, state: JSON.parse(localsJson), callStack: JSON.parse(stackJson) });
  if (stepBuffer.length >= 250) flush(); else scheduleFlush();
};

const BOOTSTRAP = `
import sys, io, json, types, js

class _NxWriter(io.TextIOBase):
    def __init__(self, stream):
        self._stream = stream
    def writable(self):
        return True
    def write(self, s):
        if s:
            js.nexideOutput(self._stream, s)
        return len(s)
    def flush(self):
        pass

sys.stdout = _NxWriter('stdout')
sys.stderr = _NxWriter('stderr')

_nx_steps = 0
_NX_MAX = ${MAX_STEPS}

def _nx_json(v, depth=0):
    if v is None or isinstance(v, (bool, int, float)):
        if isinstance(v, float) and (v != v or v in (float('inf'), float('-inf'))):
            return repr(v)
        if isinstance(v, int) and not isinstance(v, bool) and abs(v) > 2**53:
            return repr(v)
        return v
    if isinstance(v, str):
        return v if len(v) <= 500 else v[:500] + '…'
    if depth < 3:
        if isinstance(v, (list, tuple, set, frozenset)):
            return [_nx_json(x, depth + 1) for x in list(v)[:100]]
        if isinstance(v, dict):
            return {str(k): _nx_json(x, depth + 1) for k, x in list(v.items())[:100]}
    try:
        r = repr(v)
    except Exception:
        r = '<unrepresentable>'
    return r if len(r) <= 500 else r[:500] + '…'

def _nx_trace(frame, event, arg):
    global _nx_steps
    if frame.f_code.co_filename != '<exec>':
        return None
    if event == 'line':
        _nx_steps += 1
        if _nx_steps > _NX_MAX:
            sys.settrace(None)
            raise RuntimeError(f'Debugger: exceeded {_NX_MAX} steps — possible infinite loop.')
        local_vars = {}
        for k, v in frame.f_locals.items():
            if k.startswith('__') or isinstance(v, types.ModuleType):
                continue
            local_vars[k] = _nx_json(v)
        stack = []
        f = frame
        while f is not None:
            if f.f_code.co_filename == '<exec>':
                name = f.f_code.co_name
                stack.append({'name': '(module)' if name == '<module>' else name, 'line': f.f_lineno})
            f = f.f_back
        stack.reverse()
        js.nexideStep(frame.f_lineno, json.dumps(local_vars), json.dumps(stack))
    return _nx_trace

def _nx_start(debug):
    global _nx_steps
    _nx_steps = 0
    sys.settrace(_nx_trace if debug else None)

def _nx_stop():
    sys.settrace(None)

_NX_WS = '/home/pyodide/workspace'

def _nx_sync_files(files, entry_path):
    """Mirror the workspace into the virtual FS so 'import helper' and open('data.csv') work."""
    import os, shutil, importlib
    # The previous run left the cwd inside the workspace; a busy cwd can't be removed
    os.chdir('/home/pyodide')
    if os.path.isdir(_NX_WS):
        shutil.rmtree(_NX_WS)
    os.makedirs(_NX_WS, exist_ok=True)
    for path, content in files.items():
        full = os.path.normpath(os.path.join(_NX_WS, path))
        if not full.startswith(_NX_WS + '/'):
            continue  # ignore anything escaping the workspace
        os.makedirs(os.path.dirname(full), exist_ok=True)
        with open(full, 'w', encoding='utf-8') as f:
            f.write(content)
    os.chdir(_NX_WS)
    # Like "python path/to/main.py": the script's directory comes first on sys.path
    entry_dir = os.path.normpath(os.path.join(_NX_WS, os.path.dirname(entry_path or '')))
    for p in (_NX_WS, entry_dir):
        while p in sys.path:
            sys.path.remove(p)
    sys.path[:0] = [entry_dir] if entry_dir == _NX_WS else [entry_dir, _NX_WS]
    # Re-import edited workspace modules on every run
    for name, mod in list(sys.modules.items()):
        if (getattr(mod, '__file__', None) or '').startswith(_NX_WS):
            del sys.modules[name]
    importlib.invalidate_caches()

def _nx_short_repr(v):
    try:
        r = repr(v)
    except Exception:
        r = '<unrepresentable>'
    return r if len(r) <= 2000 else r[:2000] + '…'

async def _nx_run(source, ns, debug):
    """Run user code; returns [ok, payload] where payload is the last-expression repr or a traceback."""
    from pyodide.code import eval_code_async
    import traceback
    _nx_start(debug)
    try:
        value = await eval_code_async(source, ns, filename='<exec>')
        return [True, None if value is None else _nx_short_repr(value)]
    except BaseException as e:
        _nx_stop()
        tb = e.__traceback__
        # Skip Pyodide's internal frames: start at the first frame of the user's code
        while tb is not None and tb.tb_frame.f_code.co_filename != '<exec>':
            tb = tb.tb_next
        text = ''.join(traceback.format_exception(type(e), e, tb)).rstrip()
        if isinstance(e, EOFError):
            text += "\\n(Hint: input ended. Answer at the console prompt, or pre-fill the Console's Input box — one line per input() call.)"
        return [False, text]
    finally:
        _nx_stop()
`;

// Same as readStdinBlocking in src/runtime/stdinChannel.js (this file is served as-is, not bundled).
function readStdinBlocking(sab, request) {
  const ctl = new Int32Array(sab, 0, 2);
  Atomics.store(ctl, 0, 0);
  request();
  Atomics.wait(ctl, 0, 0);
  const length = Atomics.load(ctl, 1);
  if (length < 0) return null;
  return new TextDecoder().decode(new Uint8Array(sab, 8, length).slice());
}

// Same as src/runtime/lockdown.js (this file is served as-is, not bundled).
// Python code can reach JS globals through the `js` module, so remove origin storage
// and worker-spawning APIs from every prototype before any user code runs.
function lockdownWorkerScope(scope) {
  const removeEverywhere = (obj, name) => {
    for (let o = obj; o; o = Object.getPrototypeOf(o)) {
      const desc = Object.getOwnPropertyDescriptor(o, name);
      if (!desc) continue;
      if (desc.configurable) delete o[name];
      else if (desc.writable) o[name] = undefined;
    }
  };
  ['indexedDB', 'caches', 'Worker', 'SharedWorker', 'BroadcastChannel', 'cookieStore']
    .forEach(name => removeEverywhere(scope, name));
  ['storage', 'serviceWorker'].forEach(name => removeEverywhere(scope.navigator, name));
}

const pyodideReady = (async () => {
  const pyodide = await loadPyodide({ indexURL: PYODIDE_URL, packageBaseUrl: PACKAGE_BASE_URL });
  lockdownWorkerScope(self);
  // A distinct filename keeps the debugger's tracer away from these helpers
  pyodide.runPython(BOOTSTRAP, { filename: '<nexide>' });
  return {
    pyodide,
    newDict: pyodide.globals.get('dict'),
    nxRun: pyodide.globals.get('_nx_run'),
    nxSyncFiles: pyodide.globals.get('_nx_sync_files'),
  };
})();

pyodideReady.then(
  () => self.postMessage({ type: 'ready' }),
  (err) => self.postMessage({ type: 'load-error', error: String(err?.message || err) }),
);

self.onmessage = async (event) => {
  const { type, id, code, debug = false, stdin = [], files = {}, path = 'main.py', stdinSab = null } = event.data || {};
  if (type !== 'run') return;
  currentRunId = id;

  let py;
  try {
    py = await pyodideReady;
  } catch (err) {
    self.postMessage({ type: 'done', runId: id, ok: false, error: `Failed to load Python: ${err?.message || err}` });
    return;
  }

  // Install packages the code imports (numpy, pandas, …) from the Pyodide distribution
  try {
    await py.pyodide.loadPackagesFromImports(code, {
      messageCallback: (msg) => { if (/^Loading|^Loaded/.test(msg)) outBuffer.push({ stream: 'system', text: msg }); scheduleFlush(); },
      errorCallback: (msg) => { outBuffer.push({ stream: 'stderr', text: msg }); scheduleFlush(); },
    });
  } catch (err) {
    // Unknown imports surface as a normal ModuleNotFoundError when the code runs
    outBuffer.push({ stream: 'stderr', text: `Package install failed: ${err?.message || err}` });
  }

  // Program input: pre-filled Input-box lines first, then (if the page is cross-origin
  // isolated) ask interactively and block until answered. Echoed like a terminal would.
  const lines = Array.isArray(stdin) ? stdin.slice() : [];
  const nextLine = () => {
    if (lines.length) {
      const line = String(lines.shift());
      self.nexideOutput('stdout', line + '\n');
      return line;
    }
    if (!stdinSab) return null;
    // input("Name? ") already wrote its prompt; send it with the request, echo with the answer
    const promptText = partial.stdout;
    partial.stdout = '';
    const line = readStdinBlocking(stdinSab, () => {
      flush();
      self.postMessage({ type: 'stdin-request', runId: id, prompt: promptText });
    });
    outBuffer.push({ stream: 'stdout', text: promptText + (line ?? '') });
    scheduleFlush();
    return line;
  };

  // Low-level read(): called once per read syscall, so input() asks for exactly one line.
  // (The higher-level `stdin` callback is polled until a buffer fills, which asked the user
  // for the next line before the program needed it.)
  let pendingBytes = new Uint8Array(0);
  const encoder = new TextEncoder();
  py.pyodide.setStdin({
    isatty: true,
    read(buffer) {
      if (!pendingBytes.length) {
        const line = nextLine();
        if (line === null) return 0; // EOF → EOFError in Python
        pendingBytes = encoder.encode(line + '\n');
      }
      const n = Math.min(buffer.length, pendingBytes.length);
      buffer.set(pendingBytes.subarray(0, n));
      pendingBytes = pendingBytes.subarray(n);
      return n;
    },
  });

  // Workspace files → virtual FS (imports between .py files, reading data files)
  try {
    const pyFiles = py.pyodide.toPy(files);
    py.nxSyncFiles(pyFiles, path);
    pyFiles.destroy();
  } catch (err) {
    outBuffer.push({ stream: 'stderr', text: `Could not load workspace files: ${err?.message || err}` });
  }

  // Fresh namespace per run: no state leaks between runs, and helper names stay hidden
  const namespace = py.newDict();
  namespace.set('__name__', '__main__');
  let ok = false;
  let payload = null;
  try {
    const res = await py.nxRun(code, namespace, debug);
    [ok, payload] = res.toJs();
    res.destroy();
  } catch (err) {
    payload = String(err?.message || err);
  } finally {
    namespace.destroy();
  }
  flushPartialLines();
  flush();
  self.postMessage({ type: 'done', runId: id, ok, error: ok ? null : payload, result: ok ? payload : null });
};
