import { useState } from 'react';
import { X, Key, Sliders, Type, Save, Eye, EyeOff } from 'lucide-react';
import { GithubIcon as Github } from './icons';
import { saveSettings } from '../services/settings';

const THEMES = [
  { id: 'nexide-dark', label: 'Nexide Dark',  preview: '#0d0e14' },
  { id: 'vs-dark',     label: 'VS Dark',      preview: '#1e1e1e' },
  { id: 'aurora',      label: 'Aurora',       preview: '#0d1a12' },
  { id: 'crimson',     label: 'Crimson',      preview: '#1a0d0d' },
];

export function Settings({ open, onClose, settings, onSettingsChange, isExhausted }) {
  const [showKey, setShowKey]       = useState(false);
  const [showGhToken, setShowGhToken] = useState(false);
  const [saved, setSaved]           = useState(false);

  if (!open) return null;

  const update = (key, value) => {
    const next = { ...settings, [key]: value };
    onSettingsChange(next);
    saveSettings(next);
  };

  const handleSave = () => {
    saveSettings(settings);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Settings" id="settings-modal">
      <div className="modal-panel settings-panel">
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
                  className={`theme-option ${settings.theme === t.id ? 'active' : ''}`}
                  onClick={() => update('theme', t.id)}
                  style={{ '--preview': t.preview }}
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
                System quota exhausted. Please enter your personal Gemini API key below to continue using AI features.
              </div>
            )}
            <label className="settings-label">Gemini API Key {isExhausted && <span style={{ color: '#ef4444' }}>(Required)</span>}</label>
            <div className="settings-input-row">
              <input
                id="settings-gemini-key"
                type={showKey ? 'text' : 'password'}
                className="settings-input"
                value={settings.geminiApiKey}
                onChange={e => update('geminiApiKey', e.target.value)}
                placeholder="AIza…"
                spellCheck={false}
              />
              <button className="btn-icon" onClick={() => setShowKey(s => !s)} aria-label="Toggle key visibility" style={{ width: 28, height: 28, flexShrink: 0 }}>
                {showKey ? <EyeOff size={12} /> : <Eye size={12} />}
              </button>
            </div>
            <p className="settings-hint">
              Get your free key at{' '}
              <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer">
                aistudio.google.com
              </a>
              {' '}· Free: 15 req/min
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
                value={settings.githubToken}
                onChange={e => update('githubToken', e.target.value)}
                placeholder="ghp_… (for private repos)"
                spellCheck={false}
              />
              <button className="btn-icon" onClick={() => setShowGhToken(s => !s)} aria-label="Toggle token visibility" style={{ width: 28, height: 28, flexShrink: 0 }}>
                {showGhToken ? <EyeOff size={12} /> : <Eye size={12} />}
              </button>
            </div>
            <p className="settings-hint">Required for private repos and committing changes.</p>
          </div>

          {/* Editor Section */}
          <div className="settings-section">
            <div className="settings-section-title">
              <Type size={12} /> Editor
            </div>

            <label className="settings-label">Font Size: {settings.fontSize}px</label>
            <input
              id="settings-font-size"
              type="range" min={10} max={24} step={1}
              value={settings.fontSize}
              onChange={e => update('fontSize', Number(e.target.value))}
              className="settings-range"
            />

            <label className="settings-label">Tab Size</label>
            <select
              id="settings-tab-size"
              className="settings-select"
              value={settings.tabSize}
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
              value={settings.wordWrap}
              onChange={e => update('wordWrap', e.target.value)}
            >
              <option value="off">Off</option>
              <option value="on">On</option>
              <option value="wordWrapColumn">At column</option>
            </select>

            <div className="settings-toggle-row">
              <label className="settings-label" style={{ margin: 0 }}>Minimap</label>
              <input
                id="settings-minimap"
                type="checkbox"
                checked={settings.minimap}
                onChange={e => update('minimap', e.target.checked)}
                className="settings-checkbox"
              />
            </div>

            <div className="settings-toggle-row">
              <label className="settings-label" style={{ margin: 0 }}>Font Ligatures</label>
              <input
                id="settings-ligatures"
                type="checkbox"
                checked={settings.fontLigatures}
                onChange={e => update('fontLigatures', e.target.checked)}
                className="settings-checkbox"
              />
            </div>

            <div className="settings-toggle-row">
              <label className="settings-label" style={{ margin: 0 }}>Auto Save</label>
              <input
                id="settings-autosave"
                type="checkbox"
                checked={settings.autoSave}
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
            {saved ? 'Saved ✓' : 'Save Settings'}
          </button>
        </div>
      </div>
    </div>
  );
}
