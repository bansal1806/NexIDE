// Runs user JavaScript/TypeScript off the main thread.
// A worker has no DOM, no localStorage and no access to the app's session token,
// and the main thread can terminate() it at any time (infinite loops, Stop button).
import { executeJs } from './executeJs';
import { transpileTS } from './transpile';
import { lockdownWorkerScope } from './lockdown';

// Before any user code can run (each run gets a fresh worker)
lockdownWorkerScope(self);

const LOG_FLUSH_MS = 50;
let runId = null;
let logBuffer = [];
let flushTimer = null;

function flushLogs() {
  flushTimer = null;
  if (!logBuffer.length) return;
  self.postMessage({ type: 'logs', runId, lines: logBuffer });
  logBuffer = [];
}

function onLog(type, text) {
  logBuffer.push({ type, text });
  if (!flushTimer) flushTimer = setTimeout(flushLogs, LOG_FLUSH_MS);
}

self.onmessage = async (event) => {
  const { type, id, code, language, debug, maxSteps } = event.data || {};
  if (type !== 'run') return;

  // Program input for prompt(): one line per call, echoed like a terminal; null at EOF
  const stdinLines = Array.isArray(event.data.stdin) ? event.data.stdin.slice() : [];
  self.prompt = (message = '') => {
    const value = stdinLines.length ? String(stdinLines.shift()) : null;
    onLog('log', `${message}${value ?? '(no input)'}`);
    return value;
  };

  runId = id;
  const start = performance.now();

  let source = code;
  if (language === 'typescript') {
    try {
      source = transpileTS(code);
    } catch (err) {
      self.postMessage({ type: 'done', runId, ok: false, error: `TypeScript: ${err.message}`, elapsed: 0, steps: 0 });
      return;
    }
  }

  const result = await executeJs(source, {
    debug,
    maxSteps,
    onLog,
    onSteps: steps => self.postMessage({ type: 'steps', runId, steps }),
  });

  flushLogs();
  self.postMessage({ type: 'done', runId, ...result, elapsed: performance.now() - start });
};
