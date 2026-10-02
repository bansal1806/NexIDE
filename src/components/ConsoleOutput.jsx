import { useRef, useEffect, useState } from 'react';
import { Trash2, Terminal, Keyboard } from 'lucide-react';
// eslint-disable-next-line no-unused-vars
import { motion, AnimatePresence } from 'framer-motion';
import { stdinLines } from '../runtime/output';

// Shown while the running program waits in input() / prompt()
function InputPrompt({ request, onSubmit, onEof }) {
  const [value, setValue] = useState('');
  const handleKeyDown = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); onSubmit(value); setValue(''); }
    else if (e.key === 'd' && e.ctrlKey) { e.preventDefault(); onEof(); }
  };
  return (
    <div className="console-line console-input-row" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span className="console-line-prefix" aria-hidden="true">⌨</span>
      {request.prompt && <pre className="console-line-text" style={{ margin: 0 }}>{request.prompt}</pre>}
      <input
        id="console-input-line"
        autoFocus
        value={value}
        onChange={e => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        aria-label={`Program input${request.prompt ? `: ${request.prompt}` : ''}`}
        placeholder="type input, Enter to send · Ctrl+D for EOF"
        spellCheck={false}
        autoComplete="off"
        style={{
          flex: 1, minWidth: 0, background: 'transparent', border: 'none', outline: 'none',
          borderBottom: '1px solid var(--accent-cyan)', color: 'var(--text-primary)',
          fontFamily: 'var(--font-mono)', fontSize: 12, padding: '2px 0',
        }}
      />
      <button className="btn-clear" onClick={onEof} title="End of input (Ctrl+D)" id="btn-console-eof">EOF</button>
    </div>
  );
}

export function ConsoleOutput({ lines, onClear, stdin = '', onStdinChange, inputRequest = null, onSubmitInput, onEndInput }) {
  const bottomRef = useRef(null);
  const [showInput, setShowInput] = useState(!!stdin);
  const inputCount = stdinLines(stdin).length;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [lines]);

  return (
    <div className="console-output" id="console-panel">
      <div className="console-toolbar">
        <Terminal size={12} aria-hidden="true" />
        <span className="console-toolbar-label">Console</span>

        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
          {lines.length > 0 && `${lines.length} line${lines.length !== 1 ? 's' : ''}`}
        </span>

        <button
          id="btn-clear-console"
          className="btn-clear"
          onClick={onClear}
          aria-label="Clear console"
          disabled={lines.length === 0}
        >
          <Trash2 size={10} />
          Clear
        </button>

        {onStdinChange && (
          <button
            id="btn-toggle-stdin"
            className={`btn-clear ${showInput ? 'active' : ''}`}
            onClick={() => setShowInput(v => !v)}
            aria-expanded={showInput}
            aria-controls="console-stdin"
            title="Program input: one line per input() / prompt() call"
          >
            <Keyboard size={10} />
            Input{inputCount > 0 ? ` (${inputCount})` : ''}
          </button>
        )}
      </div>

      {showInput && onStdinChange && (
        <textarea
          id="console-stdin"
          className="console-stdin"
          value={stdin}
          onChange={e => onStdinChange(e.target.value)}
          placeholder="Program input (stdin): one line per input() / prompt() call"
          spellCheck={false}
          rows={3}
          aria-label="Program input"
          style={{
            width: '100%', resize: 'vertical', boxSizing: 'border-box',
            background: 'var(--bg-elevated)', color: 'var(--text-primary)',
            border: 'none', borderBottom: '1px solid var(--border)',
            padding: '6px 10px', fontFamily: 'var(--font-mono)', fontSize: 12, outline: 'none',
          }}
        />
      )}

      <div className="console-lines" aria-live="polite" aria-label="Console output" role="log" tabIndex={0}>
        {lines.length === 0 ? (
          <div className="console-empty">
            <span className="console-empty-icon">▶</span>
            <span>Run your code to see output here</span>
            <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>Ctrl+Enter or click Run</span>
          </div>
        ) : (
          <AnimatePresence initial={false}>
            {lines.map(line => (
              <motion.div
                key={line.id}
                className={`console-line ${line.type}`}
                initial={{ opacity: 0, x: -4 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.1 }}
              >
                <span className="console-timestamp">{line.time}</span>
                <span className="console-line-prefix" aria-hidden="true">
                  {line.type === 'error'   ? '✗' :
                   line.type === 'warn'    ? '⚠' :
                   line.type === 'info'    ? 'ℹ' :
                   line.type === 'success' ? '✓' :
                   line.type === 'system'  ? '·' : '>'}
                </span>
                <pre className="console-line-text">{line.text}</pre>
              </motion.div>
            ))}
          </AnimatePresence>
        )}
        {inputRequest && onSubmitInput && (
          <InputPrompt request={inputRequest} onSubmit={onSubmitInput} onEof={onEndInput} />
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
