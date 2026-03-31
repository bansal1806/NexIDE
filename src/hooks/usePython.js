import { useCallback, useState, useRef, useEffect } from 'react';

export function usePython() {
  const [isReady, setIsReady]     = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [output, setOutput]       = useState([]);
  const [status, setStatus]       = useState('idle');
  const workerRef                 = useRef(null);
  const resolveRunRef             = useRef(null);
  const onDebugStepRef           = useRef(null);

  const addLine = useCallback((type, text) => {
    setOutput(prev => {
      // Avoid adding multiple empty lines
      if (text.trim() === '' && type !== 'system') return prev;
      return [
        ...prev,
        { id: Date.now() + Math.random(), type, text, time: new Date().toLocaleTimeString('en', { hour12: false }) },
      ];
    });
  }, []);

  // Initialize Worker once
  useEffect(() => {
    const worker = new Worker('/pyodide.worker.js');
    workerRef.current = worker;
    
    worker.onmessage = (event) => {
      const data = event.data;
      if (data.__python_output) {
        // Stream stdout or stderr chunk
        const lines = data.text.split('\n');
        lines.forEach(l => {
          if (l.trim()) addLine(data.stream === 'stderr' ? 'warn' : 'log', l);
        });
      } else if (data.__debug_step) {
        // Capture a debug step
        if (onDebugStepRef.current) {
          onDebugStepRef.current({
            line: data.line,
            state: data.locals
          });
        }
      } else if (data.__python_done) {
        // Run completely finished
        if (resolveRunRef.current) {
          resolveRunRef.current(data);
          resolveRunRef.current = null;
        }
      }
    };
    
    setIsReady(true);
    return () => worker.terminate();
  }, [addLine]);

  const runPython = useCallback(async (code, options = {}) => {
    if (!workerRef.current) {
      addLine('error', '✗ Python worker not initialized.');
      setStatus('error');
      return;
    }

    setOutput([]);
    setStatus('running');
    setIsLoading(true);

    const startTime = performance.now();
    addLine('system', '▶ Running Python via Web Worker...');

    try {
      const runId = Date.now();
      const runPromise = new Promise(resolve => {
        resolveRunRef.current = resolve;
      });

      onDebugStepRef.current = options?.onDebugStep || null;

      // Send execution request to worker
      workerRef.current.postMessage({ id: runId, code, debug: !!options?.debug });

      const result = await runPromise;
      const elapsed = (performance.now() - startTime).toFixed(1);

      if (result.error) {
        addLine('error', `✗ ${result.error}`);
        addLine('system', `Failed after ${elapsed}ms`);
        setStatus('error');
      } else {
        if (result.results && result.results !== 'undefined' && result.results !== 'None') {
          addLine('info', `↩ ${result.results}`);
        }
        addLine('success', `✓ Completed in ${elapsed}ms`);
        setStatus('success');
      }
    } catch (e) {
      addLine('error', `✗ Unexpected error communicating with Python worker: ${e.message}`);
      setStatus('error');
    } finally {
      setIsLoading(false);
    }
  }, [addLine]);

  const stopPython = useCallback(() => {
    if (workerRef.current && status === 'running') {
      workerRef.current.terminate();
      workerRef.current = new Worker('/pyodide.worker.js'); // restart sterile worker bounds
      
      // Re-attach message handler for new worker
      workerRef.current.onmessage = (event) => {
        const data = event.data;
        if (data.__python_output) {
          const lines = data.text.split('\\n');
          lines.forEach(l => {
            if (l.trim()) addLine(data.stream === 'stderr' ? 'warn' : 'log', l);
          });
        } else if (data.__python_done) {
          if (resolveRunRef.current) {
            resolveRunRef.current(data);
            resolveRunRef.current = null;
          }
        }
      };

      if (resolveRunRef.current) {
        resolveRunRef.current({ error: 'Terminated by user' });
        resolveRunRef.current = null;
      }
      addLine('error', '■ Worker forcibly terminated.');
    }
  }, [status, addLine]);

  const clearOutput = useCallback(() => { setOutput([]); setStatus('idle'); }, []);

  return { isReady, isLoading, output, status, runPython, stopPython, clearOutput };
}
