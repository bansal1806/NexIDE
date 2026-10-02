import { useState, useCallback, memo } from 'react';
// eslint-disable-next-line no-unused-vars
import { motion, AnimatePresence } from 'framer-motion';
import {
  FolderOpen, Folder, File, FileCode, FileText, FileJson,
  ChevronRight, ChevronDown, Plus, RotateCcw, X, AlertCircle, Cloud
} from 'lucide-react';
import { GithubIcon as Github } from './icons';

// File icon by extension
const EXT_ICONS = {
  js: '🟨', jsx: '⚛', ts: '🔷', tsx: '⚛',
  py: '🐍', html: '🌐', css: '🎨', scss: '🎨',
  json: '{}', md: '📄', txt: '📄', svg: '🖼',
  png: '🖼', jpg: '🖼', gif: '🖼', webp: '🖼',
  sh: '⚙', yaml: '⚙', yml: '⚙', env: '🔑',
  gitignore: '🚫', lock: '🔒',
};

const EXT_COLORS = {
  js: '#f7df1e', jsx: '#61dafb', ts: '#3178c6', tsx: '#61dafb',
  py: '#3776ab', html: '#e34c26', css: '#264de4', scss: '#cc6699',
  json: '#f59e0b', md: '#8b8fa8', svg: '#ff9900',
};

function getExt(name) {
  const parts = name.split('.');
  return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : '';
}

function FileIcon({ name, kind }) {
  if (kind === 'directory') return <Folder size={13} style={{ color: '#7c9cc0', flexShrink: 0 }} />;
  const ext = getExt(name);
  const emoji = EXT_ICONS[ext];
  const color = EXT_COLORS[ext] || '#8b8fa8';
  if (emoji) return <span style={{ fontSize: 11, flexShrink: 0 }}>{emoji}</span>;
  return <File size={13} style={{ color, flexShrink: 0 }} />;
}

// Visible tree items in document order (collapsed folders' children aren't rendered)
const visibleItems = (el) => [...el.closest('[role="tree"]').querySelectorAll('[role="treeitem"]')];

function TreeNode({ node, depth, onFileClick, activeFilePath, onDelete, githubMode, owner, repo, branch, onFetchContent, tabStop, onFocusItem }) {
  const [expanded, setExpanded] = useState(depth < 1);
  const isDir  = node.kind === 'directory';
  const isActive = node.path === activeFilePath;

  const handleClick = useCallback(async () => {
    if (isDir) { setExpanded(e => !e); return; }
    if (githubMode && !node._content) {
      // Lazy-fetch GitHub file content
      if (onFetchContent) await onFetchContent(node);
    }
    onFileClick(node);
  }, [isDir, node, onFileClick, githubMode, onFetchContent]);

  // WAI-ARIA tree keyboard model
  const handleKeyDown = (e) => {
    const items = visibleItems(e.currentTarget);
    const index = items.indexOf(e.currentTarget);
    const focusAt = (i) => items[Math.max(0, Math.min(items.length - 1, i))]?.focus();
    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); focusAt(index + 1); break;
      case 'ArrowUp':   e.preventDefault(); focusAt(index - 1); break;
      case 'Home':      e.preventDefault(); focusAt(0); break;
      case 'End':       e.preventDefault(); focusAt(items.length - 1); break;
      case 'ArrowRight':
        e.preventDefault();
        if (isDir && !expanded) setExpanded(true);
        else if (isDir && node.children.length) focusAt(index + 1); // first child
        break;
      case 'ArrowLeft': {
        e.preventDefault();
        if (isDir && expanded) { setExpanded(false); break; }
        // Move to the parent folder: nearest previous item one level up
        for (let i = index - 1; i >= 0; i--) {
          if (Number(items[i].getAttribute('aria-level')) === depth) { items[i].focus(); break; }
        }
        break;
      }
      case 'Enter':
      case ' ':
        e.preventDefault();
        handleClick();
        break;
    }
  };

  return (
    <div role="none">
      <div
        className={`file-tree-item ${isActive ? 'active' : ''}`}
        style={{ paddingLeft: 8 + depth * 14 }}
        onClick={handleClick}
        role="treeitem"
        aria-level={depth + 1}
        aria-expanded={isDir ? expanded : undefined}
        aria-selected={isActive}
        tabIndex={node.path === tabStop ? 0 : -1}
        onFocus={() => onFocusItem(node.path)}
        onKeyDown={handleKeyDown}
        title={node.path}
        data-path={node.path}
      >
        {isDir
          ? (expanded
              ? <ChevronDown size={10} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
              : <ChevronRight size={10} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />)
          : <span style={{ width: 10, flexShrink: 0 }} />
        }
        <FileIcon name={node.name} kind={node.kind} />
        <span className="file-tree-name">{node.name}</span>
      </div>

      {isDir && expanded && node.children.length > 0 && (
        <AnimatePresence initial={false}>
          <motion.div
            role="group"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            style={{ overflow: 'hidden' }}
          >
            {node.children.map(child => (
              <TreeNode
                key={child.path}
                node={child}
                depth={depth + 1}
                onFileClick={onFileClick}
                activeFilePath={activeFilePath}
                onDelete={onDelete}
                githubMode={githubMode}
                owner={owner}
                repo={repo}
                branch={branch}
                onFetchContent={onFetchContent}
                tabStop={tabStop}
                onFocusItem={onFocusItem}
              />
            ))}
          </motion.div>
        </AnimatePresence>
      )}
    </div>
  );
}

export const FileExplorer = memo(function FileExplorer({
  fileTree, rootName, isLoading, onOpenFolder, onFileClick, activeFilePath,
  onRefresh, githubMode, githubInfo, onFetchContent,
  cloudMode, cloudProjects, onOpenCloudProject, onCreateCloudProject, onNewCloudFile, user
}) {
  const hasTree = fileTree && fileTree.length > 0;
  const [showCloudProjects, setShowCloudProjects] = useState(false);
  // Roving tabindex: exactly one tree item is in the Tab order (the last focused, else the first)
  const [focusPath, setFocusPath] = useState(null);
  const tabStop = focusPath ?? fileTree?.[0]?.path;

  return (
    <div className="file-explorer" id="file-explorer">
      {/* Header */}
      <div className="explorer-header">
        <span className="explorer-title" onClick={() => setShowCloudProjects(!showCloudProjects)} style={{cursor: 'pointer'}}>
          {cloudMode ? '☁ ' : (githubMode ? '⎇ ' : '')}{rootName || 'EXPLORER'}
          <ChevronDown size={10} style={{ marginLeft: 4 }} />
        </span>
        <div style={{ display: 'flex', gap: 2 }}>
          {cloudMode && (
            <button className="explorer-btn" onClick={onNewCloudFile} title="New File" aria-label="New file">
              <Plus size={11} />
            </button>
          )}
          {hasTree && (
            <button className="explorer-btn" onClick={onRefresh} title="Refresh" aria-label="Refresh file tree">
              <RotateCcw size={11} />
            </button>
          )}
          {!githubMode && (
            <button className="explorer-btn" onClick={onOpenFolder} title="Open Folder" aria-label="Open folder">
              <FolderOpen size={11} />
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="explorer-body">
        {showCloudProjects ? (
          <div className="cloud-projects-view">
            <div style={{ padding: '8px 12px', fontSize: 11, fontWeight: 'bold', color: 'var(--text-muted)' }}>
              CLOUD WORKSPACES
            </div>
            {user ? (
              <>
                {cloudProjects.map(p => (
                  <div key={p.id} className="file-tree-item" onClick={() => { onOpenCloudProject(p); setShowCloudProjects(false); }}>
                    <Cloud size={12} style={{marginRight: 6}} /> {p.name}
                  </div>
                ))}
                <button className="explorer-open-btn" style={{marginTop: 10}} onClick={onCreateCloudProject}>
                  <Plus size={13} /> New Cloud Project
                </button>
              </>
            ) : (
              <div style={{ padding: 12, fontSize: 12, color: 'var(--text-muted)' }}>Sign in to use Cloud Workspaces</div>
            )}
          </div>
        ) : isLoading ? (
          <div className="explorer-empty">
            <div className="explorer-spinner" />
            <span>Loading...</span>
          </div>
        ) : !hasTree ? (
          <div className="explorer-empty">
            <div style={{ fontSize: 28, opacity: 0.3, marginBottom: 8 }}>📁</div>
            <span style={{ textAlign: 'center', lineHeight: 1.5 }}>
              {cloudMode ? 'Empty cloud project' : (githubMode ? 'No files loaded' : 'No folder open')}
            </span>
            {!githubMode && !cloudMode && (
              <button className="explorer-open-btn" onClick={onOpenFolder} id="btn-open-folder">
                <FolderOpen size={13} />
                Open Folder
              </button>
            )}
            {cloudMode && (
               <button className="explorer-open-btn" onClick={onNewCloudFile}>
                 <Plus size={13} /> New File
               </button>
            )}
          </div>
        ) : (
          <div className="file-tree" role="tree" aria-label="File explorer">
            {fileTree.map(node => (
              <TreeNode
                key={node.path}
                node={node}
                depth={0}
                onFileClick={onFileClick}
                activeFilePath={activeFilePath}
                githubMode={githubMode}
                owner={githubInfo?.owner}
                repo={githubInfo?.repo}
                branch={githubInfo?.branch}
                onFetchContent={onFetchContent}
                tabStop={tabStop}
                onFocusItem={setFocusPath}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
});
