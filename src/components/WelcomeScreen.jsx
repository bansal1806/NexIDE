// eslint-disable-next-line no-unused-vars
import { motion } from 'framer-motion';
import { FolderOpen, Code2, FileCode, Globe, ArrowRight } from 'lucide-react';
import { GithubIcon as Github } from './icons';

const TEMPLATES = [
  { id: 'js',   icon: '🟨', label: 'JavaScript',     ext: 'js',   color: '#f7df1e' },
  { id: 'py',   icon: '🐍', label: 'Python',         ext: 'py',   color: '#3776ab' },
  { id: 'html', icon: '🌐', label: 'HTML / CSS / JS', ext: 'html', color: '#e34c26' },
  { id: 'ts',   icon: '🔷', label: 'TypeScript',     ext: 'ts',   color: '#3178c6' },
];

export function WelcomeScreen({ onOpenFolder, onOpenGitHub, onNewFile, isSupported }) {
  return (
    <div className="welcome-screen" id="welcome-screen">
      <div className="welcome-content-pro">
        <div className="welcome-header">
          <div className="welcome-logo-pro">⚡</div>
          <h1>NexIDE</h1>
          <p>Browser-based AI Workspace</p>
        </div>

        <div className="welcome-columns">
          {/* Left Column: Start */}
          <div className="welcome-col">
            <h2 className="welcome-section-heading">Start</h2>
            <div className="welcome-action-list">
              {isSupported ? (
                <button
                  id="welcome-btn-open-folder"
                  className="welcome-action-btn"
                  onClick={onOpenFolder}
                >
                  <FolderOpen size={16} className="btn-icon-pro" />
                  <span>Open Folder...</span>
                </button>
              ) : (
                <div className="welcome-unsupported">
                  ⚠ File System Access API not supported natively.
                </div>
              )}

              <button
                id="welcome-btn-open-github"
                className="welcome-action-btn"
                onClick={onOpenGitHub}
              >
                <Github size={16} className="btn-icon-pro" />
                <span>Clone GitHub Repository...</span>
              </button>
            </div>
          </div>

          {/* Right Column: Recent / Templates */}
          <div className="welcome-col">
            <h2 className="welcome-section-heading">New File via Template</h2>
            <div className="welcome-action-list">
              {TEMPLATES.map(t => (
                <button
                  key={t.id}
                  id={`welcome-template-${t.id}`}
                  className="welcome-action-btn template-btn"
                  onClick={() => onNewFile(t)}
                >
                  <span className="template-icon-small">{t.icon}</span>
                  <span>{t.label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
