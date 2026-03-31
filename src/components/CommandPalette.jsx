import { useState, useRef, useMemo, useEffect } from 'react';
// eslint-disable-next-line no-unused-vars
import { motion, AnimatePresence } from 'framer-motion';
import { Search, FileCode, Zap, Settings, FolderOpen, TerminalSquare } from 'lucide-react';
import { GithubIcon as Github } from './icons';

function fuzzyMatch(str, query) {
  if (!query) return true;
  const s = str.toLowerCase();
  const q = query.toLowerCase();
  let si = 0;
  for (const c of q) {
    si = s.indexOf(c, si);
    if (si === -1) return false;
    si++;
  }
  return true;
}

// Inner component — gets re-mounted (key changes) when palette opens, so state resets cleanly
function PaletteInner({ onClose, openTabs, fileTree, onOpenFile, onCommand }) {
  const [query, setQuery]       = useState('');
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputRef = useRef(null);

  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 40);
    return () => clearTimeout(t);
  }, []);

  const items = useMemo(() => {
    const isCmd  = query.startsWith('>');
    const search = isCmd ? query.slice(1) : query;

    if (isCmd) {
      const commands = [
        { id: 'open-folder',     icon: <FolderOpen size={13} />,      label: 'File: Open Folder',              cmd: 'open-folder' },
        { id: 'open-github',     icon: <Github size={13} />,          label: 'GitHub: Open Repository',        cmd: 'open-github' },
        { id: 'toggle-terminal', icon: <TerminalSquare size={13} />,  label: 'View: Toggle Terminal',          cmd: 'toggle-terminal' },
        { id: 'open-settings',   icon: <Settings size={13} />,        label: 'Preferences: Open Settings',     cmd: 'open-settings' },
        { id: 'run-file',        icon: <Zap size={13} />,             label: 'Run: Execute Current File',      cmd: 'run-file' },
      ];
      return commands.filter(c => fuzzyMatch(c.label, search));
    }

    const flatten = (nodes) => {
      let acc = [];
      nodes?.forEach(n => {
        if (n.kind === 'file') acc.push(n);
        if (n.children) acc = acc.concat(flatten(n.children));
      });
      return acc;
    };

    const allFiles    = flatten(fileTree);
    const openPaths   = new Set((openTabs || []).map(t => t.path));

    const tabItems = (openTabs || []).map(t => ({
      id: t.path, icon: <FileCode size={13} style={{ color: 'var(--accent-cyan)' }} />,
      label: t.name, sublabel: t.path, node: t, isOpen: true,
    }));

    const treeItems = allFiles
      .filter(f => !openPaths.has(f.path))
      .map(f => ({
        id: f.path, icon: <FileCode size={13} />,
        label: f.name, sublabel: f.path, node: f, isOpen: false,
      }));

    return [...tabItems, ...treeItems]
      .filter(item => fuzzyMatch(item.label, search) || fuzzyMatch(item.sublabel || '', search))
      .slice(0, 20);
  }, [query, openTabs, fileTree]);

  // Clamp selection when items shrink
  const clampedIdx = Math.min(selectedIdx, Math.max(0, items.length - 1));

  const handleSelect = (item) => {
    if (item.cmd) onCommand?.(item.cmd);
    else if (item.node) onOpenFile?.(item.node);
    onClose();
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Escape')    { onClose(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedIdx(i => Math.min(i + 1, items.length - 1)); return; }
    if (e.key === 'ArrowUp')   { e.preventDefault(); setSelectedIdx(i => Math.max(i - 1, 0)); return; }
    if (e.key === 'Enter' && items[clampedIdx]) { handleSelect(items[clampedIdx]); return; }
  };

  const isCmd = query.startsWith('>');

  return (
    <motion.div
      className="palette-panel"
      initial={{ opacity: 0, y: -16, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -8, scale: 0.98 }}
      transition={{ duration: 0.15 }}
      onClick={e => e.stopPropagation()}
    >
      <div className="palette-input-row">
        {isCmd
          ? <Zap size={14} style={{ color: 'var(--accent-cyan)', flexShrink: 0 }} />
          : <Search size={14} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
        }
        <input
          ref={inputRef}
          id="command-palette-input"
          className="palette-input"
          value={query}
          onChange={e => { setQuery(e.target.value); setSelectedIdx(0); }}
          onKeyDown={handleKeyDown}
          placeholder="Search files… (type > for commands)"
          aria-label="Search files or commands"
          aria-autocomplete="list"
        />
        {query && (
          <button className="btn-icon" style={{ width: 20, height: 20, flexShrink: 0 }} onClick={() => setQuery('')} aria-label="Clear">×</button>
        )}
      </div>

      {isCmd && <div className="palette-mode-hint">Command mode — type a command name</div>}

      <div className="palette-results" role="listbox" aria-label="Results">
        {items.length === 0 ? (
          <div className="palette-empty">No results for "{query}"</div>
        ) : items.map((item, i) => (
          <div
            key={item.id}
            role="option"
            aria-selected={i === clampedIdx}
            className={`palette-item ${i === clampedIdx ? 'active' : ''}`}
            onClick={() => handleSelect(item)}
            onMouseEnter={() => setSelectedIdx(i)}
          >
            <span className="palette-item-icon">{item.icon}</span>
            <div className="palette-item-text">
              <span className="palette-item-label">{item.label}</span>
              {item.sublabel && <span className="palette-item-sub">{item.sublabel}</span>}
            </div>
            {item.isOpen && <span className="palette-item-badge">open</span>}
          </div>
        ))}
      </div>

      <div className="palette-footer">
        <span>↑↓ navigate</span>
        <span>↵ select</span>
        <span>Esc close</span>
        <span>{">"} for commands</span>
      </div>
    </motion.div>
  );
}

export function CommandPalette({ open, onClose, openTabs, fileTree, onOpenFile, onCommand }) {
  if (!open) return null;
  return (
    <div className="modal-overlay palette-overlay" onClick={onClose} id="command-palette">
      <AnimatePresence>
        <PaletteInner
          key="palette"
          onClose={onClose}
          openTabs={openTabs}
          fileTree={fileTree}
          onOpenFile={onOpenFile}
          onCommand={onCommand}
        />
      </AnimatePresence>
    </div>
  );
}
