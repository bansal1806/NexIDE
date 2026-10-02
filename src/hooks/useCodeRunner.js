import { useState, useCallback, useRef, useEffect } from 'react';
import { appendLines, makeLine } from '../runtime/output';
import { useStdinRequest } from './useStdinRequest';

/**
 * JavaScript / TypeScript runner.
 * Every run gets a fresh module Web Worker (see runtime/jsRunner.worker.js):
 * user code never touches the page's DOM, localStorage or auth session,
 * and Stop simply terminates the worker.
 */
export function useCodeRunner() {
  const [output, setOutput] = useState([]);
  const [status, setStatus] = useState('idle'); // idle | running | success | error
  const workerRef = useRef(null);
  const runRef = useRef(null); // { id, resolve, onDebugSteps }
  const stdin = useStdinRequest();
  const { open: openStdin, ask: askStdin, cancel: cancelStdin } = stdin;

  const addLines = useCallback((lines) => setOutput(prev => appendLines(prev, lines)), []);
  const addLine = useCallback((type, text) => addLines([makeLine(type, text)]), [addLines]);

  const killWorker = useCallback(() => {
    workerRef.current?.terminate();
    workerRef.current = null;
    cancelStdin();
  }, [cancelStdin]);

  useEffect(() => killWorker, [killWorker]);

  const finish = useCallback((result) => {
    const run = runRef.current;
    if (!run) return;
    runRef.current = null;
    run.resolve(result);
  }, []);

  const runCode = useCallback((code, language, options = {}) => {
    if (language !== 'javascript' && language !== 'typescript') {
      setOutput([]);
      setStatus('idle');
      addLines([
        makeLine('warn', `⚠ Execution not supported for ${language} in the browser.`),
        makeLine('info', 'Supported: JavaScript, TypeScript and Python. Use Preview for HTML/CSS.'),
      ]);
      return Promise.resolve({ ok: false });
    }

    // A new run replaces any previous one (including its pending timers)
    if (runRef.current) finish({ ok: false, error: 'Superseded by a new run' });
    killWorker();

    const id = Date.now() + Math.random();
    const debug = !!options.debug;
    setOutput([makeLine('system', debug ? '🔮 Time-Travel Debug — recording execution…' : `▶ Running ${language === 'typescript' ? 'TypeScript' : 'JavaScript'}…`)]);
    setStatus('running');

    const worker = new Worker(new URL('../runtime/jsRunner.worker.js', import.meta.url), { type: 'module' });
    workerRef.current = worker;
    const channel = openStdin();

    return new Promise((resolve) => {
      runRef.current = { id, resolve, onDebugSteps: options.onDebugSteps };

      worker.onmessage = ({ data }) => {
        if (!data || data.runId !== id) return;
        if (data.type === 'logs') {
          addLines(data.lines.map(l => makeLine(l.type, l.text)));
        } else if (data.type === 'stdin-request') {
          askStdin(data.prompt); // may also come from a timer after 'done'
        } else if (data.type === 'steps') {
          runRef.current?.onDebugSteps?.(data.steps);
        } else if (data.type === 'done') {
          const elapsed = data.elapsed.toFixed(1);
          const lines = [];
          if (data.ok) {
            if (debug) lines.push(makeLine('system', `⏱ Recorded ${data.steps} execution steps`));
            lines.push(makeLine('success', `✓ Completed in ${elapsed}ms`));
          } else {
            lines.push(makeLine('error', `✗ ${data.error}${data.line ? ` (line ${data.line})` : ''}`));
            lines.push(makeLine('system', `Failed after ${elapsed}ms`));
          }
          addLines(lines);
          setStatus(data.ok ? 'success' : 'error');
          finish({ ok: data.ok, error: data.error, line: data.line });
          // The worker stays alive so pending timers/promises can keep logging until the next run or Stop.
        }
      };

      worker.onerror = (e) => {
        e.preventDefault?.();
        addLine('error', `✗ Runner crashed: ${e.message || 'unknown error'}`);
        setStatus('error');
        killWorker();
        finish({ ok: false, error: e.message });
      };

      worker.postMessage({
        type: 'run', id, code, language, debug,
        stdin: options.stdin || [],
        path: options.path,
        files: options.files || {},
        stdinSab: channel?.sab ?? null,
      });
    });
  }, [addLine, addLines, finish, killWorker, openStdin, askStdin]);

  const stop = useCallback(() => {
    if (!workerRef.current) return;
    killWorker();
    if (runRef.current) {
      addLine('error', '■ Execution stopped by user.');
      setStatus('error');
      finish({ ok: false, error: 'Stopped' });
    } else {
      addLine('system', '■ Background timers stopped.');
    }
  }, [addLine, finish, killWorker]);

  const clearOutput = useCallback(() => {
    setOutput([]);
    setStatus(s => (s === 'running' ? s : 'idle'));
  }, []);

  const addConsoleMessage = useCallback((type, text) => addLine(type, text), [addLine]);

  return {
    output, status, runCode, stop, clearOutput, addConsoleMessage,
    inputRequest: stdin.inputRequest, submitInput: stdin.submit, endInput: stdin.eof,
  };
}
