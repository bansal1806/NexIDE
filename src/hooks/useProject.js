import { useState, useRef, useCallback, useEffect } from 'react';
import {
  toFileSystemTree, parsePackageJson, pickDevScript, compatibilityWarnings, OutputLog,
  shouldSyncPath, normalizeWatchPath, removedPaths, MAX_SYNC_BYTES,
} from '../runtime/project';
import { isBinaryName } from '../utils/files';
// Runs with Node inside the runtime to gather installed type declarations (editor IntelliSense)
import collectTypesSource from '../runtime/collectTypes.mjs?raw';

// One WebContainer per page (the API allows a single instance). Loaded on demand: the API
// boots Node.js inside a hidden StackBlitz iframe and serves dev servers on *.webcontainer-api.io.
let containerPromise = null;
function bootContainer() {
  if (!containerPromise) {
    containerPromise = import('@webcontainer/api')
      .then(({ WebContainer }) => WebContainer.boot({ coep: 'credentialless', workdirName: 'project' }))
      .catch(e => { containerPromise = null; throw e; });
  }
  return containerPromise;
}

/** Why projects can't run in this browser, or null when they can. */
export function projectRuntimeUnsupportedReason() {
  if (!globalThis.crossOriginIsolated) {
    return 'Running projects needs a cross-origin isolated page (Chrome, Edge or Firefox).';
  }
  return null;
}

const C = { dim: '\x1b[2m', cyan: '\x1b[36m', green: '\x1b[32m', yellow: '\x1b[33m', red: '\x1b[31m', reset: '\x1b[0m' };
const line = (color, text) => `${color}${text}${C.reset}\r\n`;

/**
 * Runs a Node.js project (Next.js, Vite, Express…) in the in-browser runtime:
 * mount files → npm install → npm run dev → preview URL. Also owns an interactive shell.
 * Files the project itself creates, changes or deletes (generators, npm, the shell) are reported
 * through `onFilesChanged([{ type: 'write' | 'delete', path, content? }])`. After installs, the
 * installed packages' type declarations are reported through `onTypes(files, tsconfigText)`.
 *
 * status: 'idle' | 'booting' | 'installing' | 'starting' | 'ready' | 'stopped' | 'error'
 */
export function useProject({ onFilesChanged, onTypes } = {}) {
  const onFilesChangedRef = useRef(onFilesChanged);
  const onTypesRef = useRef(onTypes);
  useEffect(() => { onFilesChangedRef.current = onFilesChanged; onTypesRef.current = onTypes; });
  const [state, setState] = useState({ status: 'idle', url: null, port: null, error: null });
  const [output] = useState(() => new OutputLog());
  const [shellOutput] = useState(() => new OutputLog());

  const container = useRef(null);
  const processes = useRef(new Set()); // install / dev server of the current run
  const runId = useRef(0);
  const mounted = useRef(false);        // files are in the container: editor changes sync
  const installedFor = useRef(null);    // package.json the current node_modules came from
  const pendingWrites = useRef(new Map());
  const shell = useRef(null);           // { process, writer }
  const synced = useRef(new Map());     // path → content the workspace and the runtime agree on
  const watcher = useRef(null);
  const watchQueue = useRef(new Set());
  const watchTimer = useRef(null);

  const killRun = useCallback(() => {
    processes.current.forEach(p => { try { p.kill(); } catch { /* already exited */ } });
    processes.current.clear();
  }, []);

  const getContainer = useCallback(async () => {
    const wc = await bootContainer();
    if (container.current !== wc) {
      container.current = wc;
      wc.on('server-ready', (port, url) => {
        setState(s => (s.status === 'starting' || s.status === 'ready') ? { ...s, status: 'ready', url, port, error: null } : s);
      });
      wc.on('port', (port, type) => {
        if (type === 'close') setState(s => (s.port === port ? { ...s, status: s.status === 'ready' ? 'starting' : s.status, url: null } : s));
      });
      wc.on('error', ({ message }) => output.append(line(C.red, `Runtime error: ${message}`)));
    }
    return wc;
  }, [output]);

  // ── Installed types → editor ─────────────────────────────────────
  const typesTimer = useRef(null);
  const loadTypes = useCallback(async () => {
    const wc = container.current;
    if (!wc || !mounted.current) return;
    const id = runId.current;
    try {
      await wc.fs.writeFile('.nexide-types.mjs', collectTypesSource);
      const collector = await wc.spawn('node', ['.nexide-types.mjs']);
      if ((await collector.exit) !== 0) throw new Error('the type collector failed');
      const { files, truncated } = JSON.parse(await wc.fs.readFile('.nexide-types.json', 'utf-8'));
      const tsconfig = await wc.fs.readFile('tsconfig.json', 'utf-8')
        .catch(() => wc.fs.readFile('jsconfig.json', 'utf-8'))
        .catch(() => null);
      if (id !== runId.current || !mounted.current) return;
      const count = Object.keys(files).length;
      output.append(line(C.dim, `IntelliSense: loaded ${count} type files from node_modules${truncated ? ' (size limit reached)' : ''}.`));
      onTypesRef.current?.(files, tsconfig);
    } catch (e) {
      output.append(line(C.dim, `IntelliSense: could not load package types (${e?.message || e}).`));
    } finally {
      wc.fs.rm('.nexide-types.mjs', { force: true }).catch(() => {});
      wc.fs.rm('.nexide-types.json', { force: true }).catch(() => {});
    }
  }, [output]);
  const scheduleTypes = useCallback(() => {
    clearTimeout(typesTimer.current);
    typesTimer.current = setTimeout(loadTypes, 2000); // npm finishes writing node_modules first
  }, [loadTypes]);

  // ── Runtime → workspace file sync ────────────────────────────────
  const stopWatching = useCallback(() => {
    watcher.current?.close();
    watcher.current = null;
    clearTimeout(watchTimer.current);
    watchTimer.current = null;
    watchQueue.current.clear();
  }, []);

  const flushWatch = useCallback(async () => {
    watchTimer.current = null;
    const wc = container.current;
    const queued = [...watchQueue.current];
    watchQueue.current.clear();
    if (!wc || !mounted.current || !queued.length) return;

    const changes = [];
    const gone = (path) => {
      for (const removed of removedPaths(path, synced.current.keys())) {
        synced.current.delete(removed);
        changes.push({ type: 'delete', path: removed });
      }
    };
    const visit = async (path, depth = 0) => {
      // A directory? (readFile on one doesn't reliably fail.) Report the files inside it.
      const entries = await wc.fs.readdir(path, { withFileTypes: true }).catch(() => null);
      if (entries) {
        if (depth >= 8) return;
        for (const entry of entries) {
          const child = `${path}/${entry.name}`;
          if (shouldSyncPath(child, isBinaryName)) await visit(child, depth + 1);
        }
        return;
      }
      let content;
      try {
        content = await wc.fs.readFile(path, 'utf-8');
      } catch (e) {
        if (/ENOENT|no such file/i.test(String(e?.message || e))) gone(path);
        return;
      }
      if (content.length > MAX_SYNC_BYTES || synced.current.get(path) === content) return;
      synced.current.set(path, content);
      changes.push({ type: 'write', path, content });
    };
    for (const path of queued) await visit(path);
    if (changes.length && mounted.current) onFilesChangedRef.current?.(changes);
    // Dependencies or compiler options changed (e.g. `npm i zod` in the shell): refresh the types
    if (changes.some(c => /^(package|tsconfig|jsconfig).json$/.test(c.path))) scheduleTypes();
  }, [scheduleTypes]);

  // Safety net for missed watch events: compare the whole project with what we know.
  // Runs after each shell command and on the explorer's Refresh.
  const rescanTimer = useRef(null);
  const rescan = useCallback(async () => {
    const wc = container.current;
    if (!wc || !mounted.current) return;
    const found = new Set();
    const walk = async (dir, depth) => {
      const entries = await wc.fs.readdir(dir || '.', { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        const path = dir ? `${dir}/${entry.name}` : entry.name;
        if (found.size >= 2000 || !shouldSyncPath(path, isBinaryName)) continue;
        if (entry.isDirectory()) { if (depth < 8) await walk(path, depth + 1); } else found.add(path);
      }
    };
    await walk('', 0);
    found.forEach(path => watchQueue.current.add(path));
    synced.current.forEach((_, path) => { if (!found.has(path)) watchQueue.current.add(path); });
    clearTimeout(watchTimer.current);
    await flushWatch();
  }, [flushWatch]);
  const scheduleRescan = useCallback(() => {
    clearTimeout(rescanTimer.current);
    rescanTimer.current = setTimeout(rescan, 400);
  }, [rescan]);

  const startWatching = useCallback((wc) => {
    stopWatching();
    watcher.current = wc.fs.watch('.', { recursive: true }, (_event, filename) => {
      const path = normalizeWatchPath(filename);
      if (!shouldSyncPath(path, isBinaryName)) return;
      watchQueue.current.add(path);
      if (!watchTimer.current) watchTimer.current = setTimeout(flushWatch, 300);
    });
  }, [stopWatching, flushWatch]);

  const pipe = useCallback((process, isCurrent) => {
    process.output.pipeTo(new WritableStream({
      write(chunk) { if (isCurrent()) output.append(chunk); },
    })).catch(() => { /* stream closed when the process is killed */ });
  }, [output]);

  /** Start (or restart) the project from `{ path, content }` records. */
  const start = useCallback(async (files) => {
    const id = ++runId.current;
    const isCurrent = () => id === runId.current;
    killRun();
    output.clear();

    const pkgText = files.find(f => f.path === 'package.json')?.content;
    const pkg = parsePackageJson(pkgText);
    const fail = (message) => {
      output.append(line(C.red, message));
      setState({ status: 'error', url: null, port: null, error: message });
    };
    if (!pkg) return fail('No valid package.json at the workspace root.');
    const script = pickDevScript(pkg);
    if (!script) return fail('package.json needs a "dev" or "start" script to run the project.');

    try {
      setState({ status: 'booting', url: null, port: null, error: null });
      output.append(line(C.dim, 'Starting the in-browser Node.js runtime…'));
      const wc = await getContainer();
      if (!isCurrent()) return;

      // Fresh files; keep node_modules (and the lockfile) when dependencies haven't changed.
      // Not watching while the old files are cleared out (those aren't user deletions).
      stopWatching();
      mounted.current = false;
      const keep = installedFor.current === pkgText ? new Set(['node_modules', 'package-lock.json']) : new Set();
      const entries = await wc.fs.readdir('/');
      await Promise.all(entries.filter(name => !keep.has(name)).map(name => wc.fs.rm(name, { recursive: true, force: true })));
      await wc.mount(toFileSystemTree(files));
      synced.current = new Map(files.map(f => [f.path, f.content]));
      mounted.current = true;
      if (!isCurrent()) return;
      startWatching(wc);

      compatibilityWarnings(pkg).forEach(w => output.append(line(C.yellow, `⚠ ${w}`)));

      setState(s => ({ ...s, status: 'installing' }));
      output.append(line(C.cyan, '$ npm install'));
      const install = await wc.spawn('npm', ['install']);
      processes.current.add(install);
      pipe(install, isCurrent);
      const code = await install.exit;
      processes.current.delete(install);
      if (!isCurrent()) return;
      if (code !== 0) {
        installedFor.current = null;
        return fail(`npm install failed (exit code ${code}). See the output above.`);
      }
      installedFor.current = pkgText;

      setState(s => ({ ...s, status: 'starting' }));
      output.append(line(C.cyan, `$ npm run ${script}`));
      const dev = await wc.spawn('npm', ['run', script]);
      processes.current.add(dev);
      pipe(dev, isCurrent);
      loadTypes(); // alongside the dev server starting
      dev.exit.then((exitCode) => {
        processes.current.delete(dev);
        if (!isCurrent()) return;
        if (exitCode === 0) {
          output.append(line(C.dim, 'The dev server exited.'));
          setState(s => ({ ...s, status: 'stopped', url: null, port: null }));
        } else {
          fail(`The dev server exited with code ${exitCode}.`);
        }
      });
    } catch (e) {
      if (isCurrent()) fail(e?.message || String(e));
    }
  }, [getContainer, killRun, output, pipe, stopWatching, startWatching, loadTypes]);

  const stop = useCallback(() => {
    runId.current++;
    killRun();
    output.append(line(C.dim, 'Stopped.'));
    setState(s => ({ ...s, status: 'stopped', url: null, port: null }));
  }, [killRun, output]);

  /** Forget the current project (workspace switched): stop everything and stop syncing. */
  const reset = useCallback(() => {
    runId.current++;
    killRun();
    stopWatching();
    clearTimeout(typesTimer.current);
    mounted.current = false;
    synced.current = new Map();
    pendingWrites.current.forEach(clearTimeout);
    pendingWrites.current.clear();
    if (shell.current) {
      try { shell.current.process.kill(); } catch { /* already exited */ }
      shell.current = null;
    }
    output.clear();
    shellOutput.clear();
    setState({ status: 'idle', url: null, port: null, error: null });
  }, [killRun, stopWatching, output, shellOutput]);

  /** Mirror an editor change into the container (debounced) so dev servers hot-reload. */
  const writeFile = useCallback((path, content) => {
    if (!mounted.current || !container.current || !path) return;
    synced.current.set(path, content); // so the watcher doesn't echo it back
    clearTimeout(pendingWrites.current.get(path));
    pendingWrites.current.set(path, setTimeout(async () => {
      pendingWrites.current.delete(path);
      const wc = container.current;
      if (!mounted.current || !wc) return;
      try {
        const dir = path.split('/').slice(0, -1).join('/');
        if (dir) await wc.fs.mkdir(dir, { recursive: true });
        await wc.fs.writeFile(path, content);
      } catch (e) {
        output.append(line(C.red, `Could not sync ${path}: ${e.message}`));
      }
    }, 250));
  }, [output]);

  // ── Interactive shell (jsh) ───────────────────────────────────────
  const openShell = useCallback(async ({ cols, rows }) => {
    if (shell.current) {
      shell.current.process.resize({ cols, rows });
      return true;
    }
    if (!mounted.current) return false;
    const wc = await getContainer();
    const process = await wc.spawn('jsh', { terminal: { cols, rows } });
    const writer = process.input.getWriter();
    shell.current = { process, writer };
    process.output.pipeTo(new WritableStream({
      write(chunk) {
        shellOutput.append(chunk);
        if (chunk.includes('❯')) scheduleRescan(); // the prompt is back: a command finished
      },
    })).catch(() => {});
    process.exit.then(() => {
      if (shell.current?.process === process) shell.current = null;
      shellOutput.append(line(C.dim, '\r\nShell exited. Reopen the Shell tab to start a new one.'));
    });
    return true;
  }, [getContainer, shellOutput, scheduleRescan]);

  const shellInput = useCallback((data) => { shell.current?.writer.write(data); }, []);
  const resizeShell = useCallback((size) => { shell.current?.process.resize(size); }, []);

  useEffect(() => () => {
    killRun();
    stopWatching();
    clearTimeout(rescanTimer.current);
    clearTimeout(typesTimer.current);
  }, [killRun, stopWatching]);

  return {
    ...state,
    output, shellOutput,
    canShell: () => mounted.current,
    start, stop, reset, writeFile, rescan,
    openShell, shellInput, resizeShell,
  };
}
