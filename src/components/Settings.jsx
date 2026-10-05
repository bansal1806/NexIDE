import { useState, useRef, useEffect } from 'react';
import { useDialog } from '../hooks/useDialog';
import { X, Key, Sliders, Type, Save, Eye, EyeOff, Package, Trash2 } from 'lucide-react';
import { listSnapshots, clearSnapshots } from '../runtime/depsCache';
import { GithubIcon as Github } from './icons';

const THEMES = [
  // Ids are stored in settings; labels/previews are the Playground names
  { id: 'nexide-dark', label: 'Playground', preview: 'linear-gradient(120deg, #7df2c6, #8fd8ff, #c9b0ff, #ff9ad1)' },
  { id: 'aurora',      label: 'Lagoon',     preview: 'linear-gradient(120deg, #86f0c8, #7fe3f0, #b9c4ff)' },
  { id: 'crimson',     label: 'Sunset',     preview: 'linear-gradient(120deg, #ffd97a, #ffb07a, #ff9fc0)' },
  { id: 'vs-dark',     label: 'Classic',    preview: '#3c3c3c' },
];

/** Saved node_modules snapshots (projects restart without reinstalling); clearable. */
function DependencyCache() {
  const [usage, setUsage] = useState(null); // { count, bytes } once known
  useEffect(() => {
    let cancelled = false;
    listSnapshots()
      .then(list => { if (!cancelled) setUsage({ count: list.length, bytes: list.reduce((sum, e) => sum + e.size, 0) }); })
      .catch(() => { if (!cancelled) setUsage({ count: 0, bytes: 0 }); });
    return () => { cancelled = true; };
  }, []);

  const clear = async () => {
    await clearSnapshots().catch(() => {});
    setUsage({ count: 0, bytes: 0 });
  };

  return (
    <>
      <div className="settings-toggle-row">
        <span className="settings-label" style={{ margin: 0 }} id="settings-deps-usage">
          {usage == null ? 'Saved dependencies: …'
            : usage.count ? `Saved dependencies: ${usage.count} project${usage.count === 1 ? '' : 's'}, ${(usage.bytes / 1048576).toFixed(0)} MB`
            : 'No saved dependencies'}
        </span>
        <button className="btn-modal-secondary" id="btn-clear-deps-cache" onClick={clear} disabled={!usage?.count}>
          <Trash2 size={12} aria-hidden="true" /> Clear
        </button>
      </div>
      <p className="settings-hint">
        After installing, a project's <code>node_modules</code> is kept in this browser, so the next start skips the
        download. The least recently used are removed beyond 3 projects or 600 MB.
      </p>
    </>
  );
}

export function Settings({ open, ...props }) {
  if (!open) return null;
  // Mounted fresh on every open, so the draft always starts from the saved settings
  return <SettingsDialog {...props} />;
}

function SettingsDialog({ onClose, settings, onSettingsChange, isExhausted }) {
  const [draft, setDraft]             = useState(settings);
  const [showKey, setShowKey]         = useState(false);
  const [showGhToken, setShowGhToken] = useState(false);

  const panelRef = useRef(null);
  useDialog(panelRef, { onClose });

  const update = (key, value) => setDraft(d => ({ ...d, [key]: value }));

  const handleSave = () => {
    onSettingsChange(draft);
    onClose();
  };

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Settings" id="settings-modal" onClick={onClose}>
      <div className="modal-panel settings-panel" ref={panelRef} tabIndex={-1} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <Sliders size={14} />
          <span>Settings</span>
          <div style={{ flex: 1 }} />
          <button className="btn-icon" onClick={onClose} aria-label="Close settings" id="btn-close-settings">
            <X size={14} />
          </button>
        </div>

        <div className="settings-body">
          {/* Appearance Section */}
          <div className="settings-section">
            <div className="settings-section-title">
              <Eye size={12} /> Appearance
            </div>
            <div className="settings-label" id="settings-theme-label">Theme</div>
            <div className="theme-selector" role="radiogroup" aria-labelledby="settings-theme-label">
              {THEMES.map(t => (
                <div
                  key={t.id}
                  className={`theme-option ${draft.theme === t.id ? 'active' : ''}`}
                  onClick={() => update('theme', t.id)}
                  style={{ '--preview': t.preview }}
                  role="radio"
                  aria-checked={draft.theme === t.id}
                  tabIndex={0}
                  onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && update('theme', t.id)}
                >
                  <div className="theme-preview" />
                  <span>{t.label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* AI Section */}
          <div className="settings-section">
            <div className="settings-section-title">
              <Key size={12} /> AI (Gemini)
            </div>
            {isExhausted && (
              <div className="settings-warning" style={{ color: '#ef4444', fontSize: 11, marginBottom: 8, padding: '8px', background: 'rgba(239, 68, 68, 0.1)', borderRadius: '4px' }}>
                Built-in AI quota exhausted. Enter your personal Gemini API key below to continue using AI features.
              </div>
            )}
            <label className="settings-label" htmlFor="settings-gemini-key">Gemini API Key {isExhausted && <span style={{ color: '#ef4444' }}>(Required)</span>}</label>
            <div className="settings-input-row">
              <input
                id="settings-gemini-key"
                type={showKey ? 'text' : 'password'}
                className="settings-input"
                value={draft.geminiApiKey}
                onChange={e => update('geminiApiKey', e.target.value.trim())}
                placeholder="AIza…"
                spellCheck={false}
                autoComplete="off"
              />
              <button className="btn-icon" onClick={() => setShowKey(s => !s)} aria-label="Toggle key visibility" style={{ width: 28, height: 28, flexShrink: 0 }}>
                {showKey ? <EyeOff size={12} /> : <Eye size={12} />}
              </button>
            </div>
            <p className="settings-hint">
              Get a free key at{' '}
              <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer">
                aistudio.google.com
              </a>
              . Requests go directly from your browser to Google. The key is stored encrypted in this browser and is never synced.
            </p>
          </div>

          {/* GitHub Section */}
          <div className="settings-section">
            <div className="settings-section-title">
              <Github size={12} /> GitHub
            </div>
            <label className="settings-label" htmlFor="settings-github-token">Personal Access Token (optional)</label>
            <div className="settings-input-row">
              <input
                id="settings-github-token"
                type={showGhToken ? 'text' : 'password'}
                className="settings-input"
                value={draft.githubToken}
                onChange={e => update('githubToken', e.target.value.trim())}
                placeholder="github_pat_… (read-only, for private repos)"
                spellCheck={false}
                autoComplete="off"
              />
              <button className="btn-icon" onClick={() => setShowGhToken(s => !s)} aria-label="Toggle token visibility" style={{ width: 28, height: 28, flexShrink: 0 }}>
                {showGhToken ? <EyeOff size={12} /> : <Eye size={12} />}
              </button>
            </div>
            <p className="settings-hint">
              Needed only for private repos. Use a fine-grained token with read-only <em>Contents</em> access.
              Stored encrypted in this browser.
            </p>

            <div className="settings-toggle-row">
              <label className="settings-label" style={{ margin: 0 }} htmlFor="settings-remember-secrets">
                Remember API keys on this device
              </label>
              <input
                id="settings-remember-secrets"
                type="checkbox"
                checked={draft.rememberSecrets !== false}
                onChange={e => update('rememberSecrets', e.target.checked)}
                className="settings-checkbox"
              />
            </div>
            <p className="settings-hint">
              Off: keys are kept only until this tab is closed. Either way they're encrypted with a
              non-extractable key and never leave this browser.
            </p>
          </div>

          {/* Projects Section */}
          <div className="settings-section">
            <div className="settings-section-title">
              <Package size={12} /> Projects
            </div>
            <label className="settings-label" htmlFor="settings-package-manager">Package manager</label>
            <select
              id="settings-package-manager"
              className="settings-select"
              value={draft.packageManager || 'auto'}
              onChange={e => update('packageManager', e.target.value)}
            >
              <option value="auto">Auto (from package.json / lockfile)</option>
              <option value="npm">npm</option>
              <option value="pnpm">pnpm</option>
              <option value="yarn">yarn (v1)</option>
            </select>
            <DependencyCache />
          </div>

          {/* Editor Section */}
          <div className="settings-section">
            <div className="settings-section-title">
              <Type size={12} /> Editor
            </div>

            <label className="settings-label" htmlFor="settings-font-size">Font Size: {draft.fontSize}px</label>
            <input
              id="settings-font-size"
              type="range" min={10} max={24} step={1}
              value={draft.fontSize}
              onChange={e => update('fontSize', Number(e.target.value))}
              className="settings-range"
            />

            <label className="settings-label" htmlFor="settings-tab-size">Tab Size</label>
            <select
              id="settings-tab-size"
              className="settings-select"
              value={draft.tabSize}
              onChange={e => update('tabSize', Number(e.target.value))}
            >
              <option value={2}>2 spaces</option>
              <option value={4}>4 spaces</option>
              <option value={8}>8 spaces</option>
            </select>

            <label className="settings-label" htmlFor="settings-word-wrap">Word Wrap</label>
            <select
              id="settings-word-wrap"
              className="settings-select"
              value={draft.wordWrap}
              onChange={e => update('wordWrap', e.target.value)}
            >
              <option value="off">Off</option>
              <option value="on">On</option>
              <option value="wordWrapColumn">At column 80</option>
            </select>

            <div className="settings-toggle-row">
              <label className="settings-label" style={{ margin: 0 }} htmlFor="settings-minimap">Minimap</label>
              <input
                id="settings-minimap"
                type="checkbox"
                checked={draft.minimap}
                onChange={e => update('minimap', e.target.checked)}
                className="settings-checkbox"
              />
            </div>

            <div className="settings-toggle-row">
              <label className="settings-label" style={{ margin: 0 }} htmlFor="settings-ligatures">Font Ligatures</label>
              <input
                id="settings-ligatures"
                type="checkbox"
                checked={draft.fontLigatures}
                onChange={e => update('fontLigatures', e.target.checked)}
                className="settings-checkbox"
              />
            </div>

            <div className="settings-toggle-row">
              <label className="settings-label" style={{ margin: 0 }} htmlFor="settings-autosave">Auto Save (local &amp; cloud files)</label>
              <input
                id="settings-autosave"
                type="checkbox"
                checked={draft.autoSave}
                onChange={e => update('autoSave', e.target.checked)}
                className="settings-checkbox"
              />
            </div>
          </div>
        </div>

        <div className="modal-footer">
          <button className="btn-modal-secondary" onClick={onClose}>Cancel</button>
          <button id="btn-save-settings" className="btn-modal-primary" onClick={handleSave}>
            <Save size={12} />
            Save Settings
          </button>
        </div>
      </div>
    </div>
  );
}
