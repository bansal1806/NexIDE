import { useRef, useEffect, useCallback, useState } from 'react';
import { Monitor, RefreshCw, ExternalLink, AlertCircle } from 'lucide-react';

// Build a self-contained srcdoc from code + language
function buildSandbox(code, language, allFiles = {}) {
  const consoleInterceptor = `
<script>
(function() {
  function send(type, args) {
    const data = args.map(a => {
      try { return typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a); }
      catch { return String(a); }
    });
    window.parent.postMessage({ __nexide: true, type, data }, '*');
  }
  ['log','info','warn','error'].forEach(m => {
    const orig = console[m].bind(console);
    console[m] = (...args) => { send(m, args); orig(...args); };
  });
  window.addEventListener('error', e => {
    send('error', [e.message + ' (line ' + e.lineno + ')']);
  });
  window.addEventListener('unhandledrejection', e => {
    send('error', [String(e.reason)]);
  });
})();
</script>`;

  if (language === 'html') {
    // Inject console interceptor into HTML
    if (code.includes('</head>')) {
      return code.replace('</head>', `${consoleInterceptor}</head>`);
    }
    return `${consoleInterceptor}${code}`;
  }

  if (language === 'javascript' || language === 'typescript') {
    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body { margin: 16px; font-family: system-ui, sans-serif; background: #0d0e14; color: #e2e4ef; }
    pre  { background: #1a1b26; padding: 12px; border-radius: 6px; overflow-x: auto; }
  </style>
  ${consoleInterceptor}
</head>
<body>
<script>
try { ${code} } catch(e) { console.error(e.message); }
</script>
</body>
</html>`;
  }

  if (language === 'css') {
    const html = allFiles['index.html'] || '<h1>Hello</h1><p>Preview</p><button>Button</button>';
    return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><style>${code}</style>${consoleInterceptor}</head>
<body>${html}</body>
</html>`;
  }

  // Fallback: show code as text
  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8">
<style>body{background:#0d0e14;color:#e2e4ef;font-family:monospace;padding:16px;margin:0}pre{white-space:pre-wrap}</style>
</head>
<body><pre>${code.replace(/</g,'&lt;')}</pre></body>
</html>`;
}

const PREVIEWABLE = ['html', 'javascript', 'typescript', 'css'];

export function LivePreview({ code, language, onConsoleMessage }) {
  const iframeRef  = useRef(null);
  const [error, setError]     = useState(null);
  const [loading, setLoading] = useState(false);

  const canPreview = PREVIEWABLE.includes(language);

  const refresh = useCallback(() => {
    if (!iframeRef.current || !canPreview) return;
    setLoading(true);
    setError(null);
    try {
      const srcdoc = buildSandbox(code, language);
      iframeRef.current.srcdoc = srcdoc;
    } catch (e) {
      setError(e.message);
    }
  }, [code, language, canPreview]);

  // Auto-refresh on code change (debounced)
  useEffect(() => {
    if (!canPreview) return;
    const t = setTimeout(refresh, 600);
    return () => clearTimeout(t);
  }, [code, language, refresh, canPreview]);

  // Listen for console messages from iframe
  useEffect(() => {
    const handler = (e) => {
      if (e.data?.__nexide && onConsoleMessage) {
        onConsoleMessage(e.data.type, e.data.data.join(' '));
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [onConsoleMessage]);

  const handleLoad = () => setLoading(false);

  return (
    <div className="live-preview" id="live-preview-panel">
      <div className="preview-toolbar">
        <Monitor size={12} aria-hidden="true" />
        <span className="preview-label">Preview</span>
        {!canPreview && (
          <span style={{ fontSize: 10, color: 'var(--text-muted)', marginLeft: 8 }}>
            (HTML/CSS/JS only)
          </span>
        )}
        <div style={{ flex: 1 }} />
        {loading && <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>Refreshing…</span>}
        <button
          id="btn-refresh-preview"
          className="btn-icon"
          onClick={refresh}
          style={{ width: 22, height: 22 }}
          title="Refresh preview"
          aria-label="Refresh preview"
          disabled={!canPreview}
        >
          <RefreshCw size={11} />
        </button>
      </div>

      {error && (
        <div className="preview-error" role="alert">
          <AlertCircle size={12} />
          <span>{error}</span>
        </div>
      )}

      {canPreview ? (
        <iframe
          ref={iframeRef}
          id="preview-iframe"
          className="preview-frame"
          sandbox="allow-scripts allow-modals allow-popups"
          onLoad={handleLoad}
          title="Live preview"
          aria-label="Live code preview"
        />
      ) : (
        <div className="preview-unsupported">
          <Monitor size={32} style={{ opacity: 0.2, marginBottom: 8 }} />
          <span>Live preview available for HTML, CSS, and JavaScript files.</span>
        </div>
      )}
    </div>
  );
}
