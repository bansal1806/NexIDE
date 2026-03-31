import { useState, useRef, useCallback, useEffect, memo } from 'react';
import { Terminal as TerminalIcon, X, Minus } from 'lucide-react';

const BUILTIN_HELP = `NexIDE Terminal — supported commands:
  ls              list files
  cat <file>      print file content
  echo <text>     print text
  clear           clear terminal
  run <file>      execute file (.js, .py)
  help            show this help
`;

export const Terminal = memo(function Terminal({ open, onClose, fileTree, onRunFile, activeFilePath }) {
  const [lines, setLines]   = useState([{ type: 'system', text: '⚡ NexIDE Terminal  (type "help" for commands)' }]);
  const [input, setInput]   = useState('');
  const [history, setHistory] = useState([]);
  const [, setHistIdx] = useState(-1);
  const inputRef   = useRef(null);
  const bottomRef  = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [lines]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 100);
  }, [open]);

  const addLine = useCallback((type, text) => {
    setLines(prev => [...prev, { id: Date.now() + Math.random(), type, text }]);
  }, []);

  // Flatten fileTree to a path list
  const flattenTree = useCallback(function flatten(nodes, acc = []) {
    nodes.forEach(n => {
      acc.push(n);
      if (n.children) flatten(n.children, acc);
    });
    return acc;
  }, []);

  const executeCommand = useCallback((cmd) => {
    const parts = cmd.trim().split(/\s+/);
    const verb  = parts[0].toLowerCase();

    addLine('prompt', `$ ${cmd}`);

    if (!verb) return;

    if (verb === 'clear') { setLines([]); return; }
    if (verb === 'help')  { addLine('system', BUILTIN_HELP); return; }

    if (verb === 'echo') {
      addLine('log', parts.slice(1).join(' ') || '');
      return;
    }

    if (verb === 'ls') {
      const depth0 = (fileTree || []).map(n => (n.kind === 'directory' ? `📁 ${n.name}/` : `  ${n.name}`));
      if (depth0.length === 0) addLine('muted', '(no files)');
      else depth0.forEach(l => addLine('log', l));
      return;
    }

    if (verb === 'cat') {
      const target = parts[1];
      if (!target) { addLine('error', 'cat: missing filename'); return; }
      const all = flattenTree(fileTree || []);
      const found = all.find(n => n.name === target || n.path === target || n.path.endsWith('/' + target));
      if (!found || found.kind === 'directory') {
        addLine('error', `cat: ${target}: No such file`);
      } else {
        addLine('system', `[${found.path}]`);
        // If we have handle (local FS), we can't read synchronously, just show path
        addLine('muted', '(use the editor to view file content)');
      }
      return;
    }

    if (verb === 'run') {
      const target = parts[1] || activeFilePath;
      if (!target) { addLine('error', 'run: missing filename'); return; }
      const all = flattenTree(fileTree || []);
      const found = all.find(n => n.name === target || n.path === target);
      if (!found) {
        // Run the active/named path anyway
        addLine('system', `Running: ${target}`);
        if (onRunFile) onRunFile(target);
      } else {
        addLine('system', `Running: ${found.path}`);
        if (onRunFile) onRunFile(found.path, found);
      }
      return;
    }

    if (verb === 'cd') {
      addLine('muted', '(directory navigation is handled by the file explorer)');
      return;
    }

    addLine('error', `command not found: ${verb} — type "help" for available commands`);
  }, [addLine, fileTree, flattenTree, activeFilePath, onRunFile]);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      const cmd = input.trim();
      if (cmd) {
        setHistory(h => [cmd, ...h.slice(0, 99)]);
        setHistIdx(-1);
        executeCommand(cmd);
      }
      setInput('');
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHistIdx(i => {
        const next = Math.min(i + 1, history.length - 1);
        setInput(history[next] || '');
        return next;
      });
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHistIdx(i => {
        const next = Math.max(i - 1, -1);
        setInput(next === -1 ? '' : history[next] || '');
        return next;
      });
    }
  };

  if (!open) return null;

  return (
    <div className="terminal-panel" id="terminal-panel" role="region" aria-label="Terminal">
      <div className="terminal-header">
        <TerminalIcon size={12} aria-hidden="true" />
        <span className="terminal-title">TERMINAL</span>
        <div style={{ flex: 1 }} />
        <button className="btn-icon" style={{ width: 22, height: 22 }} onClick={() => setLines([])} title="Clear" aria-label="Clear terminal">
          <Minus size={11} />
        </button>
        <button className="btn-icon" style={{ width: 22, height: 22 }} onClick={onClose} title="Close terminal" aria-label="Close terminal" id="btn-close-terminal">
          <X size={11} />
        </button>
      </div>

      <div className="terminal-output" aria-live="polite" onClick={() => inputRef.current?.focus()}>
        {lines.map((line, i) => (
          <div key={line.id || i} className={`terminal-line terminal-${line.type || 'log'}`}>
            {line.text}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <div className="terminal-input-row">
        <span className="terminal-prompt">$</span>
        <input
          ref={inputRef}
          id="terminal-input"
          className="terminal-input"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="type a command…"
          spellCheck={false}
          autoComplete="off"
          aria-label="Terminal input"
        />
      </div>
    </div>
  );
});
