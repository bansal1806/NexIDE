import { useRef, useEffect, useCallback, useState } from 'react';
import { Monitor, RefreshCw, ExternalLink, AlertCircle } from 'lucide-react';

// Build a self-contained srcdoc from code + language
// Inline <script> content must not contain "</script" or it would end the tag early
const escapeInlineScript = (code) => code.replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--');

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
try {
${escapeInlineScript(code)}
} catch(e) { console.error(e.message); }
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
  const pendingHtmlRef = useRef(null);
  const [frameKey, setFrameKey] = useState(0);
  const [error, setError]     = useState(null);
  const [loading, setLoading] = useState(false);

  const canPreview = PREVIEWABLE.includes(language);

  const refresh = useCallback(async () => {
    if (!iframeRef.current || !canPreview) return;
    setLoading(true);
    setError(null);
    try {
      let source = code;
      if (language === 'typescript') {
        const { transpileTS } = await import('../runtime/transpile');
        source = transpileTS(code);
      }
      // Reload the host page; it asks for the document once it's ready (see public/preview.html)
      pendingHtmlRef.current = buildSandbox(source, language);
      setFrameKey(k => k + 1);
    } catch (e) {
      setError(e.message);
      setLoading(false);
    }
  }, [code, language, canPreview]);

  // Auto-refresh on code change (debounced)
  useEffect(() => {
    if (!canPreview) return;
    const t = setTimeout(refresh, 600);
    return () => clearTimeout(t);
  }, [code, language, refresh, canPreview]);

  // Messages from the preview frame: "ready" handshake and console output
  useEffect(() => {
    const handler = (e) => {
      // Only accept messages from our own preview frame
      const frameWindow = iframeRef.current?.contentWindow;
      if (!frameWindow || e.source !== frameWindow) return;
      if (e.data?.__nexidePreviewReady) {
        if (pendingHtmlRef.current != null) {
          // The frame has an opaque origin (sandboxed), so '*' is the only usable target
          frameWindow.postMessage({ __nexidePreview: true, html: pendingHtmlRef.current }, '*');
        }
        setLoading(false);
        return;
      }
      const { __nexide, type, data } = e.data || {};
      if (!__nexide || !onConsoleMessage || !Array.isArray(data)) return;
      if (!['log', 'info', 'warn', 'error'].includes(type)) return;
      onConsoleMessage(type, data.map(String).join(' ').slice(0, 10_000));
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [onConsoleMessage]);

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
          key={frameKey}
          ref={iframeRef}
          id="preview-iframe"
          className="preview-frame"
          src="/preview.html"
          sandbox="allow-scripts allow-modals allow-popups allow-forms"
          referrerPolicy="no-referrer"
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

export default LivePreview;
