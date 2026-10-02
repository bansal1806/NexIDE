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

// Hooks
import { useFileSystem }  from './hooks/useFileSystem';
import { useCodeRunner }  from './hooks/useCodeRunner';
import { usePython }      from './hooks/usePython';
import { useGemini }      from './hooks/useGemini';
import { useMonacoWorkspace } from './hooks/useMonacoWorkspace';

// Services
import { fetchFileContent } from './services/github';
import { useNotice } from './hooks/useNotice';
import { useSettings } from './hooks/useSettings';
import { useProgramInput } from './hooks/useProgramInput';
import { usePackageLocks } from './hooks/usePackageLocks';
import { useDeployRecovery } from './hooks/useDeployRecovery';
import { useGlobalShortcuts } from './hooks/useGlobalShortcuts';
import { fetchProjects, createProject, fetchProjectFiles, saveFileToCloud } from './services/db';
import { stdinLines } from './runtime/output';
import { getLang, findNodeByPath, flattenFiles, buildTreeFromPaths, normalizeRelativePath } from './utils/files';

// Components
import { FileExplorer }   from './components/FileExplorer';
import { STARTERS }       from './components/starters';
import { StatusBar }      from './components/StatusBar';
import { TopBar }         from './components/TopBar';
import { Settings }       from './components/Settings';
import { GitHubModal }    from './components/GitHubModal';
import { WelcomeScreen }  from './components/WelcomeScreen';
import { CommandPalette } from './components/CommandPalette';
import { AuthModal }      from './components/AuthModal';
import { BottomPanel, RightPanel } from './components/Panels';
import { ChunkErrorBoundary } from './components/ChunkErrorBoundary';

// Monaco loads on demand (the panels lazy-load d3 and sucrase themselves)
const Editor      = lazy(() => import('./components/Editor'));

const RUNNABLE = new Set(['javascript', 'typescript', 'python']);

const TEMPLATES = {
  js:   { file: 'main.js',    lang: 'javascript' },
  py:   { file: 'main.py',    lang: 'python' },
  html: { file: 'index.html', lang: 'html' },
  ts:   { file: 'main.ts',    lang: 'typescript' },
};
const BINARY_EXT = /\.(png|jpe?g|gif|webp|ico|bmp|pdf|zip|gz|tar|7z|woff2?|ttf|otf|eot|mp[34]|wav|ogg|webm|mov|exe|dll|so|wasm|class|jar)$/i;

let tabIdCounter = 1;

export default function App() {
  // ── Auth ─────────────────────────────────────────────────────────
  const { user } = useAuth();
  const userId = user?.id ?? null;

  const { notice, notify } = useNotice();
  const [settings, setSettings] = useSettings(userId, notify);

  // ── Cloud projects ───────────────────────────────────────────────
  const [cloudMode, setCloudMode] = useState(false);
  const [cloudProjects, setCloudProjects] = useState([]);
  const [activeProjectId, setActiveProjectId] = useState(null);

  const loadCloudProjects = useCallback(async () => {
    try {
      setCloudProjects(await fetchProjects());
    } catch (e) {
      console.error('Loading projects failed:', e);
    }
  }, []);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    fetchProjects()
      .then(projects => { if (!cancelled) setCloudProjects(projects); })
      .catch(e => console.error('Loading projects failed:', e));
    return () => { cancelled = true; };
  }, [userId]);

  const visibleCloudProjects = userId ? cloudProjects : [];

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

  // ── File system / workspaces ─────────────────────────────────────
  const fs = useFileSystem();
  const [workspaceFiles, setWorkspaceFiles] = useState([]);
  const [githubMode, setGithubMode] = useState(false);
  const [githubInfo, setGithubInfo] = useState(null);
  const [githubTree, setGithubTree] = useState([]); // also holds the cloud project tree

  const fileTree = (cloudMode || githubMode) ? githubTree : fs.fileTree;

  // ── Tabs ─────────────────────────────────────────────────────────
  const [tabs, setTabs] = useState([]);
  const [activeTabId, setActiveTabId] = useState(null);
  const tabsRef = useRef(tabs);
  useEffect(() => { tabsRef.current = tabs; }, [tabs]);

  const activeTab = useMemo(
    () => tabs.find(t => t.id === activeTabId) || tabs[0] || null,
    [tabs, activeTabId]
  );
  const activeTabRef = useRef(activeTab);
  useEffect(() => { activeTabRef.current = activeTab; }, [activeTab]);

  // Breakpoints are per file; the editor only sees (and toggles) the active file's lines
  const activeBreakpointLines = useMemo(() => {
    const prefix = `${activeTab?.path}:`;
    return new Set([...breakpoints].filter(k => k.startsWith(prefix)).map(k => Number(k.slice(prefix.length))));
  }, [breakpoints, activeTab?.path]);
  const toggleActiveBreakpoint = useCallback((line) => {
    const path = activeTabRef.current?.path;
    if (path) toggleBreakpoint(path, line);
  }, [toggleBreakpoint]);

  // ── UI panels / modals ───────────────────────────────────────────
  const [bottomPanel, setBottomPanel] = useState(null); // 'terminal' | 'console' | null
  const [rightPanel, setRightPanel]   = useState(null); // 'preview' | 'ai' | 'map' | 'debug' | null
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [githubOpen, setGithubOpen]   = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [authOpen, setAuthOpen]       = useState(false);

  // ── Code execution ───────────────────────────────────────────────
  const {
    output: jsOutput, status: jsStatus, runCode: runJs, stop: stopJs, clearOutput: clearJs, addConsoleMessage,
    inputRequest: jsInputRequest, submitInput: submitJsInput, endInput: endJsInput,
  } = useCodeRunner();
  const {
    output: pyOutput, status: pyStatus, runPython, stopPython, clearOutput: clearPy,
    inputRequest: pyInputRequest, submitInput: submitPyInput, endInput: endPyInput,
  } = usePython();

  const isPythonTab = activeTab?.lang === 'python';
  const consoleOutput = isPythonTab ? pyOutput : jsOutput;
  const runStatus = (isPythonTab ? pyStatus : jsStatus) || 'idle';
  const isRunning = jsStatus === 'running' || pyStatus === 'running';

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
  }, [sendAiMessage]);

  // ── Cursor / editor ──────────────────────────────────────────────
  const [cursorPos, setCursorPos] = useState({ line: 1, col: 1 });
  // Program input (console "Input" box), remembered per file across reloads
  const { stdinFor, setStdinFor } = useProgramInput();
  const stdinText = stdinFor(activeTab?.path);
  const setStdinText = useCallback((text) => setStdinFor(activeTabRef.current?.path, text), [setStdinFor]);
  const editorRef = useRef(null);

  // The active tab with the editor's *live* text. React state lags the editor by a render,
  // so a shortcut pressed right after typing (Ctrl+Enter / Ctrl+S) must read the model.
  const liveActiveTab = useCallback(() => {
    const tab = activeTabRef.current;
    const model = editorRef.current?.getModel?.();
    if (!tab || !model || model.uri.path !== `/${tab.path}`) return tab;
    const content = model.getValue();
    return content === tab.content ? tab : { ...tab, content };
  }, []);

  const confirmDiscard = useCallback((action) => (
    !tabsRef.current.some(t => t.dirty) ||
    window.confirm(`You have unsaved changes. ${action} and discard them?`)
  ), []);

  const resetWorkspace = useCallback(() => {
    setTabs([]);
    setActiveTabId(null);
    clearSnapshots();
    endDebug();
  }, [clearSnapshots, endDebug]);

  // ── Open a file into a tab ───────────────────────────────────────
  const openFileInTab = useCallback(async (input) => {
    if (!input?.path) return null;
    const existing = tabsRef.current.find(t => t.path === input.path);
    if (existing) { setActiveTabId(existing.id); return existing; }

    // Callers like the code map / terminal pass bare { path }; resolve the real tree node
    const node = (input.handle || typeof input._content === 'string')
      ? input
      : (findNodeByPath(fileTree, input.path) || input);
    if (node.kind === 'directory') return null;

    const name = node.name || node.path.split('/').pop();
    if (BINARY_EXT.test(name)) {
      notify('info', `${name} looks like a binary file and can't be opened in the editor.`);
      return null;
    }

    let content = '';
    try {
      if (node.handle) {
        content = await fs.readFile(node.handle);
      } else if (typeof node._content === 'string') {
        content = node._content;
      } else if (githubMode && githubInfo) {
        content = await fetchFileContent(githubInfo.owner, githubInfo.repo, node.path, githubInfo.branch, settings.githubToken);
        node._content = content; // cache on the tree node
      }
    } catch (e) {
      notify('error', `Could not open ${node.path}: ${e.message}`);
      return null;
    }

    // It may have been opened while we were loading
    const dup = tabsRef.current.find(t => t.path === node.path);
    if (dup) { setActiveTabId(dup.id); return dup; }

    const tab = { id: tabIdCounter++, name, path: node.path, lang: getLang(name), content, handle: node.handle || null, dirty: false };
    setTabs(prev => [...prev, tab]);
    setActiveTabId(tab.id);
    return tab;
  }, [fileTree, fs, githubMode, githubInfo, settings.githubToken, notify]);

  // Time-travel follows execution into other workspace files (opens/activates their tab)
  const followFile = isDebugging && !isRunning ? currentSnapshot?.file : null; // not while still recording
  useEffect(() => {
    if (!followFile || followFile === activeTabRef.current?.path) return;
    let cancelled = false;
    Promise.resolve().then(() => {
      if (!cancelled) openFileInTab({ path: followFile, name: followFile.split('/').pop() });
    });
    return () => { cancelled = true; };
  }, [followFile, openFileInTab]);

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

  const newFileFromTemplate = useCallback((templateId) => {
    const template = TEMPLATES[templateId] || TEMPLATES.js;
    const [base, ext] = template.file.split('.');
    const content = STARTERS[template.lang] || '';
    let name = template.file;
    for (let n = 2; tabsRef.current.some(t => t.path === name); n++) name = `${base}-${n}.${ext}`;
    const tab = { id: tabIdCounter++, name, path: name, lang: getLang(name), content, handle: null, dirty: false };
    setTabs(prev => [...prev, tab]);
    setActiveTabId(tab.id);
  }, []);

  const handleEditorChange = useCallback((value) => {
    const id = activeTabRef.current?.id;
    if (id == null) return;
    setTabs(prev => prev.map(t =>
      t.id === id && t.content !== value ? { ...t, content: value, dirty: true } : t
    ));
  }, []);

  // ── Saving ───────────────────────────────────────────────────────
  const refreshCloudTree = useCallback(async (projectId) => {
    const files = await fetchProjectFiles(projectId);
    setGithubTree(buildTreeFromPaths(files));
    setWorkspaceFiles(files);
  }, []);

  const saveTab = useCallback(async (tab, { silent = false } = {}) => {
    if (!tab) return false;
    try {
      if (cloudMode && activeProjectId) {
        const isNew = !findNodeByPath(githubTree, tab.path);
        await saveFileToCloud(activeProjectId, tab.path, tab.name, tab.content, tab.lang);
        if (isNew) await refreshCloudTree(activeProjectId);
        else findNodeByPath(githubTree, tab.path)._content = tab.content;
      } else if (githubMode) {
        if (!silent) notify('info', 'GitHub files are read-only here. Copy your changes or open the repo as a local folder.');
        return false;
      } else if (tab.handle?.fallback) {
        await fs.writeFile(tab.handle, tab.content);
        if (!silent) notify('info', 'Saved in memory only — this browser cannot write to disk. Use Chrome/Edge to save files.');
      } else if (tab.handle) {
        await fs.writeFile(tab.handle, tab.content);
      } else if ('showSaveFilePicker' in window && !silent) {
        // Untitled tab: "Save As"
        const handle = await window.showSaveFilePicker({ suggestedName: tab.name });
        await fs.writeFile(handle, tab.content);
        setTabs(prev => prev.map(t => t.id === tab.id ? { ...t, handle, name: handle.name, path: handle.name, lang: getLang(handle.name) } : t));
      } else {
        if (!silent) notify('info', 'Open a folder or a cloud project to save files.');
        return false;
      }
      // Only clear dirty if nothing changed while saving. For the visible tab the editor model
      // is the source of truth (state may still be catching up with the last keystrokes).
      const model = editorRef.current?.getModel?.();
      const liveText = model && model.uri.path === `/${tab.path}` ? model.getValue() : null;
      setTabs(prev => prev.map(t => {
        if (t.id !== tab.id) return t;
        const current = liveText ?? t.content;
        return current === tab.content ? { ...t, content: tab.content, dirty: false } : t;
      }));
      return true;
    } catch (e) {
      if (e?.name === 'AbortError') return false; // user cancelled a picker
      console.error('Save failed:', e);
      notify('error', `Save failed: ${e.message || e}`);
      return false;
    }
  }, [cloudMode, activeProjectId, githubMode, githubTree, fs, notify, refreshCloudTree]);

  const saveFile = useCallback(() => saveTab(liveActiveTab()), [saveTab, liveActiveTab]);

  // Auto Save: 1s after the last edit, for files that have a real backing store
  useEffect(() => {
    if (!settings.autoSave || !activeTab?.dirty) return;
    const backed = (cloudMode && activeProjectId) || (activeTab.handle && !activeTab.handle.fallback);
    if (!backed) return;
    const t = setTimeout(() => saveTab(activeTab, { silent: true }), 1000);
    return () => clearTimeout(t);
  }, [settings.autoSave, activeTab, cloudMode, activeProjectId, saveTab]);

  const closeTab = useCallback((tabId, e) => {
    e?.stopPropagation();
    const current = tabsRef.current;
    const tab = current.find(t => t.id === tabId);
    if (!tab) return;
    if (tab.dirty && !window.confirm(`Discard unsaved changes to ${tab.name}?`)) return;
    const idx = current.indexOf(tab);
    const remaining = current.filter(t => t.id !== tabId);
    setTabs(prev => prev.filter(t => t.id !== tabId));
    if (activeTabRef.current?.id === tabId) {
      setActiveTabId(remaining.length ? remaining[Math.max(0, idx - 1)].id : null);
    }
  }, []);

  // ── Run / debug ──────────────────────────────────────────────────
  // Files available to `import` (JS/TS) and `import` / `open()` (Python) during a run:
  // preloaded workspace sources, cached tree contents, then open tabs (newest edits win).
  const buildRunFiles = useCallback((runningTab) => {
    const MAX_TOTAL = 5 * 1024 * 1024;
    const files = {};
    let total = 0;
    const add = (path, content) => {
      if (typeof content !== 'string') return;
      total += content.length - (files[path]?.length || 0);
      if (total <= MAX_TOTAL) files[path] = content;
    };
    workspaceFiles.forEach(f => add(f.path, f.content));
    flattenFiles(fileTree).forEach(n => add(n.path, n._content));
    tabsRef.current.forEach(t => add(t.path, t.content));
    if (runningTab) add(runningTab.path, runningTab.content);
    return files;
  }, [workspaceFiles, fileTree]);

  // npm packages are pinned per workspace on first use (reproducible runs; pinned esm.sh URLs
  // are immutable, so the service worker can serve them offline)
  const workspaceKey = cloudMode ? `cloud:${activeProjectId}`
    : githubMode ? `github:${githubInfo?.owner}/${githubInfo?.repo}`
    : fs.rootName ? `local:${fs.rootName}` : 'scratch';
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

  const runCode = useCallback(() => runTab(liveActiveTab()), [runTab, liveActiveTab]);

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

  // ── Workspace switching ──────────────────────────────────────────
  const handleOpenFolder = useCallback(async () => {
    if (!confirmDiscard('Open a new folder')) return;
    const result = await fs.openFolder();
    if (!result) return;
    setGithubMode(false);
    setCloudMode(false);
    setActiveProjectId(null);
    setGithubInfo(null);
    setGithubTree([]);
    resetWorkspace();
    setWorkspaceFiles(await fs.readAllFiles(result.tree));
  }, [fs, confirmDiscard, resetWorkspace]);

  const handleGitHubLoad = useCallback((info) => {
    if (!confirmDiscard('Open a new repository')) return;
    setGithubMode(true);
    setCloudMode(false);
    setActiveProjectId(null);
    setGithubInfo({ owner: info.owner, repo: info.repo, branch: info.branch });
    setGithubTree(info.tree);
    setWorkspaceFiles([]);
    resetWorkspace();
    setSidebarOpen(true);
    if (info.truncated) notify('info', 'Large repository: GitHub returned a partial file tree.');
  }, [confirmDiscard, resetWorkspace, notify]);

  const handleOpenCloudProject = useCallback(async (project) => {
    const sameProject = cloudMode && project.id === activeProjectId;
    if (!sameProject && !confirmDiscard('Open this project')) return;
    setGithubMode(false);
    setCloudMode(true);
    setActiveProjectId(project.id);
    setGithubInfo(null);
    setGithubTree([]);
    resetWorkspace();
    try {
      await refreshCloudTree(project.id);
    } catch (e) {
      notify('error', `Could not load project: ${e.message}`);
    }
    setSidebarOpen(true);
  }, [cloudMode, activeProjectId, confirmDiscard, resetWorkspace, refreshCloudTree, notify]);

  const handleCreateCloudProject = useCallback(async () => {
    if (!userId) { setAuthOpen(true); return; }
    const name = window.prompt('Project name:')?.trim();
    if (!name) return;
    if (name.length > 100) { notify('error', 'Project name must be 100 characters or fewer.'); return; }
    try {
      const project = await createProject(userId, name);
      await loadCloudProjects();
      await handleOpenCloudProject(project);
    } catch (e) {
      notify('error', `Could not create project: ${e.message}`);
    }
  }, [userId, loadCloudProjects, handleOpenCloudProject, notify]);

  const handleNewCloudFile = useCallback(async () => {
    if (!activeProjectId) return;
    const raw = window.prompt('New file path (e.g. src/index.js):');
    if (raw == null) return;
    const path = normalizeRelativePath(raw);
    if (!path) { notify('error', 'Invalid file path.'); return; }
    if (findNodeByPath(githubTree, path)) { openFileInTab({ path }); return; }
    const name = path.split('/').pop();
    try {
      await saveFileToCloud(activeProjectId, path, name, '', getLang(name));
      await refreshCloudTree(activeProjectId);
      await openFileInTab({ path, name, kind: 'file', _content: '' });
    } catch (e) {
      notify('error', `Could not create file: ${e.message}`);
    }
  }, [activeProjectId, githubTree, openFileInTab, refreshCloudTree, notify]);

  const handleRefreshTree = useCallback(() => {
    if (cloudMode && activeProjectId) {
      refreshCloudTree(activeProjectId).catch(e => notify('error', e.message));
    } else {
      fs.refreshTree();
    }
  }, [cloudMode, activeProjectId, refreshCloudTree, fs, notify]);

  // Edits made to background Monaco models (e.g. multi-file rename)
  const handleBackgroundModelChange = useCallback((path, content) => {
    setTabs(prev => {
      const idx = prev.findIndex(t => t.path === path);
      if (idx !== -1) {
        if (prev[idx].content === content) return prev;
        const next = [...prev];
        next[idx] = { ...next[idx], content, dirty: true };
        return next;
      }
      const name = path.split('/').pop();
      return [...prev, {
        id: tabIdCounter++, name, path, lang: getLang(name), content,
        handle: findNodeByPath(fs.fileTree, path)?.handle ?? null,
        dirty: true,
      }];
    });
  }, [fs.fileTree]);

  useMonacoWorkspace(workspaceFiles, handleBackgroundModelChange);

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
  const hasUnsavedWork = useCallback(() => tabsRef.current.some(t => t.dirty), []);
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
  const activeProjectName = visibleCloudProjects.find(p => p.id === activeProjectId)?.name;
  const rootName = cloudMode
    ? activeProjectName
    : (githubMode ? (githubInfo ? `${githubInfo.owner}/${githubInfo.repo}` : 'GitHub') : fs.rootName);
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
        <div className="activity-bar" id="activity-bar">
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
                onRefresh={handleRefreshTree}
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
                    <div
                      key={tab.id}
                      className={`tab ${tab.id === activeTab?.id ? 'active' : ''}`}
                      onClick={() => setActiveTabId(tab.id)}
                      role="tab"
                      aria-selected={tab.id === activeTab?.id}
                      title={tab.path}
                    >
                      <span className="tab-name">{tab.name}</span>
                      {tab.dirty && <span className="tab-unsaved" aria-label="unsaved" />}
                      <button className="tab-close" onClick={(e) => closeTab(tab.id, e)} aria-label={`Close ${tab.name}`}>×</button>
                    </div>
                  ))}
                </div>
              )}
              {activeTab && (
                <div className="editor-area">
                  <ChunkErrorBoundary name="Editor"><Suspense fallback={<div className="panel-loading" style={{ padding: 16, color: 'var(--text-muted)' }}>Loading editor…</div>}>
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

          {bottomPanel && (
            <BottomPanel
              panel={bottomPanel}
              onSelect={setBottomPanel}
              onClose={() => setBottomPanel(null)}
              terminal={{ fileTree, activeFilePath: activeTab?.path, onRunFile: handleTerminalRun }}
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
