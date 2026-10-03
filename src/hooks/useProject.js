import { useState, useRef, useCallback, useEffect } from 'react';
import { toFileSystemTree, parsePackageJson, pickDevScript, compatibilityWarnings, OutputLog } from '../runtime/project';

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
 *
 * status: 'idle' | 'booting' | 'installing' | 'starting' | 'ready' | 'stopped' | 'error'
 */
export function useProject() {
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

      // Fresh files; keep node_modules (and the lockfile) when dependencies haven't changed
      const keep = installedFor.current === pkgText ? new Set(['node_modules', 'package-lock.json']) : new Set();
      const entries = await wc.fs.readdir('/');
      await Promise.all(entries.filter(name => !keep.has(name)).map(name => wc.fs.rm(name, { recursive: true, force: true })));
      await wc.mount(toFileSystemTree(files));
      mounted.current = true;
      if (!isCurrent()) return;

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
  }, [getContainer, killRun, output, pipe]);

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
    mounted.current = false;
    pendingWrites.current.forEach(clearTimeout);
    pendingWrites.current.clear();
    if (shell.current) {
      try { shell.current.process.kill(); } catch { /* already exited */ }
      shell.current = null;
    }
    output.clear();
    shellOutput.clear();
    setState({ status: 'idle', url: null, port: null, error: null });
  }, [killRun, output, shellOutput]);

  /** Mirror an editor change into the container (debounced) so dev servers hot-reload. */
  const writeFile = useCallback((path, content) => {
    if (!mounted.current || !container.current || !path) return;
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
    process.output.pipeTo(new WritableStream({ write: chunk => shellOutput.append(chunk) })).catch(() => {});
    process.exit.then(() => {
      if (shell.current?.process === process) shell.current = null;
      shellOutput.append(line(C.dim, '\r\nShell exited. Reopen the Shell tab to start a new one.'));
    });
    return true;
  }, [getContainer, shellOutput]);

  const shellInput = useCallback((data) => { shell.current?.writer.write(data); }, []);
  const resizeShell = useCallback((size) => { shell.current?.process.resize(size); }, []);

  useEffect(() => () => killRun(), [killRun]);

  return {
    ...state,
    output, shellOutput,
    canShell: () => mounted.current,
    start, stop, reset, writeFile,
    openShell, shellInput, resizeShell,
  };
}
