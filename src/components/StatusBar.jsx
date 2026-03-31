import { CheckCircle2, XCircle, Loader2 } from 'lucide-react';

export function StatusBar({ language = 'plaintext', cursorLine = 1, cursorCol = 1, status = 'idle', githubMode, branch, fileName, isDirty, nodeCount = 0 }) {
  const statusConfig = {
    idle:    { label: 'Ready',   color: 'default' },
    running: { label: 'Running', color: 'running' },
    success: { label: 'Success', color: 'success' },
    error:   { label: 'Error',   color: 'error' },
  };

  const st = statusConfig[status] || statusConfig.idle;

  return (
    <footer className="statusbar" role="contentinfo" aria-label="Status bar">
      {/* Left section */}
      <div className="statusbar-item" title="Current mode">
        <span>⚡</span>
        <span style={{ fontWeight: 600 }}>NexIDE</span>
      </div>

      <div className="statusbar-divider" aria-hidden="true" />

      {fileName && (
        <>
          <div className="statusbar-item" title="Active file">
            {githubMode && '⎇ '}{fileName}{isDirty ? '*' : ''}
          </div>
          <div className="statusbar-divider" aria-hidden="true" />
        </>
      )}

      {githubMode && branch && (
        <>
          <div className="statusbar-item" title="GitHub branch">
            <span>Branch: {branch}</span>
          </div>
          <div className="statusbar-divider" aria-hidden="true" />
        </>
      )}

      <div className="statusbar-item" id="statusbar-language" title={`Language: ${language}`}>
        <span>{language.charAt(0).toUpperCase() + language.slice(1)}</span>
      </div>

      <div className="statusbar-divider" aria-hidden="true" />

      <div className="statusbar-item" id="statusbar-cursor" title="Cursor position">
        Ln {cursorLine}, Col {cursorCol}
      </div>

      {nodeCount > 0 && (
        <>
          <div className="statusbar-divider" aria-hidden="true" />
          <div className="statusbar-item" title="Code map nodes">
            🗺 {nodeCount} nodes
          </div>
        </>
      )}

      <div className="statusbar-spacer" />

      {/* Right section: execution status */}
      <div
        className="statusbar-item"
        id="statusbar-status"
        title={`Execution status: ${st.label}`}
        aria-live="polite"
        aria-label={`Status: ${st.label}`}
      >
        <div className={`statusbar-indicator ${st.color}`} aria-hidden="true" />
        {status === 'running' && (
          <Loader2 size={10} style={{ animation: 'spin 1s linear infinite' }} aria-hidden="true" />
        )}
        {status === 'success' && <CheckCircle2 size={10} aria-hidden="true" />}
        {status === 'error'   && <XCircle size={10} aria-hidden="true" />}
        <span>{st.label}</span>
      </div>

      <div className="statusbar-divider" aria-hidden="true" />

      <div className="statusbar-item" title="Gemini AI powered">
        <span>✨ Gemini AI</span>
      </div>
    </footer>
  );
}
