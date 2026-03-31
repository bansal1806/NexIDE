import { memo } from 'react';
import { Play, Loader2, MessageSquare, Map, TerminalSquare, Settings, FolderOpen, Search, Globe, User, Bug } from 'lucide-react';
import { GithubIcon as Github } from './icons';

const LANGUAGES = [
  { id: 'javascript', label: 'JavaScript', color: '#f7df1e', ext: 'js' },
  { id: 'typescript', label: 'TypeScript', color: '#3178c6', ext: 'ts' },
  { id: 'python',     label: 'Python',     color: '#3776ab', ext: 'py' },
  { id: 'html',       label: 'HTML',       color: '#e34c26', ext: 'html' },
  { id: 'css',        label: 'CSS',        color: '#264de4', ext: 'css' },
  { id: 'json',       label: 'JSON',       color: '#f59e0b', ext: 'json' },
  { id: 'markdown',   label: 'Markdown',   color: '#6b7280', ext: 'md' },
  { id: 'plaintext',  label: 'Text',       color: '#6b7280', ext: 'txt' },
  { id: 'shell',      label: 'Shell',      color: '#4ade80', ext: 'sh' },
  { id: 'yaml',       label: 'YAML',       color: '#f97316', ext: 'yaml' },
];

export const TopBar = memo(function TopBar({
  language,
  onLanguageChange,
  isRunning,
  onRun,
  onDebug,
  activePanel,
  onPanelChange,
  // Legacy compat
  onPanelToggle,
  onOpenFolder,
  onOpenGitHub,
  onSettings,
  onCommandPalette,
  user,
  onAuth,
}) {
  const toggle    = onPanelChange || onPanelToggle;
  const activeSetter = (id) => toggle && toggle(id);

  return (
    <header className="topbar" role="banner" id="topbar">
      <div className="topbar-logo">
        <div className="topbar-logo-icon" aria-hidden="true">⚡</div>
        <span className="topbar-logo-text">NexIDE</span>
      </div>

      <div className="topbar-divider" aria-hidden="true" />

      {/* Command palette trigger */}
      <button
        id="btn-command-palette"
        className="btn-icon topbar-search"
        onClick={onCommandPalette}
        title="Search files… (Ctrl+P)"
        aria-label="Open command palette"
        style={{ gap: 6, fontSize: 11, color: 'var(--text-muted)', padding: '0 10px', width: 'auto' }}
      >
        <Search size={12} />
        <span style={{ display: 'none' }}>Search…</span>
      </button>

      <div className="topbar-spacer" />

      {/* Language Selector */}
      <select
        id="language-select"
        className="lang-selector"
        value={language}
        onChange={e => onLanguageChange && onLanguageChange(e.target.value)}
        aria-label="Select programming language"
      >
        {LANGUAGES.map(l => (
          <option key={l.id} value={l.id}>{l.label}</option>
        ))}
      </select>

      <div className="topbar-divider" aria-hidden="true" />

      {/* Run Button */}
      <button
        id="btn-run-code"
        className={`btn-run ${isRunning ? 'running' : ''}`}
        onClick={onRun}
        disabled={isRunning}
        aria-label={isRunning ? 'Running code...' : 'Run code (Ctrl+Enter)'}
        title="Run code (Ctrl+Enter)"
      >
        {isRunning
          ? <Loader2 size={13} className="run-icon" aria-hidden="true" />
          : <Play size={13} fill="currentColor" aria-hidden="true" />
        }
        {isRunning ? 'Running…' : 'Run'}
      </button>

      <button
        id="btn-debug-code"
        className={`btn-debug ${isRunning ? 'running' : ''}`}
        onClick={onDebug}
        disabled={isRunning}
        title="Time-Travel Debug (Alpha)"
        aria-label="Debug code"
      >
        <Bug size={13} aria-hidden="true" />
        Debug
      </button>

      <div className="topbar-divider" aria-hidden="true" />

      {/* Panel Tabs */}
      <button id="btn-toggle-console" className={`btn-icon ${activePanel === 'console' ? 'active' : ''}`} onClick={() => activeSetter('console')} aria-label="Console" title="Console">
        <TerminalSquare size={15} />
      </button>
      <button id="btn-toggle-preview" className={`btn-icon ${activePanel === 'preview' ? 'active' : ''}`} onClick={() => activeSetter('preview')} aria-label="Live Preview" title="Live Preview">
        <Globe size={15} />
      </button>
      <button id="btn-toggle-ai" className={`btn-icon ${activePanel === 'ai' ? 'active' : ''}`} onClick={() => activeSetter('ai')} aria-label="AI Chat" title="AI Chat (Ctrl+\)">
        <MessageSquare size={15} />
      </button>
      <button id="btn-toggle-map" className={`btn-icon ${activePanel === 'map' ? 'active' : ''}`} onClick={() => activeSetter('map')} aria-label="Code Map" title="Code Map">
        <Map size={15} />
      </button>

      <div className="topbar-divider" aria-hidden="true" />

      {onOpenFolder && (
        <button id="btn-topbar-open-folder" className="btn-icon" onClick={onOpenFolder} title="Open Folder" aria-label="Open local folder">
          <FolderOpen size={15} />
        </button>
      )}
      {onOpenGitHub && (
        <button id="btn-topbar-open-github" className="btn-icon" onClick={onOpenGitHub} title="Open GitHub Repo" aria-label="Open GitHub repository">
          <Github size={15} />
        </button>
      )}
      {onSettings && (
        <button id="btn-topbar-settings" className="btn-icon" onClick={onSettings} title="Settings (Ctrl+,)" aria-label="Open settings">
          <Settings size={15} />
        </button>
      )}

      <div className="topbar-divider" aria-hidden="true" />

      {/* Auth Section */}
      <button 
        id="btn-topbar-auth" 
        className={`btn-icon ${user ? 'authenticated' : ''}`} 
        onClick={onAuth} 
        title={user ? `Logged in as ${user.email}` : 'Login / Sign Up'}
        aria-label="User account"
      >
        <User size={15} fill={user ? 'var(--accent-primary)' : 'none'} color={user ? 'var(--accent-primary)' : 'currentColor'} />
      </button>
    </header>
  );
});

export { LANGUAGES };
