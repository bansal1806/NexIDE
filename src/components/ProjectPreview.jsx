import { useState } from 'react';
import { RefreshCw, ExternalLink, Play, AlertCircle, Loader2, Check } from 'lucide-react';

const STEPS = [
  { id: 'booting', label: 'Boot Node.js in your browser' },
  { id: 'installing', label: 'Install dependencies' },
  { id: 'starting', label: 'Start the dev server' },
];

/** Preview of a running project's dev server (served from the in-browser runtime). */
export default function ProjectPreview({ status, url, error, onStart }) {
  const [path, setPath] = useState('/');
  const [draft, setDraft] = useState('/');
  const [reloadKey, setReloadKey] = useState(0);

  const navigate = (e) => {
    e.preventDefault();
    const next = '/' + draft.trim().replace(/^\/+/, '');
    setDraft(next);
    setPath(next);
    setReloadKey(k => k + 1);
  };

  if (status === 'ready' && url) {
    const src = new URL(path, url).href;
    return (
      <div className="preview-container project-preview">
        <form className="project-preview-bar" onSubmit={navigate}>
          <button type="button" className="btn-icon" onClick={() => setReloadKey(k => k + 1)} aria-label="Reload preview" title="Reload">
            <RefreshCw size={13} />
          </button>
          <label className="sr-only" htmlFor="project-preview-path">Preview path</label>
          <input
            id="project-preview-path"
            className="project-preview-path"
            value={draft}
            onChange={e => setDraft(e.target.value)}
            spellCheck={false}
            autoComplete="off"
          />
          <a className="btn-icon" href={src} target="_blank" rel="noopener noreferrer" aria-label="Open preview in a new tab" title="Open in new tab">
            <ExternalLink size={13} />
          </a>
        </form>
        <iframe
          key={reloadKey}
          id="project-preview-frame"
          className="project-preview-frame"
          src={src}
          title="Project preview"
          allow="cross-origin-isolated; clipboard-read; clipboard-write"
        />
      </div>
    );
  }

  const activeIndex = STEPS.findIndex(s => s.id === status);
  return (
    <div className="project-preview-status" id="project-preview-status" aria-live="polite">
      {status === 'error' ? (
        <>
          <AlertCircle size={28} className="project-preview-icon error" aria-hidden="true" />
          <p className="project-preview-title">Something went wrong</p>
          <p className="project-preview-text">{error}</p>
          <button className="pg-chunky" onClick={onStart}><Play size={14} aria-hidden="true" /> Try again</button>
        </>
      ) : activeIndex >= 0 ? (
        <>
          <p className="project-preview-title">Spinning up your project…</p>
          <ol className="project-steps">
            {STEPS.map((step, i) => (
              <li key={step.id} className={i < activeIndex ? 'done' : i === activeIndex ? 'active' : ''}>
                {i < activeIndex
                  ? <Check size={14} aria-hidden="true" />
                  : i === activeIndex ? <Loader2 size={14} className="spin" aria-hidden="true" /> : <span className="project-step-dot" aria-hidden="true" />}
                {step.label}
              </li>
            ))}
          </ol>
          <p className="project-preview-text">The first install takes a little while. Follow along in the terminal.</p>
        </>
      ) : (
        <>
          <p className="project-preview-title">{status === 'stopped' ? 'The dev server is stopped' : 'Ready when you are'}</p>
          <p className="project-preview-text">Start the project to install its dependencies and see it running here.</p>
          <button className="pg-chunky" id="btn-preview-start" onClick={onStart}><Play size={14} aria-hidden="true" /> Start project</button>
        </>
      )}
    </div>
  );
}
