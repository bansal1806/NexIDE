import { useState } from 'react';
import { X, AlertCircle, Loader2, Search } from 'lucide-react';
import { GithubIcon as Github } from './icons';
import { parseGitHubUrl, fetchRepoInfo, fetchRepoTree } from '../services/github';

const SUGGESTIONS = [
  'facebook/react',
  'microsoft/vscode',
  'vitejs/vite',
  'vercel/next.js',
  'tiangolo/fastapi',
  'django/django',
];

export function GitHubModal({ open, onClose, onLoad, githubToken }) {
  const [input, setInput]     = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState(null);

  if (!open) return null;

  const handleLoad = async () => {
    const parsed = parseGitHubUrl(input);
    if (!parsed) {
      setError('Invalid URL or format. Use: owner/repo or full GitHub URL');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [info, tree] = await Promise.all([
        fetchRepoInfo(parsed.owner, parsed.repo, githubToken),
        fetchRepoTree(parsed.owner, parsed.repo, parsed.branch, githubToken),
      ]);
      onLoad({
        owner: parsed.owner,
        repo:  parsed.repo,
        branch: info.default_branch || parsed.branch,
        description: info.description,
        stars: info.stargazers_count,
        tree,
      });
      onClose();
      setInput('');
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') handleLoad();
  };

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Open GitHub repository" id="github-modal">
      <div className="modal-panel github-panel">
        <div className="modal-header">
          <Github size={14} />
          <span>Open GitHub Repository</span>
          <div style={{ flex: 1 }} />
          <button className="btn-icon" onClick={onClose} aria-label="Close" id="btn-close-github">
            <X size={14} />
          </button>
        </div>

        <div className="github-body">
          <label className="settings-label">Repository URL or owner/repo</label>
          <div className="settings-input-row">
            <Search size={13} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
            <input
              id="github-repo-input"
              type="text"
              className="settings-input"
              value={input}
              onChange={e => { setInput(e.target.value); setError(null); }}
              onKeyDown={handleKeyDown}
              placeholder="e.g. facebook/react or https://github.com/..."
              autoFocus
              spellCheck={false}
            />
          </div>

          {error && (
            <div className="github-error" role="alert">
              <AlertCircle size={12} />
              <span>{error}</span>
            </div>
          )}

          <p className="settings-hint">
            Public repos work without authentication.
            {!githubToken && ' Add a GitHub token in Settings for private repos.'}
          </p>

          <div className="github-suggestions">
            <div className="settings-label">Popular repos to try</div>
            <div className="suggestion-chips">
              {SUGGESTIONS.map(s => (
                <button key={s} className="suggestion-chip" onClick={() => setInput(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="modal-footer">
          <button className="btn-modal-secondary" onClick={onClose}>Cancel</button>
          <button
            id="btn-load-github-repo"
            className="btn-modal-primary"
            onClick={handleLoad}
            disabled={loading || !input.trim()}
          >
            {loading ? <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> : <Github size={12} />}
            {loading ? 'Loading…' : 'Open Repository'}
          </button>
        </div>
      </div>
    </div>
  );
}
