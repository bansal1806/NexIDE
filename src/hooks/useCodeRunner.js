import { useState, useCallback } from 'react';

/**
 * JavaScript/TypeScript code runner with instrumenting debug mode.
 * Captures variable state, call stack, and console output per-line.
 */
export function useCodeRunner() {
  const [output, setOutput] = useState([]);
  const [status, setStatus] = useState('idle'); // idle | running | success | error

  const addLine = (type, text) => {
    setOutput(prev => [
      ...prev,
      { id: Date.now() + Math.random(), type, text, time: new Date().toLocaleTimeString('en', { hour12: false }) },
    ]);
  };

  // ── Instrumentation helpers ────────────────────────────────────

  /**
   * Instrument JavaScript source code for time-travel recording.
   * Injects __record() calls after each executable statement.
   */
  function instrumentCode(code) {
    const lines = code.split('\n');
    const varTracker = new Set();    // All discovered variable names
    const funcTracker = [];           // Function names for call stack
    const instrumented = [];

    // Pass 1: Discover all variable names declared in the code
    for (const line of lines) {
      const trim = line.trim();

      // const/let/var declarations (including destructured)
      const declMatch = trim.match(/^(?:const|let|var)\s+(.+?)\s*=/);
      if (declMatch) {
        const lhs = declMatch[1];
        // Handle destructuring: const { a, b } = ... or const [a, b] = ...
        const destructured = lhs.match(/[{[](.*?)[}\]]/);
        if (destructured) {
          destructured[1].split(',').forEach(v => {
            const name = v.split(':').pop().trim(); // handle renaming { a: b }
            if (name && /^[\w$]+$/.test(name)) varTracker.add(name);
          });
        } else {
          const name = lhs.trim();
          if (/^[\w$]+$/.test(name)) varTracker.add(name);
        }
      }

      // for (let i = 0; ...)
      const forMatch = trim.match(/^for\s*\(\s*(?:const|let|var)\s+([\w$]+)/);
      if (forMatch) varTracker.add(forMatch[1]);

      // Function params won't be seen at top level, but arguments inside functions
      // are captured by the scope chain.

      // Assignment: x = ...
      const assignMatch = trim.match(/^([\w$]+)\s*(?:[+\-*/%]?=)[^=]/);
      if (assignMatch && !trim.startsWith('//') && !trim.startsWith('/*')) {
        varTracker.add(assignMatch[1]);
      }

      // Function declarations
      const funcMatch = trim.match(/^(?:async\s+)?function\s+([\w$]+)/);
      if (funcMatch) funcTracker.push(funcMatch[1]);
      const arrowMatch = trim.match(/^(?:const|let|var)\s+([\w$]+)\s*=\s*(?:async\s+)?(?:\([^)]*\)|[\w$]+)\s*=>/);
      if (arrowMatch) funcTracker.push(arrowMatch[1]);
    }

    // Remove common false positives
    const RESERVED = new Set([
      'console', '__record', '__enterFn', '__exitFn', 'undefined', 'null',
      'true', 'false', 'this', 'if', 'else', 'return', 'break', 'continue',
      'switch', 'case', 'default', 'new', 'delete', 'typeof', 'void',
      'throw', 'try', 'catch', 'finally', 'for', 'while', 'do', 'in', 'of',
      'class', 'extends', 'super', 'import', 'export', 'from', 'as',
      'function', 'const', 'let', 'var', 'async', 'await', 'yield',
    ]);
    RESERVED.forEach(r => varTracker.delete(r));

    const varList = Array.from(varTracker);

    // The variable capture expression
    const captureExpr = varList.length > 0
      ? `{ ${varList.map(v => `'${v}': typeof ${v} !== 'undefined' ? ${v} : undefined`).join(', ')} }`
      : '{}';

    // Pass 2: Instrument each line
    let insideMlComment = false;

    for (let i = 0; i < lines.length; i++) {
      const line    = lines[i];
      const trim    = line.trim();
      const lineNum = i + 1;

      // Track multi-line comments
      if (!insideMlComment && trim.startsWith('/*')) insideMlComment = true;
      if (insideMlComment) {
        instrumented.push(line);
        if (trim.includes('*/')) insideMlComment = false;
        continue;
      }

      // Skip: blank lines, single-line comments, import/export
      if (!trim || trim.startsWith('//') || trim.startsWith('import ') || trim.startsWith('export default') || trim.startsWith('export {')) {
        instrumented.push(line);
        continue;
      }

      // Track function entry/exit for call stack
      const funcDeclMatch = trim.match(/^(?:async\s+)?function\s+([\w$]+)/);
      const arrowDeclMatch = trim.match(/^(?:const|let|var)\s+([\w$]+)\s*=\s*(?:async\s+)?(?:\([^)]*\)|[\w$]+)\s*=>/);

      if (funcDeclMatch || arrowDeclMatch) {
        // Inject entry tracking after the opening brace
        instrumented.push(line);
        // We'll rely on the record calls to track execution flow
        continue;
      }

      // Skip lines that are just closing braces, opening braces, else, etc
      if (/^[{})\]]+[;,]?$/.test(trim) || /^(?:else|else\s*\{|}\s*else\s*\{?)$/.test(trim)) {
        instrumented.push(line);
        continue;
      }

      // Skip lines that would cause issues (template literal middles, etc)
      if (trim.startsWith('`') || trim.endsWith('`') || trim.startsWith('.')) {
        instrumented.push(line);
        continue;
      }

      // For control structures, inject record BEFORE the line
      if (/^(?:if|else if|while|for|switch|try|catch|finally)\s*[({]/.test(trim)) {
        instrumented.push(`__record(${lineNum}, ${captureExpr}); ${line}`);
        continue;
      }

      // For return statements, record then return
      if (trim.startsWith('return ') || trim === 'return;' || trim === 'return') {
        const indent = line.match(/^(\s*)/)[1];
        instrumented.push(`${indent}__record(${lineNum}, ${captureExpr});`);
        instrumented.push(line);
        continue;
      }

      // Default: append record after the line
      const endsWithBrace = trim.endsWith('{') || trim.endsWith('(') || trim.endsWith(',');
      if (endsWithBrace) {
        instrumented.push(line);
        continue;
      }

      instrumented.push(`${line}; __record(${lineNum}, ${captureExpr});`);
    }

    return instrumented.join('\n');
  }

  // ── Run JavaScript ──────────────────────────────────────────────

  const runJS = useCallback((code, options = {}) => {
    setOutput([]);
    setStatus('running');

    const startTime = performance.now();
    if (!options?.debug) {
      addLine('system', '▶ Running JavaScript...');
    } else {
      addLine('system', '🔮 Time-Travel Debug — recording execution...');
    }

    try {
      // Capture console methods
      const logs = [];
      const fakeConsole = {
        log:   (...args) => logs.push({ type: 'log',   text: args.map(safeStringify).join(' ') }),
        info:  (...args) => logs.push({ type: 'info',  text: args.map(safeStringify).join(' ') }),
        warn:  (...args) => logs.push({ type: 'warn',  text: args.map(safeStringify).join(' ') }),
        error: (...args) => logs.push({ type: 'error', text: args.map(safeStringify).join(' ') }),
        table: (...args) => logs.push({ type: 'info',  text: args.map(safeStringify).join(' ') }),
        debug: (...args) => logs.push({ type: 'log',   text: args.map(safeStringify).join(' ') }),
      };

      if (options?.debug) {
        const instrumented = instrumentCode(code);
        let stepCount = 0;
        const MAX_STEPS = 10000; // Safety valve

        const __record = (line, state) => {
          stepCount++;
          if (stepCount > MAX_STEPS) {
            throw new Error(`Debugger: exceeded ${MAX_STEPS} steps — possible infinite loop.`);
          }

          // Clean state: remove undefineds
          const cleanState = {};
          for (const k in state) {
            if (state[k] !== undefined) {
              // Deep-clone to snapshot values at this point in time
              try {
                cleanState[k] = JSON.parse(JSON.stringify(state[k]));
              } catch {
                cleanState[k] = String(state[k]);
              }
            }
          }

          if (options.onDebugStep) {
            options.onDebugStep({
              line,
              state: cleanState,
              consoleOutput: logs.length > 0 ? logs[logs.length - 1]?.text : null,
            });
          }
        };

        const fn = new Function('console', '__record', instrumented);
        fn(fakeConsole, __record);

        addLine('system', `⏱ Recorded ${stepCount} execution steps`);
      } else {
        const fn = new Function('console', code);
        fn(fakeConsole);
      }

      const elapsed = (performance.now() - startTime).toFixed(1);

      if (logs.length === 0 && !options?.debug) {
        addLine('system', '(no output)');
      } else {
        logs.forEach(l => addLine(l.type, l.text));
      }

      addLine('success', `✓ Completed in ${elapsed}ms`);
      setStatus('success');
    } catch (err) {
      const elapsed = (performance.now() - startTime).toFixed(1);
      addLine('error', `✗ ${err.name}: ${err.message}`);
      if (err.stack) {
        const stackLine = err.stack.split('\n')[1]?.trim();
        if (stackLine) addLine('error', `  ${stackLine}`);
      }
      addLine('system', `Failed after ${elapsed}ms`);
      setStatus('error');
    }
  }, []);

  // ── Simulated Python runner ─────────────────────────────────────

  const runPython = useCallback((code) => {
    setOutput([]);
    setStatus('running');
    addLine('system', '▶ Python execution (simulated in browser)...');

    setTimeout(() => {
      const lines = code.split('\n');
      let hasOutput = false;

      lines.forEach(line => {
        const trim = line.trim();
        const printMatch = trim.match(/^print\((.+)\)$/);
        if (printMatch) {
          hasOutput = true;
          let val = printMatch[1];
          val = val.replace(/^['"]|['"]$/g, '');
          addLine('log', val);
        }
      });

      if (!hasOutput) {
        addLine('system', '(no print() output)');
      }

      addLine('info', '⚠ Note: Full Python execution requires a backend. Running in simulation mode.');
      setStatus('success');
    }, 300);
  }, []);

  // ── Unified runner ──────────────────────────────────────────────

  const runCode = useCallback((code, language, options = {}) => {
    if (language === 'javascript' || language === 'typescript') {
      runJS(code, options);
    } else if (language === 'python') {
      runPython(code, options);
    } else {
      setOutput([]);
      setStatus('idle');
      addLine('warn', `⚠ Execution not supported for ${language} in browser mode.`);
      addLine('info', 'JavaScript and Python (simulated) are supported.');
    }
  }, [runJS, runPython]);

  const clearOutput = useCallback(() => {
    setOutput([]);
    setStatus('idle');
  }, []);

  const addConsoleMessage = useCallback((type, text) => {
    addLine(type, text);
  }, []);

  return { output, status, runCode, clearOutput, addConsoleMessage };
}

function safeStringify(val) {
  if (val === null) return 'null';
  if (val === undefined) return 'undefined';
  if (typeof val === 'object') {
    try { return JSON.stringify(val, null, 2); }
    catch { return String(val); }
  }
  return String(val);
}
