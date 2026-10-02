import { useCallback, useState, useRef, useEffect } from 'react';
import { appendLines, makeLine } from '../runtime/output';

const WORKER_URL = '/pyodide.worker.js';

/**
 * Python runner backed by Pyodide in a Web Worker.
 * Stop terminates the worker and spawns a fresh one (Pyodide reloads from cache).
 */
export function usePython() {
  const [isReady, setIsReady] = useState(false);
  const [output, setOutput]   = useState([]);
  const [status, setStatus]   = useState('idle');
  const workerRef = useRef(null);
  const runRef    = useRef(null); // { id, resolve, onDebugSteps, start }

  const addLines = useCallback((lines) => setOutput(prev => appendLines(prev, lines)), []);
  const addLine  = useCallback((type, text) => addLines([makeLine(type, text)]), [addLines]);

  const finish = useCallback((result) => {
    const run = runRef.current;
    if (!run) return;
    runRef.current = null;
    run.resolve(result);
  }, []);

  const handleMessage = useCallback(({ data }) => {
    if (!data) return;
    if (data.type === 'ready') { setIsReady(true); return; }
    if (data.type === 'load-error') {
      setIsReady(false);
      addLine('error', `✗ Python runtime failed to load: ${data.error}`);
      return;
    }

    const run = runRef.current;
    if (!run || data.runId !== run.id) return;

    if (data.type === 'output') {
      // The worker sends whole lines (blank lines from print() are kept)
      addLines(data.chunks.map(c => makeLine(c.stream === 'stderr' ? 'warn' : c.stream === 'system' ? 'system' : 'log', c.text)));
    } else if (data.type === 'steps') {
      run.onDebugSteps?.(data.steps);
    } else if (data.type === 'done') {
      const elapsed = (performance.now() - run.start).toFixed(1);
      const lines = [];
      if (data.ok) {
        if (data.result && data.result !== 'None') lines.push(makeLine('info', `↩ ${data.result}`));
        lines.push(makeLine('success', `✓ Completed in ${elapsed}ms`));
      } else {
        lines.push(makeLine('error', `✗ ${data.error}`));
        lines.push(makeLine('system', `Failed after ${elapsed}ms`));
      }
      addLines(lines);
      setStatus(data.ok ? 'success' : 'error');
      finish({ ok: data.ok, error: data.error });
    }
  }, [addLine, addLines, finish]);

  const spawn = useCallback(() => {
    const worker = new Worker(WORKER_URL);
    worker.onmessage = handleMessage;
    worker.onerror = (e) => {
      e.preventDefault?.();
      addLine('error', `✗ Python worker error: ${e.message || 'failed to start'}`);
      setIsReady(false);
    };
    workerRef.current = worker;
    return worker;
  }, [handleMessage, addLine]);

  useEffect(() => {
    const worker = spawn();
    return () => {
      worker.terminate();
      if (workerRef.current === worker) workerRef.current = null;
    };
  }, [spawn]);

  const runPython = useCallback((code, options = {}) => {
    const worker = workerRef.current || spawn();
    if (runRef.current) finish({ ok: false, error: 'Superseded by a new run' });

    const id = Date.now() + Math.random();
    setOutput([makeLine('system', isReady
      ? '▶ Running Python…'
      : '▶ Loading Python runtime (first run can take a few seconds)…')]);
    setStatus('running');

    return new Promise((resolve) => {
      runRef.current = { id, resolve, onDebugSteps: options.onDebugSteps, start: performance.now() };
      worker.postMessage({ type: 'run', id, code, debug: !!options.debug, stdin: options.stdin || [] });
    });
  }, [spawn, finish, isReady]);

  const stopPython = useCallback(() => {
    if (!runRef.current) return;
    workerRef.current?.terminate();
    setIsReady(false);
    spawn();
    addLine('error', '■ Execution stopped by user.');
    setStatus('error');
    finish({ ok: false, error: 'Stopped' });
  }, [spawn, addLine, finish]);

  const clearOutput = useCallback(() => {
    setOutput([]);
    setStatus(s => (s === 'running' ? s : 'idle'));
  }, []);

  return { isReady, output, status, runPython, stopPython, clearOutput };
}
