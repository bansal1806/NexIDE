import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { useFileSystem } from './useFileSystem';
import { useMonacoWorkspace } from './useMonacoWorkspace';
import { fetchFileContent, fetchRepoFiles } from '../services/github';
import { fetchProjects, createProject, fetchProjectFiles, saveFileToCloud, deleteFileFromCloud } from '../services/db';
import { getLang, findNodeByPath, flattenFiles, buildTreeFromPaths, normalizeRelativePath, isBinaryName, withFileChanges } from '../utils/files';
import { shouldSyncPath, MAX_SYNC_BYTES } from '../runtime/project';
import { STARTERS } from '../components/starters';
import { PROJECT_TEMPLATES, templateFiles } from '../projects/templates';

const TEMPLATES = {
  js:   { file: 'main.js',    lang: 'javascript' },
  py:   { file: 'main.py',    lang: 'python' },
  html: { file: 'index.html', lang: 'html' },
  ts:   { file: 'main.ts',    lang: 'typescript' },
};
// Running a GitHub repo as a project downloads its text files; beyond this it's too big for a tab
const MAX_REPO_FILES = 1500;
const MAX_REPO_BYTES = 30 * 1024 * 1024;

// File each project template opens first
const PROJECT_ENTRY = {
  next: 'app/page.jsx', 'next-ts': 'app/page.tsx', react: 'src/App.jsx', 'react-ts': 'src/App.tsx',
  vue: 'src/App.vue', svelte: 'src/App.svelte', astro: 'src/pages/index.astro',
  sveltekit: 'src/routes/+page.svelte', 'react-router': 'app/routes/home.jsx', nuxt: 'app.vue', express: 'server.js',
};

let tabIdCounter = 1;

/**
 * Open files (tabs) and the workspace they belong to: a local folder, a GitHub repo, a cloud
 * project, a starter project (Next.js, Vite…), or scratch templates. Handles opening, editing, saving (incl. Auto Save), closing,
 * switching workspaces, and which files a run can import.
 *
 * @param {object} opts
 * @param {string|null} opts.userId
 * @param {(type: string, text: string) => void} opts.notify
 * @param {string} opts.githubToken
 * @param {boolean} opts.autoSave
 * @param {{ current: any }} opts.editorRef        Monaco editor (live text for save/run)
 * @param {() => void} opts.onReset                 a workspace switch resets debugger state
 * @param {() => void} opts.onRevealSidebar
 * @param {() => void} opts.onNeedAuth              cloud action while signed out
 */
export function useWorkspace({ userId, notify, githubToken, autoSave, editorRef, onReset, onRevealSidebar, onNeedAuth }) {
  // Latest callbacks without re-creating every handler on each render
  const callbacks = useRef({ onReset, onRevealSidebar, onNeedAuth });
  useEffect(() => { callbacks.current = { onReset, onRevealSidebar, onNeedAuth }; });

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


  // ── File system / workspaces ─────────────────────────────────────
  const fs = useFileSystem();
  const [workspaceFiles, setWorkspaceFiles] = useState([]);
  const workspaceFilesRef = useRef(workspaceFiles);
  useEffect(() => { workspaceFilesRef.current = workspaceFiles; }, [workspaceFiles]);
  const [githubMode, setGithubMode] = useState(false);
  const [githubInfo, setGithubInfo] = useState(null);
  const [githubTree, setGithubTree] = useState([]); // also holds cloud / starter project trees
  // Starter project (in-memory files, run in the browser's Node.js runtime): { id, label } | null
  const [starterProject, setStarterProject] = useState(null);

  const fileTree = (cloudMode || githubMode || starterProject) ? githubTree : fs.fileTree;

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


  // The active tab with the editor's *live* text. React state lags the editor by a render,
  // so a shortcut pressed right after typing (Ctrl+Enter / Ctrl+S) must read the model.
  const liveActiveTab = useCallback(() => {
    const tab = activeTabRef.current;
    const model = editorRef.current?.getModel?.();
    if (!tab || !model || model.uri.path !== `/${tab.path}`) return tab;
    const content = model.getValue();
    return content === tab.content ? tab : { ...tab, content };
  }, [editorRef]);

  const confirmDiscard = useCallback((action) => (
    !tabsRef.current.some(t => t.dirty) ||
    window.confirm(`You have unsaved changes. ${action} and discard them?`)
  ), []);

  const resetWorkspace = useCallback(() => {
    setTabs([]);
    setActiveTabId(null);
    callbacks.current.onReset();
  }, []);

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
    if (isBinaryName(name)) {
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
        content = await fetchFileContent(githubInfo.owner, githubInfo.repo, node.path, githubInfo.branch, githubToken);
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
  }, [fileTree, fs, githubMode, githubInfo, githubToken, notify]);


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
      } else if (starterProject) {
        // In memory: keep the tree and the files the project mounts in step with the editor
        setWorkspaceFiles(prev => {
          const exists = prev.some(f => f.path === tab.path);
          const next = exists
            ? prev.map(f => (f.path === tab.path ? { ...f, content: tab.content } : f))
            : [...prev, { path: tab.path, name: tab.name, content: tab.content }];
          if (!exists) setGithubTree(buildTreeFromPaths(next));
          return next;
        });
        const node = findNodeByPath(githubTree, tab.path);
        if (node) node._content = tab.content;
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
  }, [cloudMode, activeProjectId, starterProject, githubMode, githubTree, fs, notify, refreshCloudTree, editorRef]);

  const saveFile = useCallback(() => saveTab(liveActiveTab()), [saveTab, liveActiveTab]);

  // Auto Save: 1s after the last edit, for files that have a real backing store
  useEffect(() => {
    if (!autoSave || !activeTab?.dirty) return;
    const backed = (cloudMode && activeProjectId) || starterProject || (activeTab.handle && !activeTab.handle.fallback);
    if (!backed) return;
    const t = setTimeout(() => saveTab(activeTab, { silent: true }), 1000);
    return () => clearTimeout(t);
  }, [autoSave, activeTab, cloudMode, activeProjectId, starterProject, saveTab]);

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


  // Files available to `import` (JS/TS) and `import` / `open()` (Python) during a run:
  // preloaded workspace sources, cached tree contents, then open tabs (newest edits win).
  const buildRunFiles = useCallback((runningTab, { maxTotal = 5 * 1024 * 1024 } = {}) => {
    const files = {};
    let total = 0;
    const add = (path, content) => {
      if (typeof content !== 'string') return;
      const grown = total + content.length - (files[path]?.length || 0);
      if (grown > maxTotal) return;
      total = grown;
      files[path] = content;
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
    : starterProject ? `starter:${starterProject.id}:${starterProject.n}`
    : githubMode ? `github:${githubInfo?.owner}/${githubInfo?.repo}`
    : fs.rootName ? `local:${fs.rootName}` : 'scratch';

  // ── Workspace switching ──────────────────────────────────────────
  const handleOpenFolder = useCallback(async () => {
    if (!confirmDiscard('Open a new folder')) return;
    const result = await fs.openFolder();
    if (!result) return;
    setGithubMode(false);
    setStarterProject(null);
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
    setStarterProject(null);
    setActiveProjectId(null);
    setGithubInfo({ owner: info.owner, repo: info.repo, branch: info.branch });
    setGithubTree(info.tree);
    setWorkspaceFiles([]);
    resetWorkspace();
    callbacks.current.onRevealSidebar();
    if (info.truncated) notify('info', 'Large repository: GitHub returned a partial file tree.');
  }, [confirmDiscard, resetWorkspace, notify]);

  const handleOpenCloudProject = useCallback(async (project) => {
    const sameProject = cloudMode && project.id === activeProjectId;
    if (!sameProject && !confirmDiscard('Open this project')) return;
    setGithubMode(false);
    setCloudMode(true);
    setStarterProject(null);
    setActiveProjectId(project.id);
    setGithubInfo(null);
    setGithubTree([]);
    resetWorkspace();
    try {
      await refreshCloudTree(project.id);
    } catch (e) {
      notify('error', `Could not load project: ${e.message}`);
    }
    callbacks.current.onRevealSidebar();
  }, [cloudMode, activeProjectId, confirmDiscard, resetWorkspace, refreshCloudTree, notify]);

  const handleCreateCloudProject = useCallback(async () => {
    if (!userId) { callbacks.current.onNeedAuth(); return; }
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

  // ── Starter projects ─────────────────────────────────────────────
  const starterCount = useRef(0);
  const newProjectFromTemplate = useCallback((templateId) => {
    const files = templateFiles(templateId);
    if (!files || !confirmDiscard('Start a new project')) return false;
    const template = PROJECT_TEMPLATES.find(t => t.id === templateId);
    setGithubMode(false);
    setCloudMode(false);
    setActiveProjectId(null);
    setGithubInfo(null);
    resetWorkspace();
    setStarterProject({ id: templateId, label: template.label, n: ++starterCount.current });
    setGithubTree(buildTreeFromPaths(files));
    setWorkspaceFiles(files);
    callbacks.current.onRevealSidebar();
    // Open the entry file directly (tabsRef still lists the previous workspace's tabs)
    const entry = files.find(f => f.path === PROJECT_ENTRY[templateId]) || files[0];
    const tab = { id: tabIdCounter++, name: entry.name, path: entry.path, lang: getLang(entry.name), content: entry.content, handle: null, dirty: false };
    setTabs([tab]);
    setActiveTabId(tab.id);
    return true;
  }, [confirmDiscard, resetWorkspace]);

  // A GitHub repo only loads file contents on demand: running it downloads the rest first
  const downloadRepoFiles = useCallback(async (onProgress) => {
    const missing = flattenFiles(githubTree).filter(n =>
      typeof n._content !== 'string' &&
      shouldSyncPath(n.path, isBinaryName) &&
      (n.githubItem?.size ?? 0) <= MAX_SYNC_BYTES);
    const bytes = missing.reduce((sum, n) => sum + (n.githubItem?.size ?? 0), 0);
    if (missing.length > MAX_REPO_FILES || bytes > MAX_REPO_BYTES) {
      throw new Error(`This repository is too large to run in the browser (${missing.length} files, ${(bytes / 1048576).toFixed(1)} MB; ` +
        `the limit is ${MAX_REPO_FILES} files / ${MAX_REPO_BYTES / 1048576} MB). Open a smaller project or a local folder.`);
    }
    const downloaded = await fetchRepoFiles(githubInfo, missing.map(n => n.path), githubToken, { onProgress });
    // Cache on the tree nodes, so opening those files later needs no request
    const byPath = new Map(downloaded.map(f => [f.path, f.content]));
    for (const node of missing) if (byPath.has(node.path)) node._content = byPath.get(node.path);
    return downloaded;
  }, [githubTree, githubInfo, githubToken]);

  /** Every known file of the workspace as `{ path, content }` (open tabs' live edits win). */
  const projectFiles = useCallback(async (onProgress) => {
    if (githubMode && githubInfo) await downloadRepoFiles(onProgress);
    const files = buildRunFiles(liveActiveTab(), { maxTotal: 64 * 1024 * 1024 });
    return Object.entries(files).map(([path, content]) => ({ path, content }));
  }, [githubMode, githubInfo, downloadRepoFiles, buildRunFiles, liveActiveTab]);

  // ── Files changed by a running project (generators, npm, the shell) ──
  // changes: [{ type: 'write' | 'delete', path, content? }]
  const applyRuntimeChanges = useCallback(async (changes) => {
    if (!changes?.length) return;

    // Workspace file list: Monaco models for imports, and what the next Start mounts
    const byPath = new Map(workspaceFilesRef.current.map(f => [f.path, f]));
    for (const c of changes) {
      if (c.type === 'delete') byPath.delete(c.path);
      else byPath.set(c.path, { path: c.path, name: c.path.split('/').pop(), content: c.content });
    }
    const nextFiles = [...byPath.values()];
    workspaceFilesRef.current = nextFiles;
    setWorkspaceFiles(nextFiles);

    // Open tabs follow the project, except ones with unsaved edits (never overwritten)
    const latest = new Map(changes.map(c => [c.path, c]));
    const open = tabsRef.current.filter(t => latest.has(t.path));
    const deletedOpen = open.filter(t => latest.get(t.path).type === 'delete').map(t => t.name);
    const conflicts = open.filter(t => {
      const c = latest.get(t.path);
      return c.type === 'write' && t.dirty && t.content !== c.content;
    }).map(t => t.name);
    if (open.length) {
      setTabs(prev => prev.map(t => {
        const change = latest.get(t.path);
        if (!change) return t;
        if (change.type === 'delete') return { ...t, dirty: true };
        if (t.dirty || t.content === change.content) return t;
        return { ...t, content: change.content };
      }));
    }

    // Persist where the workspace lives
    try {
      if (starterProject) {
        setGithubTree(buildTreeFromPaths(nextFiles));
      } else if (githubMode) {
        // Read-only on GitHub: the changes live in NexIDE (and the running project) only
        setGithubTree(tree => withFileChanges(tree, changes));
      } else if (cloudMode && activeProjectId) {
        for (const c of changes) {
          if (c.type === 'delete') await deleteFileFromCloud(activeProjectId, c.path);
          else await saveFileToCloud(activeProjectId, c.path, c.path.split('/').pop(), c.content, getLang(c.path));
        }
        await refreshCloudTree(activeProjectId);
      } else if (!githubMode && fs.rootName) {
        let written = true;
        for (const c of changes) {
          written = (c.type === 'delete' ? await fs.removePath(c.path) : await fs.writePath(c.path, c.content)) && written;
        }
        if (written) await fs.refreshTree();
        else notify('info', 'The project changed files, but this browser opened the folder read-only, so they stay in NexIDE only.');
      }
    } catch (e) {
      notify('error', `Could not save files the project changed: ${e.message || e}`);
    }

    if (conflicts.length) notify('info', `The project changed ${conflicts.join(', ')} while you had unsaved edits. Your version is kept.`);
    else if (deletedOpen.length) notify('info', `The project deleted ${deletedOpen.join(', ')}. Save to keep it.`);
  }, [starterProject, cloudMode, activeProjectId, githubMode, fs, notify, refreshCloudTree]);

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


  const hasUnsavedWork = useCallback(() => tabsRef.current.some(t => t.dirty), []);

  const activeProjectName = visibleCloudProjects.find(p => p.id === activeProjectId)?.name;
  const rootName = cloudMode
    ? activeProjectName
    : starterProject ? starterProject.label
    : (githubMode ? (githubInfo ? `${githubInfo.owner}/${githubInfo.repo}` : 'GitHub') : fs.rootName);

  return {
    fs, fileTree, rootName, workspaceKey, workspaceFiles,
    cloudMode, githubMode, githubInfo, activeProjectId, visibleCloudProjects, starterProject,
    tabs, setTabs, setActiveTabId, tabsRef, activeTab, activeTabRef, liveActiveTab,
    openFileInTab, newFileFromTemplate, handleEditorChange, saveFile, closeTab, hasUnsavedWork,
    buildRunFiles, projectFiles, newProjectFromTemplate, applyRuntimeChanges,
    handleOpenFolder, handleGitHubLoad, handleOpenCloudProject, handleCreateCloudProject,
    handleNewCloudFile, handleRefreshTree,
  };
}
