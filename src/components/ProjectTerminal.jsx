import { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

// Colours follow the active theme (CSS custom properties on .app)
function xtermTheme(el) {
  const css = getComputedStyle(el.closest('.app') || document.documentElement);
  const v = (name, fallback) => css.getPropertyValue(name).trim() || fallback;
  return {
    background: v('--bg-surface', '#241f33'),
    foreground: v('--text-primary', '#f7f3ff'),
    cursor: v('--accent-yellow', '#ffe27a'),
    cursorAccent: v('--bg-surface', '#241f33'),
    selectionBackground: '#c9b0ff55',
    black: '#3f3856', brightBlack: v('--text-muted', '#ada3c9'),
    red: v('--accent-red', '#ff8a9b'), brightRed: v('--accent-red', '#ff8a9b'),
    green: v('--accent-green', '#7df2c6'), brightGreen: v('--accent-green', '#7df2c6'),
    yellow: v('--accent-yellow', '#ffe27a'), brightYellow: v('--accent-yellow', '#ffe27a'),
    blue: v('--accent-cyan', '#8fd8ff'), brightBlue: v('--accent-cyan', '#8fd8ff'),
    magenta: v('--accent-pink', '#ff9ad1'), brightMagenta: v('--accent-pink', '#ff9ad1'),
    cyan: v('--accent-cyan', '#8fd8ff'), brightCyan: v('--accent-cyan', '#8fd8ff'),
    white: v('--text-secondary', '#cfc6e6'), brightWhite: v('--text-primary', '#f7f3ff'),
  };
}

/**
 * An xterm view of an OutputLog. Replays the log on mount, then follows it.
 * With `onData` it is interactive (keystrokes go to the process); otherwise read-only.
 */
function XtermView({ log, onData, onResize, onReady, label, id }) {
  const host = useRef(null);
  const handlers = useRef({ onData, onResize, onReady });
  useEffect(() => { handlers.current = { onData, onResize, onReady }; });

  useEffect(() => {
    const el = host.current;
    const term = new Terminal({
      fontFamily: "'JetBrains Mono', monospace",
      fontSize: 12.5,
      lineHeight: 1.25,
      cursorBlink: !!handlers.current.onData,
      disableStdin: !handlers.current.onData,
      convertEol: false,
      scrollback: 5000,
      theme: xtermTheme(el),
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(el);
    term.textarea?.setAttribute('aria-label', label);

    const safeFit = () => { try { fit.fit(); } catch { /* hidden */ } };
    safeFit();
    term.write(log.text);
    const unsubscribe = log.subscribe(chunk => (chunk === null ? term.reset() : term.write(chunk)));
    const dataSub = term.onData(d => handlers.current.onData?.(d));
    const resizeSub = term.onResize(size => handlers.current.onResize?.(size));
    handlers.current.onReady?.({ cols: term.cols, rows: term.rows }, term);

    const observer = new ResizeObserver(safeFit);
    observer.observe(el);
    return () => {
      observer.disconnect();
      unsubscribe();
      dataSub.dispose();
      resizeSub.dispose();
      term.dispose();
    };
  }, [log, label]);

  return <div className="xterm-host" id={id} ref={host} />;
}

/** Bottom-panel terminal in project mode: dev-server output and an interactive shell. */
export default function ProjectTerminal({ project }) {
  const [view, setView] = useState('output');
  const [shellState, setShellState] = useState('idle'); // idle | open | unavailable

  return (
    <div className="project-terminal">
      <div className="console-toolbar project-terminal-toolbar" role="tablist" aria-label="Terminal views">
        <button role="tab" id="term-tab-output" aria-selected={view === 'output'} className={`btn-clear ${view === 'output' ? 'active' : ''}`} onClick={() => setView('output')}>
          Dev server
        </button>
        <button role="tab" id="term-tab-shell" aria-selected={view === 'shell'} className={`btn-clear ${view === 'shell' ? 'active' : ''}`} onClick={() => setView('shell')}>
          Shell
        </button>
        <div style={{ flex: 1 }} />
        {project.packageManager && (
          <span className="project-pm-badge" id="project-package-manager" title="Package manager used for this project">
            {project.packageManager}
          </span>
        )}
        {project.depsFromCache && (
          <span className="project-cached-badge" id="project-deps-cached" title="node_modules came from an earlier visit, so nothing had to be downloaded again">
            ⚡ Dependencies restored
          </span>
        )}
        <span className="console-line-count">{STATUS_TEXT[project.status]}</span>
      </div>
      <div className="project-terminal-body" role="tabpanel">
        {view === 'output' && (
          <XtermView key="output" id="project-output" log={project.output} label="Dev server output" />
        )}
        {view === 'shell' && (project.canShell() ? (
          <XtermView
            key="shell"
            id="project-shell"
            log={project.shellOutput}
            label="Shell input"
            onData={project.shellInput}
            onResize={project.resizeShell}
            onReady={async (size, term) => {
              const ok = await project.openShell(size);
              setShellState(ok ? 'open' : 'unavailable');
              if (ok) term.focus();
            }}
          />
        ) : (
          <div className="project-terminal-empty">
            Start the project first. The shell runs inside it, so you can use <code>npm</code>, <code>node</code>,{' '}
            <code>ls</code> and friends.
            {shellState === 'unavailable' && ' (The shell could not start.)'}
          </div>
        ))}
      </div>
    </div>
  );
}

const STATUS_TEXT = {
  idle: 'Not started',
  downloading: 'Downloading files…',
  booting: 'Booting Node.js…',
  installing: 'Installing dependencies…',
  starting: 'Starting dev server…',
  ready: 'Running',
  stopped: 'Stopped',
  error: 'Error',
};
