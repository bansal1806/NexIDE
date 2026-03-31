import { useRef, useEffect } from 'react';
import { Trash2, Terminal } from 'lucide-react';
// eslint-disable-next-line no-unused-vars
import { motion, AnimatePresence } from 'framer-motion';

export function ConsoleOutput({ lines, onClear }) {
  const bottomRef = useRef(null);

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
      </div>

      <div className="console-lines" aria-live="polite" aria-label="Console output">
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
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
