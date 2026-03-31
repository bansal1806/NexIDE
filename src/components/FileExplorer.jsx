import { useState, useCallback, memo } from 'react';
// eslint-disable-next-line no-unused-vars
import { motion, AnimatePresence } from 'framer-motion';
import {
  FolderOpen, Folder, File, FileCode, FileText, FileJson,
  ChevronRight, ChevronDown, Plus, RotateCcw, X, AlertCircle
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

function TreeNode({ node, depth, onFileClick, activeFilePath, onDelete, githubMode, owner, repo, branch, onFetchContent }) {
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

  return (
    <div>
      <div
        className={`file-tree-item ${isActive ? 'active' : ''}`}
        style={{ paddingLeft: 8 + depth * 14 }}
        onClick={handleClick}
        role="button"
        tabIndex={0}
        onKeyDown={e => e.key === 'Enter' && handleClick()}
        title={node.path}
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
}) {
  const hasTree = fileTree && fileTree.length > 0;

  return (
    <div className="file-explorer" id="file-explorer">
      {/* Header */}
      <div className="explorer-header">
        <span className="explorer-title">
          {githubMode ? '⎇ ' : ''}{rootName || 'EXPLORER'}
        </span>
        <div style={{ display: 'flex', gap: 2 }}>
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
        {isLoading ? (
          <div className="explorer-empty">
            <div className="explorer-spinner" />
            <span>Loading...</span>
          </div>
        ) : !hasTree ? (
          <div className="explorer-empty">
            <div style={{ fontSize: 28, opacity: 0.3, marginBottom: 8 }}>📁</div>
            <span style={{ textAlign: 'center', lineHeight: 1.5 }}>
              {githubMode ? 'No files loaded' : 'No folder open'}
            </span>
            {!githubMode && (
              <button className="explorer-open-btn" onClick={onOpenFolder} id="btn-open-folder">
                <FolderOpen size={13} />
                Open Folder
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
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
});
