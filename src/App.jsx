import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { useAuth } from './hooks/useAuth';
// eslint-disable-next-line no-unused-vars
import { motion, AnimatePresence } from 'framer-motion';
import { useDebugger } from './hooks/useDebugger';
import { DebugTimeline } from './components/DebugTimeline';
import { VariableInspector } from './components/VariableInspector';
import {
  FolderOpen, Settings as SettingsIcon, TerminalSquare,
  Files, Map, MessageSquare, Play, Zap, Bug
} from 'lucide-react';
import './App.css';

// Hooks
import { useFileSystem }  from './hooks/useFileSystem';
import { useCodeRunner }  from './hooks/useCodeRunner';
import { usePython }      from './hooks/usePython';
import { useGemini }      from './hooks/useGemini';
import { useMonacoWorkspace } from './hooks/useMonacoWorkspace';

// Services
import { fetchFileContent } from './services/github';
import { loadSettings, saveSettings } from './services/settings';

// Components
import { FileExplorer }   from './components/FileExplorer';
import { Editor }         from './components/Editor';
import { ConsoleOutput }  from './components/ConsoleOutput';
import { AIChat }         from './components/AIChat';
import { CodeMap }        from './components/CodeMap';
import { StatusBar }      from './components/StatusBar';
import { TopBar }         from './components/TopBar';
import { LivePreview }    from './components/LivePreview';
import { Terminal }       from './components/Terminal';
import { Settings }       from './components/Settings';
import { GitHubModal }    from './components/GitHubModal';
import { WelcomeScreen }  from './components/WelcomeScreen';
import { CommandPalette } from './components/CommandPalette';
import { AuthModal }       from './components/AuthModal';

// Language detection
const EXT_LANG = {
  js: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript',
  py: 'python', html: 'html', css: 'css', scss: 'css',
  json: 'json', md: 'markdown', txt: 'plaintext', sh: 'shell',
  yaml: 'yaml', yml: 'yaml', toml: 'plaintext',
};

function getLang(filename) {
  if (!filename) return 'plaintext';
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  return EXT_LANG[ext] || 'plaintext';
}

function findHandleByPath(nodes, targetPath) {
  for (const node of nodes) {
    if (node.path === targetPath) return node.handle;
    if (node.children) {
      const found = findHandleByPath(node.children, targetPath);
      if (found) return found;
    }
  }
  return null;
}

let tabIdCounter = 1;

export default function App() {
  console.log('App Rendering...');
  
  const [settings, setSettings] = useState(() => loadSettings());
  
  const [workspaceFiles, setWorkspaceFiles] = useState([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  
  // Persist settings
  useEffect(() => {
    saveSettings(settings);
  }, [settings]);

  const { 
    snapshots, currentIndex, currentSnapshot, previousSnapshot,
    isDebugging, isPlaying, playSpeed, changedVars, stats,
    breakpoints, watchList,
    startDebug, endDebug, addSnapshot, setPlayhead, 
    stepForward, stepBackward, jumpToStart, jumpToEnd, clearSnapshots,
    toggleBreakpoint, togglePlay, setPlaySpeed,
    addWatch, removeWatch,
  } = useDebugger();

  // ── File System ──────────────────────────────────────────────────────
  const fs = useFileSystem();

  // ── Tabs (open files) ──────────────────────────────────────────────
  const [tabs, setTabs]           = useState([]);
  const [activeTabId, setActiveTabId] = useState(null);
  
  const activeTab = useMemo(() => {
    return tabs.find(t => t.id === activeTabId) || tabs[0] || null;
  }, [tabs, activeTabId]);

  // ── GitHub mode ───────────────────────────────────────────────────
  const [githubMode, setGithubMode]   = useState(false);
  const [githubInfo, setGithubInfo]   = useState(null);
  const [githubTree, setGithubTree]   = useState([]);

  // ── UI panels / modals ────────────────────────────────────────────
  const [bottomPanel, setBottomPanel]   = useState(null); // 'terminal' | 'console' | null
  const [rightPanel, setRightPanel]     = useState(null); // 'preview' | 'ai' | 'map' | 'debug' | null
  const [sidebarOpen, setSidebarOpen]   = useState(true);
  const [githubOpen, setGithubOpen]     = useState(false);
  const [paletteOpen, setPaletteOpen]   = useState(false);
  const [authOpen, setAuthOpen]         = useState(false);

  // ── Code execution ────────────────────────────────────────────────
  const jsRunner  = useCodeRunner();
  const pyRunner  = usePython();

  const consoleOutput = useMemo(() => {
    return (activeTab?.lang === 'python' ? pyRunner.output : jsRunner.output) || [];
  }, [activeTab?.lang, pyRunner.output, jsRunner.output]);

  const runStatus = useMemo(() => {
    return (activeTab?.lang === 'python' ? pyRunner.status : jsRunner.status) || 'idle';
  }, [activeTab?.lang, pyRunner.status, jsRunner.status]);

  const isRunning = runStatus === 'running';

  // ── Auth ─────────────────────────────────────────────────────────
  const { user } = useAuth();

  // ── AI (Gemini) ───────────────────────────────────────────────────
  const gemini = useGemini();

  const handleAiAction = useCallback((action, lineNum, snippet) => {
    setRightPanel('ai');
    const prompt = action === 'explain' 
      ? `Explain the "${snippet}" structure near line ${lineNum}.`
      : action === 'debug'
      ? `Look for bugs or improvements in "${snippet}" near line ${lineNum}.`
      : `Write a clean docstring for "${snippet}" near line ${lineNum}.`;
    
    gemini.sendMessage(prompt, activeTab?.content || '', activeTab?.lang || 'plaintext', settings.geminiApiKey);
  }, [gemini, activeTab, settings.geminiApiKey]);

  // ── Cursor / status bar ───────────────────────────────────────────
  const [cursorPos, setCursorPos] = useState({ line: 1, col: 1 });

  const editorRef = useRef(null);

  // ── Open a file into a tab ────────────────────────────────────────
  const openFileInTab = useCallback(async (node) => {
    const existing = tabs.find(t => t.path === node.path);
    if (existing) { setActiveTabId(existing.id); return; }

    let content = '';

    if (node.handle) {
      try { content = await fs.readFile(node.handle); }
      catch (e) { content = "// Error reading file: " + (e.message || ""); }
    } else if (node._content) {
      content = node._content;
    } else if (githubMode && githubInfo) {
      try {
        content = await fetchFileContent(
          githubInfo.owner, githubInfo.repo, node.path,
          githubInfo.branch, settings.githubToken
        );
        node._content = content; 
      } catch (e) { content = "// GitHub load failed: " + (e.message || ""); }
    }

    const lang = getLang(node.name);
    const id   = tabIdCounter++;
    const tab  = { id, name: node.name, path: node.path, lang, content, handle: node.handle || null, dirty: false };
    setTabs(prev => [...prev, tab]);
    setActiveTabId(id);
    return tab;
  }, [tabs, fs, githubMode, githubInfo, settings.githubToken]);

  const handleMapNodeClick = useCallback(async (node) => {
    if (node.type === 'folder') return;
    if (node.path) await openFileInTab(node);

    if (node.line && editorRef.current) {
      setTimeout(() => {
        editorRef.current.revealLineInCenter(node.line);
        editorRef.current.setPosition({ lineNumber: node.line, column: 1 });
        editorRef.current.focus();
      }, 100);
    }
  }, [openFileInTab]);

  const newFileFromTemplate = useCallback((templateId) => {
    const content = templateId === 'py' ? 'print("Hello Python")' : 'console.log("Hello JS")';
    const name = templateId === 'py' ? 'main.py' : 'main.js';
    const id = tabIdCounter++;
    const tab = { id, name, path: name, lang: getLang(name), content, handle: null, dirty: false };
    setTabs(prev => [...prev, tab]);
    setActiveTabId(id);
  }, []);

  const handleEditorChange = useCallback((value) => {
    setTabs(prev => prev.map(t =>
      t.id === activeTabId ? { ...t, content: value ?? '', dirty: true } : t
    ));
  }, [activeTabId]);

  const saveFile = useCallback(async () => {
    if (!activeTab || !activeTab.handle) return;
    try {
      await fs.writeFile(activeTab.handle, activeTab.content);
      setTabs(prev => prev.map(t => t.id === activeTabId ? { ...t, dirty: false } : t));
    } catch (e) { console.error('Save failed:', e); }
  }, [activeTab, activeTabId, fs]);

  const closeTab = useCallback((tabId, e) => {
    e?.stopPropagation();
    setTabs(prev => {
      const next = prev.filter(t => t.id !== tabId);
      if (activeTabId === tabId && next.length > 0) {
        const idx = Math.max(0, prev.findIndex(t => t.id === tabId) - 1);
        setActiveTabId(next[Math.min(idx, next.length - 1)].id);
      }
      return next;
    });
  }, [activeTabId]);

  const runCode = useCallback(async () => {
    if (!activeTab) return;
    setBottomPanel('console');
    if (activeTab.lang === 'python') {
      await pyRunner.runPython(activeTab.content);
    } else {
      jsRunner.runCode(activeTab.content, activeTab.lang);
    }
  }, [activeTab, jsRunner, pyRunner]);

  const runDebug = useCallback(async () => {
    if (!activeTab) return;
    setBottomPanel('console');
    setRightPanel('debug');
    startDebug();
    
    const options = {
      debug: true,
      onDebugStep: (step) => addSnapshot(step)
    };

    if (activeTab.lang === 'python') {
      await pyRunner.runPython(activeTab.content, options);
    } else {
      jsRunner.runCode(activeTab.content, activeTab.lang, options);
    }
  }, [activeTab, jsRunner, pyRunner, startDebug, addSnapshot]);

  const handleOpenFolder = useCallback(async () => {
    const hasDirty = tabs.some(t => t.dirty);
    if (hasDirty) {
      const confirmed = window.confirm("You have unsaved changes. Are you sure you want to open a new folder and discard them?");
      if (!confirmed) return;
    }

    const result = await fs.openFolder();
    if (result) {
      setGithubMode(false);
      setGithubInfo(null);
      setGithubTree([]);
      setTabs([]);
      setActiveTabId(null);
      clearSnapshots();
      endDebug();
      
      // Eagerly sync real local flies
      const allFiles = await fs.readAllFiles(result.tree);
      setWorkspaceFiles(allFiles);
    }
  }, [fs, tabs, clearSnapshots, endDebug]);

  const handleGitHubLoad = useCallback((info) => {
    const hasDirty = tabs.some(t => t.dirty);
    if (hasDirty) {
      const confirmed = window.confirm("You have unsaved changes. Are you sure you want to open a new repository and discard them?");
      if (!confirmed) return;
    }

    setGithubMode(true);
    setGithubInfo({ owner: info.owner, repo: info.repo, branch: info.branch, token: settings.githubToken });
    setGithubTree(info.tree);
    setTabs([]);
    setActiveTabId(null);
    clearSnapshots();
    endDebug();
    setSidebarOpen(true);
  }, [settings.githubToken, tabs, clearSnapshots, endDebug]);

  const handleBackgroundModelChange = useCallback((path, content) => {
    setTabs(prev => {
      // Find if we already have it open
      const existingIdx = prev.findIndex(t => t.path === path);
      if (existingIdx !== -1) {
        const next = [...prev];
        // Only update if it actually changed, to avoid endless loops
        if (next[existingIdx].content !== content) {
          next[existingIdx] = { ...next[existingIdx], content, dirty: true };
          return next;
        }
        return prev;
      }
      
      // If it's not open, open it as a new dirty tab so the user sees the bulk edit
      // We need to look up its filename from path
      const name = path.split('/').pop();
      const newTab = {
        id: tabIdCounter++,
        name,
        path,
        lang: getLang(name),
        content,
        handle: fs.fileTree ? findHandleByPath(fs.fileTree, path) : null,
        dirty: true
      };
      return [...prev, newTab];
    });
  }, [fs.fileTree]);
  
  // Custom hook that binds raw code models into Monaco's unified workspace
  useMonacoWorkspace(workspaceFiles, handleBackgroundModelChange);

  const handleCommand = useCallback((cmd) => {
    switch (cmd) {
      case 'open-folder':     handleOpenFolder();  break;
      case 'open-github':     setGithubOpen(true); break;
      case 'toggle-terminal': setBottomPanel(v => v === 'terminal' ? null : 'terminal'); break;
      case 'open-settings':   setSettingsOpen(true); break;
      case 'run-file':        runCode();           break;
    }
  }, [handleOpenFolder, runCode]);

  useEffect(() => {
    const handler = (e) => {
      // F5 = Debug, F10 = Step Over (forward), F9 = Toggle Breakpoint, Esc = End Debug
      if (e.key === 'F5') { e.preventDefault(); runDebug(); return; }
      if (e.key === 'F10' && isDebugging) { e.preventDefault(); stepForward(); return; }
      if (e.key === 'Escape' && isDebugging) { clearSnapshots(); endDebug(); setRightPanel(null); return; }

      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      if (e.key === 'p' || e.key === 'P') { e.preventDefault(); setPaletteOpen(v => !v); }
      if (e.key === 's') { e.preventDefault(); saveFile(); }
      if (e.key === 'Enter') { e.preventDefault(); runCode(); }
      if (e.key === 'b') { e.preventDefault(); setSidebarOpen(v => !v); }
      if (e.key === '\\') { e.preventDefault(); setRightPanel(p => p === 'ai' ? null : 'ai'); }
      if (e.key === '`') { e.preventDefault(); setBottomPanel(v => v === 'terminal' ? null : 'terminal'); }
      if (e.key === ',') { e.preventDefault(); setSettingsOpen(true); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [saveFile, runCode, runDebug, isDebugging, stepForward, clearSnapshots, endDebug]);

  const fileTree = githubMode ? githubTree : fs.fileTree;
  const rootName = githubMode ? (githubInfo ? `${githubInfo.owner}/${githubInfo.repo}` : 'GitHub') : fs.rootName;
  const hasFiles = fileTree.length > 0 || tabs.length > 0;
  const showWelcome = !hasFiles;

  const handlePreviewConsole = useCallback((type, text) => {
    jsRunner.addConsoleMessage?.(type, text);
  }, [jsRunner]);

  return (
    <div className="app" id="nexide-app" data-theme={settings.theme || 'nexide-dark'}>
      
      <TopBar
        language={activeTab?.lang || 'plaintext'}
        onLanguageChange={(lang) => {
          setTabs(prev => prev.map(t => t.id === activeTabId ? { ...t, lang } : t));
        }}
        onRun={runCode}
        onDebug={runDebug}
        onSave={saveFile}
        isRunning={isRunning}
        activePanel={rightPanel}
        onPanelChange={setRightPanel}
        onOpenFolder={handleOpenFolder}
        onOpenGitHub={() => setGithubOpen(true)}
        onSettings={() => setSettingsOpen(true)}
        onToggleSidebar={() => setSidebarOpen(v => !v)}
        onToggleTerminal={() => setBottomPanel(v => v === 'terminal' ? null : 'terminal')}
        onCommandPalette={() => setPaletteOpen(true)}
        user={user}
        onAuth={() => setAuthOpen(true)}
      />

      <div className="app-body" id="app-body">
        <div className="activity-bar" id="activity-bar">
          <button className={`activity-btn ${sidebarOpen ? 'active' : ''}`} onClick={() => setSidebarOpen(v => !v)} title="Explorer">
            <Files size={18} />
          </button>
          <button className={`activity-btn ${rightPanel === 'map' ? 'active' : ''}`} onClick={() => setRightPanel(p => p === 'map' ? null : 'map')} title="Code Map">
            <Map size={18} />
          </button>
          <button className={`activity-btn ${rightPanel === 'ai' ? 'active' : ''}`} onClick={() => setRightPanel(p => p === 'ai' ? null : 'ai')} title="AI Assistant">
            <MessageSquare size={18} />
          </button>
          <div className="activity-spacer" />
          <button className={`activity-btn ${bottomPanel === 'terminal' ? 'active' : ''}`} onClick={() => setBottomPanel(v => v === 'terminal' ? null : 'terminal')} title="Terminal">
            <TerminalSquare size={18} />
          </button>
          <button className="activity-btn activity-settings-btn" onClick={() => setSettingsOpen(true)} title="Settings">
            <SettingsIcon size={18} />
          </button>
        </div>

        <AnimatePresence initial={false}>
          {sidebarOpen && (
            <motion.div
              className="sidebar"
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 220, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.18 }}
              id="sidebar"
            >
              <FileExplorer
                fileTree={fileTree}
                rootName={rootName}
                isLoading={fs.isLoading}
                onOpenFolder={handleOpenFolder}
                onFileClick={openFileInTab}
                activeFilePath={activeTab?.path}
                onRefresh={fs.refreshTree}
                githubMode={githubMode}
                githubInfo={githubInfo}
              />
            </motion.div>
          )}
        </AnimatePresence>

        <div className="editor-column" id="editor-column">
          {showWelcome ? (
            <WelcomeScreen
              onOpenFolder={handleOpenFolder}
              onOpenGitHub={() => setGithubOpen(true)}
              onNewFile={(tpl) => newFileFromTemplate(tpl.id)}
              isSupported={fs.isSupported}
            />
          ) : (
            <div className="editor-area-wrapper">
              {tabs.length > 0 && (
                <div className="tab-bar" role="tablist">
                  {tabs.map(tab => (
                    <div key={tab.id} className={`tab ${tab.id === activeTabId ? 'active' : ''}`} onClick={() => setActiveTabId(tab.id)} role="tab">
                      <span className="tab-name">{tab.name}</span>
                      {tab.dirty && <span className="tab-unsaved" />}
                      <button className="tab-close" onClick={(e) => closeTab(tab.id, e)}>×</button>
                    </div>
                  ))}
                </div>
              )}
              {activeTab && (
                <div className="editor-area">
                  <Editor
                    code={activeTab.content}
                    path={activeTab.path}
                    language={activeTab.lang}
                    onChange={handleEditorChange}
                    onCursorChange={setCursorPos}
                    onRun={runCode}
                    onSave={saveFile}
                    onAiAction={handleAiAction}
                    externalRef={editorRef}
                    debugLine={isDebugging && currentSnapshot ? currentSnapshot.line : null}
                    breakpoints={breakpoints}
                    onToggleBreakpoint={toggleBreakpoint}
                    fontSize={settings.fontSize}
                    tabSize={settings.tabSize}
                    wordWrap={settings.wordWrap}
                    minimap={settings.minimap}
                    fontLigatures={settings.fontLigatures}
                  />
                </div>
              )}
            </div>
          )}

          {bottomPanel && (
            <div className="bottom-panel">
              <div className="panel-tabs">
                {['terminal', 'console'].map(p => (
                  <button key={p} className={`panel-tab ${bottomPanel === p ? 'active' : ''}`} onClick={() => setBottomPanel(p)}>
                    {p.charAt(0).toUpperCase() + p.slice(1)}
                  </button>
                ))}
                <div style={{ flex: 1 }} />
                <button className="panel-close-btn" onClick={() => setBottomPanel(null)}>×</button>
              </div>
              <div className="panel-content">
                {bottomPanel === 'terminal' && <Terminal open={true} fileTree={fileTree} onRunFile={(path) => { const node = { path, name: path.split('/').pop() }; openFileInTab(node); runCode(); }} />}
                {bottomPanel === 'console' && <ConsoleOutput lines={consoleOutput} onClear={clearSnapshots} />}
              </div>
            </div>
          )}
        </div>

        {rightPanel && (
          <div className="right-panel">
            <div className="panel-tabs">
              {['preview', 'ai', 'map', 'debug'].map(p => (
                <button key={p} className={`panel-tab ${rightPanel === p ? 'active' : ''}`} onClick={() => setRightPanel(p)}>
                  {p.charAt(0).toUpperCase() + p.slice(1)}
                </button>
              ))}
              <div style={{ flex: 1 }} />
              <button className="panel-close-btn" onClick={() => setRightPanel(null)}>×</button>
            </div>
            <div className="panel-content">
              <AnimatePresence mode="wait">
                {rightPanel === 'preview' && (
                  <motion.div key="preview" style={{ height: '100%' }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                    <LivePreview code={activeTab?.content || ''} language={activeTab?.lang || 'plaintext'} onConsoleMessage={handlePreviewConsole} />
                  </motion.div>
                )}
                {rightPanel === 'ai' && (
                  <motion.div key="ai" style={{ height: '100%' }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                    <AIChat gemini={gemini} editorCode={activeTab?.content || ''} language={activeTab?.lang || 'plaintext'} hasApiKey={!!settings.geminiApiKey} onApiKeyNeeded={() => setSettingsOpen(true)} />
                  </motion.div>
                )}
                {rightPanel === 'map' && (
                  <motion.div key="map" style={{ height: '100%' }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                    <CodeMap activeTab={activeTab} tabs={tabs} fileTree={fileTree} onNodeClick={handleMapNodeClick} />
                  </motion.div>
                )}
                {rightPanel === 'debug' && (
                  <motion.div key="debug" style={{ height: '100%' }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                    <VariableInspector
                      snapshot={currentSnapshot}
                      previousSnapshot={previousSnapshot}
                      changedVars={changedVars}
                      watchList={watchList}
                      onAddWatch={addWatch}
                      onRemoveWatch={removeWatch}
                      callStack={currentSnapshot?.callStack || []}
                    />
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        )}
        
        {isDebugging && snapshots.length > 0 && (
          <DebugTimeline 
            snapshots={snapshots}
            currentIndex={currentIndex}
            onSeek={setPlayhead}
            onStepBack={stepBackward}
            onStepForward={stepForward}
            onJumpToStart={jumpToStart}
            onJumpToEnd={jumpToEnd}
            onReset={() => { clearSnapshots(); endDebug(); setRightPanel(null); }}
            onTogglePlay={togglePlay}
            isPlaying={isPlaying}
            playSpeed={playSpeed}
            onSpeedChange={setPlaySpeed}
            breakpoints={breakpoints}
            stats={stats}
            isLive={currentIndex === snapshots.length - 1}
          />
        )}
      </div>

      <StatusBar language={activeTab?.lang || ''} cursorLine={cursorPos.line} cursorCol={cursorPos.col} status={runStatus} />

      <Settings open={settingsOpen} onClose={() => setSettingsOpen(false)} settings={settings} onSettingsChange={setSettings} isExhausted={gemini.isExhausted} />
      <GitHubModal open={githubOpen} onClose={() => setGithubOpen(false)} onLoad={handleGitHubLoad} githubToken={settings.githubToken} />
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} openTabs={tabs} fileTree={fileTree} onOpenFile={openFileInTab} onCommand={handleCommand} />
      <AuthModal open={authOpen} onClose={() => setAuthOpen(false)} />
    </div>
  );
}
