import { useState, useEffect } from 'react';
import { X, Key, Sliders, Type, Save, Eye, EyeOff } from 'lucide-react';
import { GithubIcon as Github } from './icons';

const THEMES = [
  { id: 'nexide-dark', label: 'Nexide Dark',  preview: '#0d0e14' },
  { id: 'vs-dark',     label: 'VS Dark',      preview: '#1e1e1e' },
  { id: 'aurora',      label: 'Aurora',       preview: '#0d1a12' },
  { id: 'crimson',     label: 'Crimson',      preview: '#1a0d0d' },
];

export function Settings({ open, ...props }) {
  if (!open) return null;
  // Mounted fresh on every open, so the draft always starts from the saved settings
  return <SettingsDialog {...props} />;
}

function SettingsDialog({ onClose, settings, onSettingsChange, isExhausted }) {
  const [draft, setDraft]             = useState(settings);
  const [showKey, setShowKey]         = useState(false);
  const [showGhToken, setShowGhToken] = useState(false);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const update = (key, value) => setDraft(d => ({ ...d, [key]: value }));

  const handleSave = () => {
    onSettingsChange(draft);
    onClose();
  };

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Settings" id="settings-modal" onClick={onClose}>
      <div className="modal-panel settings-panel" onClick={e => e.stopPropagation()}>
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
            <label className="settings-label">Theme</label>
            <div className="theme-selector">
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
            <label className="settings-label">Gemini API Key {isExhausted && <span style={{ color: '#ef4444' }}>(Required)</span>}</label>
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
            <label className="settings-label">Personal Access Token (optional)</label>
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

          {/* Editor Section */}
          <div className="settings-section">
            <div className="settings-section-title">
              <Type size={12} /> Editor
            </div>

            <label className="settings-label">Font Size: {draft.fontSize}px</label>
            <input
              id="settings-font-size"
              type="range" min={10} max={24} step={1}
              value={draft.fontSize}
              onChange={e => update('fontSize', Number(e.target.value))}
              className="settings-range"
            />

            <label className="settings-label">Tab Size</label>
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

            <label className="settings-label">Word Wrap</label>
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
