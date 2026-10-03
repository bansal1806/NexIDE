import { useState, useCallback, useEffect, useRef, useMemo, lazy, Suspense } from 'react';
import { useAuth } from './hooks/useAuth';
// eslint-disable-next-line no-unused-vars
import { motion, AnimatePresence } from 'framer-motion';
import { useDebugger } from './hooks/useDebugger';
import { DebugTimeline } from './components/DebugTimeline';
import {
  Settings as SettingsIcon, TerminalSquare, Files, Map as MapIcon, MessageSquare,
} from 'lucide-react';
import './App.css';
import './styles/playground.css'; // Playground design layer — must load after App.css

// Hooks
import { useCodeRunner }      from './hooks/useCodeRunner';
import { usePython }          from './hooks/usePython';
import { useGemini }          from './hooks/useGemini';
import { useNotice }          from './hooks/useNotice';
import { useSettings }        from './hooks/useSettings';
import { useWorkspace }       from './hooks/useWorkspace';
import { useProgramInput }    from './hooks/useProgramInput';
import { usePackageLocks }    from './hooks/usePackageLocks';
import { useDeployRecovery }  from './hooks/useDeployRecovery';
import { useGlobalShortcuts } from './hooks/useGlobalShortcuts';
import { useCelebrate }       from './hooks/useCelebrate';
import { useProject, projectRuntimeUnsupportedReason } from './hooks/useProject';
import { findNodeByPath }     from './utils/files';
import { stdinLines }         from './runtime/output';

// Components
import { FileExplorer }   from './components/FileExplorer';
import { StatusBar }      from './components/StatusBar';
import { TopBar }         from './components/TopBar';
import { Settings }       from './components/Settings';
import { GitHubModal }    from './components/GitHubModal';
import { WelcomeScreen }  from './components/WelcomeScreen';
import { CommandPalette } from './components/CommandPalette';
import { AuthModal }      from './components/AuthModal';
import { BottomPanel, RightPanel } from './components/Panels';
import { ChunkErrorBoundary } from './components/ChunkErrorBoundary';
import { TabBar } from './components/TabBar';
import { EDITOR_PANEL_ID, tabDomId } from './components/tabIds';

// Monaco loads on demand (the panels lazy-load d3 and sucrase themselves)
const Editor      = lazy(() => import('./components/Editor'));

const RUNNABLE = new Set(['javascript', 'typescript', 'python']);

export default function App() {
  // ── Auth ─────────────────────────────────────────────────────────
  const { user } = useAuth();
  const userId = user?.id ?? null;

  const { notice, notify } = useNotice();
  const [settings, setSettings] = useSettings(userId, notify);

  // ── Debugger ─────────────────────────────────────────────────────
  const {
    snapshots, currentIndex, currentSnapshot, previousSnapshot,
    isDebugging, isPlaying, playSpeed, changedVars, stats,
    breakpoints, watchList,
    startDebug, endDebug, addSnapshots, focusFirstBreakpoint, setPlayhead,
    stepForward, stepBackward, jumpToStart, jumpToEnd, clearSnapshots,
    toggleBreakpoint, jumpToNextBreakpoint, jumpToPrevBreakpoint,
    togglePlay, setPlaySpeed, addWatch, removeWatch,
  } = useDebugger();

  // ── UI panels / modals ───────────────────────────────────────────
  const [bottomPanel, setBottomPanel] = useState(null); // 'terminal' | 'console' | null
  const [rightPanel, setRightPanel]   = useState(null); // 'preview' | 'ai' | 'map' | 'debug' | null
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [githubOpen, setGithubOpen]   = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [authOpen, setAuthOpen]       = useState(false);

  const editorRef = useRef(null);

  // ── Workspace: tabs, files, local/GitHub/cloud ────────────────────
  const {
    fs, fileTree, rootName, workspaceKey,
    cloudMode, githubMode, githubInfo, visibleCloudProjects,
    tabs, setTabs, setActiveTabId, activeTab, activeTabRef, liveActiveTab,
    openFileInTab, newFileFromTemplate, handleEditorChange, saveFile, closeTab, hasUnsavedWork,
    buildRunFiles, projectFiles, newProjectFromTemplate, applyRuntimeChanges,
    handleOpenFolder, handleGitHubLoad, handleOpenCloudProject, handleCreateCloudProject,
    handleNewCloudFile, handleRefreshTree,
  } = useWorkspace({
    userId,
    notify,
    githubToken: settings.githubToken,
    autoSave: settings.autoSave,
    editorRef,
    onReset: () => { clearSnapshots(); endDebug(); },
    onRevealSidebar: () => setSidebarOpen(true),
    onNeedAuth: () => setAuthOpen(true),
  });

  // Breakpoints are per file; the editor only sees (and toggles) the active file's lines
  const activeBreakpointLines = useMemo(() => {
    const prefix = `${activeTab?.path}:`;
    return new Set([...breakpoints].filter(k => k.startsWith(prefix)).map(k => Number(k.slice(prefix.length))));
  }, [breakpoints, activeTab?.path]);
  const toggleActiveBreakpoint = useCallback((line) => {
    const path = activeTabRef.current?.path;
    if (path) toggleBreakpoint(path, line);
  }, [toggleBreakpoint, activeTabRef]);

  // ── Code execution ───────────────────────────────────────────────
  const {
    output: jsOutput, status: jsStatus, runCode: runJs, stop: stopJs, clearOutput: clearJs, addConsoleMessage,
    inputRequest: jsInputRequest, submitInput: submitJsInput, endInput: endJsInput,
  } = useCodeRunner();
  const {
    output: pyOutput, status: pyStatus, runPython, stopPython, clearOutput: clearPy,
    inputRequest: pyInputRequest, submitInput: submitPyInput, endInput: endPyInput,
  } = usePython();

  // ── Node.js projects (package.json at the root) run in the in-browser runtime ──
  // Installed packages' types → editor IntelliSense (cleared again when the workspace changes)
  const typesApplied = useRef(false);
  const applyProjectTypes = useCallback((files, tsconfig) => {
    typesApplied.current = true;
    import('./lib/projectTypes').then(m => m.setProjectTypes(files, tsconfig));
  }, []);
  const project = useProject({ onFilesChanged: applyRuntimeChanges, onTypes: applyProjectTypes });
  const { reset: resetProject, writeFile: syncProjectFile, rescan: rescanProject } = project;
  const projectUnsupported = useMemo(() => projectRuntimeUnsupportedReason(), []);
  // GitHub repos load file contents lazily, so they can't be mounted (yet)
  const isProject = !githubMode && !!findNodeByPath(fileTree, 'package.json');
  const projectActive = isProject && !projectUnsupported;
  useEffect(() => {
    resetProject();
    if (typesApplied.current) {
      typesApplied.current = false;
      import('./lib/projectTypes').then(m => m.setProjectTypes());
    }
  }, [workspaceKey, resetProject]);

  const startProject = useCallback(() => {
    setBottomPanel('terminal');
    setRightPanel('preview');
    project.start(projectFiles());
  }, [project, projectFiles]);

  const onEditorChange = useCallback((value) => {
    handleEditorChange(value);
    syncProjectFile(activeTabRef.current?.path, value);
  }, [handleEditorChange, syncProjectFile, activeTabRef]);

  const isPythonTab = activeTab?.lang === 'python';
  const consoleOutput = isPythonTab ? pyOutput : jsOutput;
  const PROJECT_RUN_STATUS = { booting: 'running', installing: 'running', starting: 'running', ready: 'success', error: 'error' };
  const runStatus = projectActive
    ? (PROJECT_RUN_STATUS[project.status] || 'idle')
    : ((isPythonTab ? pyStatus : jsStatus) || 'idle');
  const isRunning = jsStatus === 'running' || pyStatus === 'running';
  useCelebrate(runStatus);

  // ── AI ───────────────────────────────────────────────────────────
  const gemini = useGemini({ apiKey: settings.geminiApiKey });
  const { sendMessage: sendAiMessage } = gemini;

  const handleAiAction = useCallback((action, lineNum, snippet) => {
    setRightPanel('ai');
    const prompt = action === 'explain'
      ? `Explain the "${snippet}" structure near line ${lineNum}.`
      : action === 'debug'
      ? `Look for bugs or improvements in "${snippet}" near line ${lineNum}.`
      : `Write a clean docstring for "${snippet}" near line ${lineNum}.`;
    const tab = activeTabRef.current;
    sendAiMessage(prompt, tab?.content || '', tab?.lang || 'plaintext');
  }, [sendAiMessage, activeTabRef]);

  // ── Cursor / editor ──────────────────────────────────────────────
  const [cursorPos, setCursorPos] = useState({ line: 1, col: 1 });
  // Program input (console "Input" box), remembered per file across reloads
  const { stdinFor, setStdinFor } = useProgramInput();
  const stdinText = stdinFor(activeTab?.path);
  const setStdinText = useCallback((text) => setStdinFor(activeTabRef.current?.path, text), [setStdinFor, activeTabRef]);

  // Time-travel follows execution into other workspace files (opens/activates their tab)
  const followFile = isDebugging && !isRunning ? currentSnapshot?.file : null; // not while still recording
  useEffect(() => {
    if (!followFile || followFile === activeTabRef.current?.path) return;
    let cancelled = false;
    Promise.resolve().then(() => {
      if (!cancelled) openFileInTab({ path: followFile, name: followFile.split('/').pop() });
    });
    return () => { cancelled = true; };
  }, [followFile, openFileInTab, activeTabRef]);

  const handleMapNodeClick = useCallback(async (node) => {
    if (node.type === 'folder') return;
    if (node.path) await openFileInTab(node);
    if (node.line) {
      setTimeout(() => {
        const editor = editorRef.current;
        if (!editor) return;
        editor.revealLineInCenter(node.line);
        editor.setPosition({ lineNumber: node.line, column: 1 });
        editor.focus();
      }, 100);
    }
  }, [openFileInTab]);

  // ── Run / debug ──────────────────────────────────────────────────
  const { lockFor, savePins, clearPins: clearWorkspacePins, unpin } = usePackageLocks();
  const clearPins = useCallback(() => {
    clearWorkspacePins(workspaceKey);
    notify('info', 'npm packages will resolve to their latest versions on the next run.');
  }, [clearWorkspacePins, workspaceKey, notify]);

  const runTab = useCallback((tab, options = {}) => {
    if (!tab) return null;
    setBottomPanel('console');
    const opts = { ...options, stdin: stdinLines(stdinFor(tab.path)), path: tab.path, files: buildRunFiles(tab) };
    if (tab.lang === 'python') return runPython(tab.content, opts);
    const key = workspaceKey;
    const run = runJs(tab.content, tab.lang, { ...opts, packageLock: lockFor(key) });
    run?.then?.(result => savePins(key, result?.pins));
    return run;
  }, [runPython, runJs, stdinFor, buildRunFiles, workspaceKey, lockFor, savePins]);

  const runCode = useCallback(() => (projectActive ? startProject() : runTab(liveActiveTab())),
    [projectActive, startProject, runTab, liveActiveTab]);

  const stopRun = useCallback(() => {
    stopPython();
    stopJs();
  }, [stopPython, stopJs]);

  const runDebug = useCallback(async () => {
    const tab = liveActiveTab();
    if (!tab) return;
    if (!RUNNABLE.has(tab.lang)) {
      notify('info', 'The debugger supports JavaScript, TypeScript and Python.');
      return;
    }
    setRightPanel('debug');
    startDebug();
    await runTab(tab, { debug: true, onDebugSteps: addSnapshots });
    focusFirstBreakpoint();
  }, [runTab, liveActiveTab, startDebug, addSnapshots, focusFirstBreakpoint, notify]);

  const exitDebug = useCallback(() => {
    clearSnapshots();
    endDebug();
    setRightPanel(null);
  }, [clearSnapshots, endDebug]);

  const handleCommand = useCallback((cmd) => {
    switch (cmd) {
      case 'open-folder':     handleOpenFolder();  break;
      case 'open-github':     setGithubOpen(true); break;
      case 'toggle-terminal': setBottomPanel(v => v === 'terminal' ? null : 'terminal'); break;
      case 'open-settings':   setSettingsOpen(true); break;
      case 'run-file':        runCode();           break;
      case 'npm-update-pins': clearPins();         break;
    }
  }, [handleOpenFolder, runCode, clearPins]);

  const handleTerminalRun = useCallback(async (path) => {
    const tab = await openFileInTab({ path, name: path.split('/').pop() });
    if (!tab) return;
    if (!RUNNABLE.has(tab.lang)) { notify('info', `Cannot run ${tab.name}: unsupported language.`); return; }
    runTab(tab);
  }, [openFileInTab, runTab, notify]);

  // ── Deploy recovery & global keyboard shortcuts ─────────────────
  useDeployRecovery(hasUnsavedWork, notify);

  const anyModalOpen = settingsOpen || paletteOpen || githubOpen || authOpen;
  useGlobalShortcuts({
    isDebugging,
    anyModalOpen,
    onDebug: () => { if (activeTabRef.current) runDebug(); },
    onStep: stepForward,
    onNextBreakpoint: jumpToNextBreakpoint,
    onPrevBreakpoint: jumpToPrevBreakpoint,
    onExitDebug: exitDebug,
    onTogglePalette: () => setPaletteOpen(v => !v),
    onSave: saveFile,
    onRun: runCode,
    onToggleSidebar: () => setSidebarOpen(v => !v),
    onToggleAi: () => setRightPanel(p => p === 'ai' ? null : 'ai'),
    onToggleTerminal: () => setBottomPanel(v => v === 'terminal' ? null : 'terminal'),
    onOpenSettings: () => setSettingsOpen(true),
  });

  // ── Derived view state ───────────────────────────────────────────
  const showWelcome = fileTree.length === 0 && tabs.length === 0 && !cloudMode;
  const statusNotice = notice || (fs.error ? { type: 'error', text: fs.error } : null);

  const clearConsole = isPythonTab ? clearPy : clearJs;

  // Inspector shows the innermost frame first, at the line currently executing
  const inspectorStack = useMemo(() => {
    if (!currentSnapshot) return [];
    const frames = [...(currentSnapshot.callStack || [])].reverse();
    if (!frames.some(f => f.name === '(module)')) frames.push({ name: '(program)' });
    frames[0] = { ...frames[0], line: currentSnapshot.line };
    return frames;
  }, [currentSnapshot]);

  return (
    <div className="app" id="nexide-app" data-theme={settings.theme || 'nexide-dark'}>

      <TopBar
        project={projectActive ? { status: project.status, onStart: startProject, onStop: project.stop } : null}
        language={activeTab?.lang || 'plaintext'}
        onLanguageChange={(lang) => {
          const id = activeTabRef.current?.id;
          setTabs(prev => prev.map(t => t.id === id ? { ...t, lang } : t));
        }}
        onRun={runCode}
        onStop={stopRun}
        onDebug={runDebug}
        onSave={saveFile}
        isRunning={isRunning}
        activePanel={rightPanel}
        onPanelChange={(p) => p === 'console'
          ? setBottomPanel(v => v === 'console' ? null : 'console')
          : setRightPanel(cur => cur === p ? null : p)}
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
        <div className="activity-bar" id="activity-bar" role="navigation" aria-label="Activity bar">
          <button className={`activity-btn ${sidebarOpen ? 'active' : ''}`} onClick={() => setSidebarOpen(v => !v)} title="Explorer" aria-label="Explorer">
            <Files size={18} />
          </button>
          <button className={`activity-btn ${rightPanel === 'map' ? 'active' : ''}`} onClick={() => setRightPanel(p => p === 'map' ? null : 'map')} title="Code Map" aria-label="Code map">
            <MapIcon size={18} />
          </button>
          <button className={`activity-btn ${rightPanel === 'ai' ? 'active' : ''}`} onClick={() => setRightPanel(p => p === 'ai' ? null : 'ai')} title="AI Assistant" aria-label="AI assistant">
            <MessageSquare size={18} />
          </button>
          <div className="activity-spacer" />
          <button className={`activity-btn ${bottomPanel === 'terminal' ? 'active' : ''}`} onClick={() => setBottomPanel(v => v === 'terminal' ? null : 'terminal')} title="Terminal" aria-label="Terminal">
            <TerminalSquare size={18} />
          </button>
          <button className="activity-btn activity-settings-btn" onClick={() => setSettingsOpen(true)} title="Settings" aria-label="Settings">
            <SettingsIcon size={18} />
          </button>
        </div>

        <AnimatePresence initial={false}>
          {sidebarOpen && (
            <motion.div
              className="sidebar"
              role="complementary"
              aria-label="Explorer"
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
                onRefresh={() => { if (projectActive) rescanProject(); handleRefreshTree(); }}
                githubMode={githubMode}
                githubInfo={githubInfo}
                cloudMode={cloudMode}
                cloudProjects={visibleCloudProjects}
                onOpenCloudProject={handleOpenCloudProject}
                onCreateCloudProject={handleCreateCloudProject}
                onNewCloudFile={handleNewCloudFile}
                user={user}
              />
            </motion.div>
          )}
        </AnimatePresence>

        <div className="editor-column" id="editor-column" role="main">
          {showWelcome ? (
            <WelcomeScreen
              onOpenFolder={handleOpenFolder}
              onOpenGitHub={() => setGithubOpen(true)}
              onNewFile={(tpl) => newFileFromTemplate(tpl.id)}
              onNewProject={(tpl) => newProjectFromTemplate(tpl.id)}
              projectsUnsupported={projectUnsupported}
              isSupported={fs.isSupported}
            />
          ) : (
            <div className="editor-area-wrapper">
              {tabs.length > 0 && (
                <TabBar tabs={tabs} activeId={activeTab?.id} onActivate={setActiveTabId} onClose={closeTab} />
              )}
              {activeTab && (
                <div className="editor-area" id={EDITOR_PANEL_ID} role="tabpanel" aria-labelledby={tabDomId(activeTab.id)}>
                  <ChunkErrorBoundary name="Editor"><Suspense fallback={<div className="panel-loading" style={{ padding: 16, color: 'var(--text-muted)' }}>Loading editor…</div>}>
                  <Editor
                    code={activeTab.content}
                    path={activeTab.path}
                    language={activeTab.lang}
                    onChange={onEditorChange}
                    onCursorChange={setCursorPos}
                    onRun={runCode}
                    onSave={saveFile}
                    onAiAction={handleAiAction}
                    externalRef={editorRef}
                    debugLine={isDebugging && currentSnapshot && (!currentSnapshot.file || currentSnapshot.file === activeTab.path) ? currentSnapshot.line : null}
                    breakpoints={activeBreakpointLines}
                    onToggleBreakpoint={toggleActiveBreakpoint}
                    theme={settings.theme}
                    fontSize={settings.fontSize}
                    tabSize={settings.tabSize}
                    wordWrap={settings.wordWrap}
                    minimap={settings.minimap}
                    fontLigatures={settings.fontLigatures}
                  />
                  </Suspense></ChunkErrorBoundary>
                </div>
              )}
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
              onReset={exitDebug}
              onTogglePlay={togglePlay}
              onPrevBreakpoint={jumpToPrevBreakpoint}
              onNextBreakpoint={jumpToNextBreakpoint}
              isPlaying={isPlaying}
              playSpeed={playSpeed}
              onSpeedChange={setPlaySpeed}
              breakpoints={breakpoints}
              stats={stats}
              isLive={isRunning && currentIndex === snapshots.length - 1}
            />
          )}
          {bottomPanel && (
            <BottomPanel
              panel={bottomPanel}
              onSelect={setBottomPanel}
              onClose={() => setBottomPanel(null)}
              terminal={{ fileTree, activeFilePath: activeTab?.path, onRunFile: handleTerminalRun }}
              project={projectActive ? project : null}
              console={{
                lines: consoleOutput,
                onClear: clearConsole,
                stdin: stdinText,
                onStdinChange: setStdinText,
                inputRequest: isPythonTab ? pyInputRequest : jsInputRequest,
                onSubmitInput: isPythonTab ? submitPyInput : submitJsInput,
                onEndInput: isPythonTab ? endPyInput : endJsInput,
              }}
            />
          )}
        </div>

        {rightPanel && (
          <RightPanel
            panel={rightPanel}
            onSelect={setRightPanel}
            onClose={() => setRightPanel(null)}
            preview={{ code: activeTab?.content || '', language: activeTab?.lang || 'plaintext', onConsoleMessage: addConsoleMessage }}
            projectPreview={projectActive ? { status: project.status, url: project.url, error: project.error, onStart: startProject } : null}
            ai={{
              gemini,
              editorCode: activeTab?.content || '',
              language: activeTab?.lang || 'plaintext',
              hasApiKey: !!settings.geminiApiKey,
              isSignedIn: !!user,
              onApiKeyNeeded: () => setSettingsOpen(true),
            }}
            map={{ activeTab, fileTree, onNodeClick: handleMapNodeClick }}
            packages={{
              workspaceLabel: rootName || 'Scratch files',
              pins: lockFor(workspaceKey),
              onUnpin: (spec) => unpin(workspaceKey, spec),
              onUpdateAll: clearPins,
            }}
            debug={{
              snapshot: currentSnapshot,
              previousSnapshot,
              changedVars,
              watchList,
              onAddWatch: addWatch,
              onRemoveWatch: removeWatch,
              callStack: inspectorStack,
            }}
          />
        )}

      </div>

      <StatusBar
        language={activeTab?.lang || ''}
        cursorLine={cursorPos.line}
        cursorCol={cursorPos.col}
        status={runStatus}
        fileName={activeTab?.name}
        isDirty={activeTab?.dirty}
        githubMode={githubMode}
        branch={githubInfo?.branch}
        notice={statusNotice}
      />

      <Settings open={settingsOpen} onClose={() => setSettingsOpen(false)} settings={settings} onSettingsChange={setSettings} isExhausted={gemini.isExhausted} />
      <GitHubModal open={githubOpen} onClose={() => setGithubOpen(false)} onLoad={handleGitHubLoad} githubToken={settings.githubToken} />
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} openTabs={tabs} fileTree={fileTree} onOpenFile={openFileInTab} onCommand={handleCommand} />
      <AuthModal open={authOpen} onClose={() => setAuthOpen(false)} />
    </div>
  );
}
