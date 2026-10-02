// Browser end-to-end checks against the production build.
// Usage: npm run test:e2e   (builds first; uses the locally installed Edge or Chrome)
//   E2E_BASE=http://localhost:5173/ node tests/e2e/run.mjs   → test a running dev server instead
//   E2E_BROWSER=chrome|msedge                                 → pick the browser channel
import { chromium } from 'playwright-core';
import { preview } from 'vite';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readdirSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

let server = null;
let BASE = process.env.E2E_BASE;
if (!BASE) {
  server = await preview({ preview: { port: 0, strictPort: false }, logLevel: 'warn' });
  BASE = server.resolvedUrls.local[0];
}

async function launch() {
  const channels = process.env.E2E_BROWSER ? [process.env.E2E_BROWSER] : ['msedge', 'chrome'];
  for (const channel of channels) {
    try { return await chromium.launch({ channel, headless: true }); } catch { /* try next */ }
  }
  throw new Error(`No browser found (tried ${channels.join(', ')}). Install Edge/Chrome or set E2E_BROWSER.`);
}

const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
const pageErrors = [];
page.on('pageerror', e => pageErrors.push(`pageerror: ${e.message}`));
const pyodideCoreRequests = [];
page.on('request', r => { if (/pyodide\.asm\.(js|wasm)|python_stdlib\.zip/.test(r.url())) pyodideCoreRequests.push(r.url()); });
const cdnMonacoRequests = [];
page.on('request', r => { if (/monaco-editor/.test(r.url()) && !r.url().startsWith(new URL(BASE).origin)) cdnMonacoRequests.push(r.url()); });
page.on('console', m => { if (m.type() === 'error') pageErrors.push(`console: ${m.text()}`); });
// CSP violations anywhere in the page (workers report through console errors)
await page.addInitScript(() => {
  document.addEventListener('securitypolicyviolation', e => {
    console.error(`CSP violation: ${e.violatedDirective} blocked ${e.blockedURI}`);
  });
});

const editorReady = () => page.waitForFunction(() => window.monaco?.editor.getEditors().length > 0, null, { timeout: 30000 });
const setCode = (code) => page.evaluate((c) => window.monaco.editor.getEditors()[0].setValue(c), code);
const consoleText = () => page.locator('#console-panel').innerText().catch(() => '');
const waitConsole = (re, timeout = 15000) => page.waitForFunction(
  (src) => new RegExp(src).test(document.querySelector('#console-panel')?.innerText || ''), re.source, { timeout }
).then(() => true, () => false);
const run = () => page.click('#btn-run-code');

async function openTemplate(id) {
  await page.goto(BASE);
  await page.click(`#welcome-template-${id}`);
  await editorReady();
  await page.waitForTimeout(500); // let @monaco-editor/react attach its change listener
}

try {
  // Seed a legacy plaintext key (pre-encryption format) that user code must not be able to
  // read. Done from /preview.html (same origin, no app running) so the app can't overwrite it.
  await page.goto(new URL('/preview.html', BASE).href);
  await page.evaluate(() => localStorage.setItem('nexide:settings', JSON.stringify({ geminiApiKey: 'AIza-E2E-SECRET' })));
  await page.goto(BASE);

  // ── Security headers (only when serving the production build via vite preview) ──
  if (server) {
    const csp = async (path) => (await page.request.get(new URL(path, BASE).href)).headers()['content-security-policy'] || '';
    const app = await csp('/');
    const workerFile = (await page.request.get(BASE)).ok() && await page.evaluate(async (base) => {
      const html = await (await fetch(base)).text();
      const entry = html.match(/src="(\/assets\/index-[^"]+\.js)"/)?.[1];
      const js = entry ? await (await fetch(entry)).text() : '';
      return js.match(/assets\/jsRunner\.worker-[\w-]+\.js/)?.[0] || null;
    }, BASE);
    check('CSP: app is strict (same-origin scripts only, no CDN, no framing)',
      /script-src 'self';/.test(app) && !/jsdelivr/.test(app) && /frame-ancestors 'none'/.test(app));
    check('CSP: preview host is permissive but frameable only by the app',
      /'unsafe-inline'/.test(await csp('/preview.html')) && /frame-ancestors 'self'/.test(await csp('/preview.html')));
    check('CSP: runner worker allows eval only for itself',
      !!workerFile && /'unsafe-eval'/.test(await csp(`/${workerFile}`)) && /default-src 'none'/.test(await csp(`/${workerFile}`)), workerFile || 'worker chunk not found');
  }

  // ── JavaScript ──
  await openTemplate('js');
  check('Page is cross-origin isolated (SharedArrayBuffer available)',
    await page.evaluate(() => self.crossOriginIsolated === true && typeof SharedArrayBuffer === 'function'));

  // Legacy plaintext key (seeded above) is migrated to encrypted storage
  await page.waitForFunction(() => !!localStorage.getItem('nexide:secrets'), null, { timeout: 5000 }).catch(() => {});
  const stored = await page.evaluate(() => ({
    plain: localStorage.getItem('nexide:settings') || '',
    secret: localStorage.getItem('nexide:secrets') || '',
  }));
  await page.click('#btn-toggle-ai');
  await page.waitForFunction(() => /your key/.test(document.querySelector('.ai-status')?.textContent || ''), null, { timeout: 5000 }).catch(() => {});
  const aiStatus = await page.locator('.ai-status').innerText().catch(() => '');
  await page.click('#btn-toggle-ai');
  check('Secrets: plaintext key migrated to encrypted storage and still usable',
    !stored.plain.includes('AIza-E2E-SECRET') && /"ct":/.test(stored.secret) && !stored.secret.includes('AIza-E2E-SECRET') && /your key/.test(aiStatus),
    aiStatus);
  await setCode(`console.log('sync');\nsetTimeout(() => console.log('timer fired'), 50);\nawait new Promise(r => setTimeout(r, 10));\nconsole.log('awaited', {a: [1, 2]});`);
  await run();
  check('JS: sync + top-level await', await waitConsole(/awaited \{a: \[1, 2\]\}/));
  check('JS: async timer output after completion', await waitConsole(/timer fired/));

  await setCode(`let leaked = 'none';\ntry { leaked = localStorage.getItem('nexide:settings'); } catch (e) { console.log('localStorage blocked:', e.name); }\nconsole.log('document is', typeof document);\nconsole.log('leaked=' + leaked);`);
  await run();
  await waitConsole(/leaked=/);
  const sandboxOut = await consoleText();
  check('Sandbox: localStorage inaccessible', /localStorage blocked: ReferenceError/.test(sandboxOut) && !/AIza-E2E-SECRET/.test(sandboxOut));
  check('Sandbox: no DOM in runner', /document is undefined/.test(sandboxOut));

  await setCode([
    `const found = ['indexedDB', 'caches', 'Worker', 'SharedWorker', 'BroadcastChannel'].filter(n => typeof self[n] !== 'undefined');`,
    `let proto = self, recovered = [];`,
    `while ((proto = Object.getPrototypeOf(proto))) for (const n of ['indexedDB', 'caches']) if (Object.getOwnPropertyDescriptor(proto, n)) recovered.push(n);`,
    `console.log('lockdown:', JSON.stringify({ found, recovered, storage: typeof navigator.storage }));`,
  ].join('\n'));
  await run();
  check('Sandbox: storage & worker APIs removed (not recoverable)',
    await waitConsole(/lockdown: \{"found":\[\],"recovered":\[\],"storage":"undefined"\}/));

  await setCode(`console.log('spinning');\nwhile (true) {}`);
  await run();
  await page.waitForTimeout(800);
  const t0 = Date.now();
  await run(); // the Run button is "Stop" while running
  const stopped = await waitConsole(/stopped by user/, 5000);
  check('Stop: infinite loop terminated, UI responsive', stopped && Date.now() - t0 < 5000, `${Date.now() - t0}ms`);

  await setCode(`const a = 1;\nconst = 2;`);
  await run();
  check('JS: syntax error reports line', await waitConsole(/SyntaxError.*\(line 2\)/));

  for (const n of [1, 2]) {
    await setCode(`console.log("version ${n}")`);
    await page.evaluate(() => window.monaco.editor.getEditors()[0].focus());
    await page.keyboard.press('Control+Enter');
    check(`Editor: Ctrl+Enter runs latest edit (#${n})`, await waitConsole(new RegExp(`version ${n}`), 5000));
  }

  // ── Program input (stdin) ──
  const setStdin = async (text) => {
    if (!(await page.locator('#console-stdin').isVisible().catch(() => false))) await page.click('#btn-toggle-stdin');
    await page.fill('#console-stdin', text);
  };
  await setStdin('Ada\n36\n');
  await setCode(`const name = prompt('Name? ');\nconst age = Number(prompt('Age? '));\nconsole.log(\`hi \${name}, next year \${age + 1}\`);`);
  await run();
  check('stdin: JS prompt() reads Input lines', await waitConsole(/Name\? Ada[\s\S]*Age\? 36[\s\S]*hi Ada, next year 37/));
  await setStdin('');

  await setCode(`console.log('before');\nconst color = prompt('Color? ');\nconsole.log('picked ' + color);`);
  await run();
  await page.waitForSelector('#console-input-line', { timeout: 10000 }).catch(() => {});
  const shownBefore = /before/.test(await consoleText());
  await page.fill('#console-input-line', 'teal').catch(() => {});
  await page.press('#console-input-line', 'Enter').catch(() => {});
  check('stdin: JS interactive prompt() (output shown first)', shownBefore && await waitConsole(/Color\? teal[\s\S]*picked teal/, 10000));

  // Stop works while a program is blocked waiting for input
  await setCode(`prompt('waiting forever? ');`);
  await run();
  await page.waitForSelector('#console-input-line', { timeout: 10000 }).catch(() => {});
  await run(); // "Stop"
  const stoppedWhileWaiting = await waitConsole(/stopped by user/, 5000);
  const promptGone = !(await page.locator('#console-input-line').isVisible().catch(() => false));
  check('stdin: Stop while waiting for input', stoppedWhileWaiting && promptGone);

  // ── Debugger ──
  await setCode(`const a = 1;\nconst b = 2;\nfunction add(x, y) {\n  const s = x + y;\n  return s;\n}\nconsole.log(add(a, b));`);
  await page.click('#btn-debug-code');
  const timeline = await page.waitForSelector('#debug-timeline', { timeout: 10000 }).then(() => true, () => false);
  await waitConsole(/Recorded \d+ execution steps/);
  const dbgOut = await consoleText();
  check('Debug: multiple consts (TDZ regression)', /Recorded \d+ execution steps/.test(dbgOut) && /✓ Completed/.test(dbgOut));
  check('Debug: timeline appears', timeline);
  let foundStack = false;
  if (timeline) {
    await page.click('button[title="Jump to Start (Home)"]');
    const total = Number(await page.locator('.dtl-step-total').innerText());
    for (let i = 0; i < total; i++) {
      if (/Line 4/.test(await page.locator('.dtl-line-badge').innerText().catch(() => ''))) {
        await page.click('.vi-tab:has-text("Stack")');
        const stackText = await page.locator('#variable-inspector').innerText();
        foundStack = /add/.test(stackText) && /\(program\)/.test(stackText);
        break;
      }
      await page.click('button[title="Step Forward (→)"]');
    }
  }
  check('Debug: call stack shows add() above (program)', foundStack);
  await page.keyboard.press('Escape');

  const lensOk = await page.waitForFunction(
    () => [...document.querySelectorAll('.monaco-editor .codelens-decoration')].some(el => el.textContent.includes('Explain')),
    null, { timeout: 10000 }
  ).then(() => true, () => false);
  const lensCount = await page.locator('.monaco-editor .codelens-decoration').count();
  const editorState = await page.evaluate(() => {
    const ed = window.monaco.editor.getEditors()[0];
    return `${ed.getModel()?.getLanguageId()} | ${JSON.stringify(ed.getValue().slice(0, 40))}`;
  });
  check('Editor: AI code lenses render', lensOk, `${lensCount} lens rows · ${editorState}`);

  // ── TypeScript ──
  await setCode(`interface P { x: number }\nconst p: P = { x: 41 };\nconsole.log('ts', p.x + 1);`);
  await page.selectOption('#language-select', 'typescript');
  await run();
  check('TypeScript: transpiled and run', await waitConsole(/ts 42/));

  // npm packages through esm.sh (inside the locked-down worker, under its CSP)
  await page.selectOption('#language-select', 'javascript');
  await setCode(`import { capitalize, chunk } from 'lodash-es';\nimport dayjs from 'dayjs';\nconsole.log('npm', capitalize('nexide'), JSON.stringify(chunk([1, 2, 3, 4], 2)), dayjs('2026-01-02').format('YYYY/MM/DD'));`);
  await run();
  check('JS: npm packages via esm.sh (named + default imports)', await waitConsole(/npm Nexide \[\[1,2\],\[3,4\]\] 2026\/01\/02/, 30000));
  await page.selectOption('#language-select', 'typescript');

  // The bundled TS language worker runs under the strict CSP: a type error yields a marker
  await setCode(`const n: number = "not a number";`);
  const tsMarker = await page.waitForFunction(
    // main.js switched to TypeScript: the TS service flags the annotation either way
    () => window.monaco.editor.getModelMarkers({}).length > 0,
    null, { timeout: 20000 }
  ).then(() => true, () => false);
  check('Editor: TypeScript diagnostics from self-hosted Monaco worker', tsMarker);
  await page.selectOption('#language-select', 'javascript');

  // ── Live preview ──
  await setCode(`console.log('from preview');\ndocument.body.innerHTML = '<p id="out">"</script>" ok</p>';`);
  await page.click('#btn-toggle-preview');
  const frame = page.frameLocator('#preview-iframe');
  const frameText = await frame.locator('#out').innerText({ timeout: 10000 }).catch(e => `ERR ${e.message}`);
  check('Preview: renders; </script> in code does not break it', /ok$/.test(frameText.trim()), frameText.slice(0, 40));
  check('Preview: console bridged to app console', await waitConsole(/from preview/, 5000));

  // HTML preview may use CDN libraries (its own CSP, not the app's)
  await openTemplate('html');
  await setCode(`<!DOCTYPE html><html><head><script src="https://cdn.jsdelivr.net/npm/lodash@4.17.21/lodash.min.js"></script></head>
<body><p id="out">pending</p><script>document.getElementById('out').textContent = 'lodash ' + _.VERSION;</script></body></html>`);
  await page.click('#btn-toggle-preview');
  const libText = await page.frameLocator('#preview-iframe').locator('#out')
    .filter({ hasText: 'lodash' }).innerText({ timeout: 15000 }).catch(() => 'not loaded');
  check('Preview: user HTML can load CDN libraries', libText === 'lodash 4.17.21', libText);

  // ── Python ──
  await openTemplate('py');
  await setCode(`def square(n):\n    r = n * n\n    return r\n\nnums = [square(i) for i in range(4)]\nprint("nums", nums)`);
  await run();
  check('Python: runs via Pyodide', await waitConsole(/nums \[0, 1, 4, 9\]/, 90000));

  // Pre-filled lines are used first; when they run out the program asks interactively
  await setStdin('Grace\n');
  await setCode(`name = input("Who? ")\nprint(f"hello {name}")\ninput("again? ")`);
  await run();
  const askedAgain = await page.waitForSelector('#console-input-line', { timeout: 30000 }).then(() => true, () => false);
  await page.click('#btn-console-eof');
  await waitConsole(/EOFError/, 30000);
  const stdinOut = await consoleText();
  check('stdin: Python input() echoes like a terminal', /Who\? Grace/.test(stdinOut) && /hello Grace/.test(stdinOut));
  check('stdin: asks interactively after pre-filled lines; EOF explains', askedAgain && /EOFError[\s\S]*Input box/.test(stdinOut));
  await setStdin('');

  // Fully interactive: type answers while the program waits
  await setCode(`name = input("Name? ")\nage = int(input("Age? "))\nprint(f"{name} will be {age + 1}")`);
  await run();
  for (const answer of ['Ada', '36']) {
    await page.waitForSelector('#console-input-line', { timeout: 30000 });
    await page.fill('#console-input-line', answer);
    await page.press('#console-input-line', 'Enter');
    await page.waitForTimeout(200);
  }
  await waitConsole(/Ada will be 37/, 15000);
  const interactiveOut = await consoleText();
  check('stdin: Python interactive input() (typed while waiting)',
    /Name\? Ada/.test(interactiveOut) && /Age\? 36/.test(interactiveOut) && /Ada will be 37/.test(interactiveOut));

  await setCode(`import numpy as np\nprint("numpy sum", int(np.arange(5).sum()))`);
  await run();
  check('Python: imported packages install automatically (numpy)', await waitConsole(/numpy sum 10/, 120000));

  await setCode(`import js\nprint("py-lockdown", [hasattr(js, n) for n in ("indexedDB", "caches", "Worker")])`);
  await run();
  check('Python: js-module cannot reach storage/worker APIs', await waitConsole(/py-lockdown \[False, False, False\]/, 30000));

  await setCode(`x = 1\nraise ValueError("boom")`);
  await run();
  await waitConsole(/ValueError/, 30000);
  const pyErr = await consoleText();
  check('Python: traceback trimmed to user code', /ValueError: boom/.test(pyErr) && !/_pyodide\/_base\.py/.test(pyErr));

  await setCode(`def square(n):\n    r = n * n\n    return r\n\ntotal = square(3)\nprint(total)`);
  await page.click('#btn-debug-code');
  const pyDbg = await waitConsole(/✓ Completed/, 30000);
  const pySteps = Number(await page.locator('.dtl-step-total').innerText().catch(() => '0'));
  check('Python: debug records only user lines', pyDbg && pySteps >= 4 && pySteps < 12, `${pySteps} steps`);
  await page.keyboard.press('Escape');

  await setCode(`while True:\n    pass`);
  await run();
  await page.waitForTimeout(1500);
  await run();
  check('Python: Stop terminates infinite loop', await waitConsole(/stopped by user/, 5000));

  const origin = new URL(BASE).origin;
  check('Python: core runtime self-hosted (same origin)', pyodideCoreRequests.length > 0 && pyodideCoreRequests.every(u => u.startsWith(origin)), pyodideCoreRequests.find(u => !u.startsWith(origin)) || `${pyodideCoreRequests.length} core requests`);
  check('Editor: Monaco is self-hosted (no CDN requests)', cdnMonacoRequests.length === 0, cdnMonacoRequests[0] || '');
  // ── Multi-file workspace (Open Folder → imports between files) ──
  {
    const dir = mkdtempSync(join(tmpdir(), 'nexide-e2e-'));
    const files = {
      'main.js': "import { add } from './lib/math.js';\nimport { fmt } from './lib/fmt.ts';\nimport cfg from './config.json';\nconsole.log('multi', fmt(add(cfg.base, 2)));",
      'lib/math.js': 'export const add = (a, b) => a + b;',
      'lib/fmt.ts': 'export const fmt = (n: number): string => `#${n}`;',
      'config.json': '{ "base": 40 }',
      'main.py': "import csv\nfrom helper import double\nwith open('data.csv') as f:\n    rows = list(csv.reader(f))\nprint('py-multi', double(int(rows[1][1])))",
      'helper.py': 'def double(x):\n    return x * 2\n',
      'data.csv': 'name,value\nanswer,21\n',
    };
    for (const [p, content] of Object.entries(files)) {
      mkdirSync(join(dir, dirname(p)), { recursive: true });
      writeFileSync(join(dir, p), content);
    }

    const ws = await browser.newPage({ viewport: { width: 1500, height: 900 } });
    // Use the <input webkitdirectory> fallback, which automation can drive
    await ws.addInitScript(() => { delete window.showDirectoryPicker; });
    await ws.goto(BASE);
    const [chooser] = await Promise.all([ws.waitForEvent('filechooser'), ws.click('#welcome-btn-open-folder')]);
    await chooser.setFiles(dir);
    const wsConsole = (re, timeout) => ws.waitForFunction(
      (src) => new RegExp(src).test(document.querySelector('#console-panel')?.innerText || ''), re.source, { timeout }
    ).then(() => true, () => false);

    await ws.click('.file-tree-item[title="main.js"]');
    await ws.waitForFunction(() => window.monaco?.editor.getEditors().length > 0, null, { timeout: 30000 });
    await ws.click('#btn-run-code');
    check('Workspace: JS imports between files (incl. .ts, .json)', await wsConsole(/multi #42/, 15000));

    // Cross-file time travel: stepping into lib/math.js opens it and highlights the line
    const stepInto = async (fileName) => {
      await ws.click('#btn-debug-code');
      await ws.waitForSelector('#debug-timeline', { timeout: 30000 });
      // Done when the Run button is back from "Stop" (console text may be from an earlier run)
      await ws.waitForFunction(() => document.querySelector('#btn-run-code')?.innerText.trim() === 'Run', null, { timeout: 60000 });
      await ws.click('button[title="Jump to Start (Home)"]');
      const total = Number(await ws.locator('.dtl-step-total').innerText());
      for (let i = 0; i < total; i++) {
        if ((await ws.locator('.dtl-line-badge').innerText().catch(() => '')).includes(fileName)) break;
        await ws.click('button[title="Step Forward (→)"]');
      }
      await ws.waitForTimeout(600);
      const badge = await ws.locator('.dtl-line-badge').innerText().catch(() => '');
      const activeTabName = await ws.locator('.tab.active .tab-name').innerText().catch(() => '');
      const highlighted = await ws.locator('.debug-line-highlight').count();
      await ws.keyboard.press('Escape');
      return { badge, activeTabName, highlighted };
    };
    const jsDbg = await stepInto('math.js');
    check('Debug: JS steps into an imported file (opens it, highlights line)',
      jsDbg.badge.includes('math.js') && jsDbg.activeTabName === 'math.js' && jsDbg.highlighted > 0, JSON.stringify(jsDbg));

    await ws.click('.file-tree-item[title="main.py"]');
    await ws.waitForTimeout(500);
    await ws.click('#btn-run-code');
    check('Workspace: Python imports helper.py and reads data.csv', await wsConsole(/py-multi 42/, 90000));

    const pyDbg = await stepInto('helper.py');
    check('Debug: Python steps into an imported module (opens it, highlights line)',
      pyDbg.badge.includes('helper.py') && pyDbg.activeTabName === 'helper.py' && pyDbg.highlighted > 0, JSON.stringify(pyDbg));
    await ws.click('.file-tree-item[title="main.py"]');

    // The Input box belongs to the file it was typed for
    if (!(await ws.locator('#console-stdin').isVisible().catch(() => false))) await ws.click('#btn-toggle-stdin');
    await ws.fill('#console-stdin', 'for-python');
    await ws.click('.file-tree-item[title="main.js"]');
    const jsInput = await ws.inputValue('#console-stdin');
    await ws.click('.file-tree-item[title="main.py"]');
    const pyInput = await ws.inputValue('#console-stdin');
    const stored = await ws.evaluate(() => JSON.parse(localStorage.getItem('nexide:stdin') || '{}'));
    check('stdin: Input box is per file and remembered', jsInput === '' && pyInput === 'for-python' && stored['main.py'] === 'for-python',
      `js=${JSON.stringify(jsInput)} py=${JSON.stringify(pyInput)}`);
    await ws.close();
    rmSync(dir, { recursive: true, force: true });
  }

  // ── Deploy skew: a lazy chunk from the old deployment is gone (local build only) ──
  if (server) {
    const assetsDir = join(server.config.root, server.config.build.outDir, 'assets');
    const chunk = readdirSync(assetsDir).find(f => /^CodeMap-.*\.js$/.test(f));
    // Own context = own HTTP cache (the main page already loaded this chunk)
    const staleContext = await browser.newContext({ viewport: { width: 1500, height: 900 } });
    const stale = await staleContext.newPage();
    await stale.goto(BASE);
    await stale.click('#welcome-template-js');
    await stale.waitForFunction(() => window.monaco?.editor.getEditors().length > 0, null, { timeout: 30000 });
    await stale.waitForTimeout(500);
    renameSync(join(assetsDir, chunk), join(assetsDir, `${chunk}.gone`));
    try {
      const missing = await stale.request.get(new URL(`/assets/${chunk}`, BASE).href);
      check('Deploy skew: missing asset is a 404, not index.html',
        missing.status() === 404 && !/text\/html/.test(missing.headers()['content-type'] || ''));

      // Unsaved work → no auto-reload; the panel offers Reload and the status bar says why
      await stale.evaluate(() => window.monaco.editor.getEditors()[0].trigger('e2e', 'type', { text: '// edit\n' }));
      let reloaded = false;
      stale.on('framenavigated', f => { if (f === stale.mainFrame()) reloaded = true; });
      await stale.click('#btn-toggle-map');
      const offered = await stale.waitForSelector('#btn-reload-app', { timeout: 10000 }).then(() => true, () => false);
      await stale.waitForFunction(() => /NexIDE was updated/.test(document.querySelector('.statusbar')?.innerText || ''), null, { timeout: 5000 }).catch(() => {});
      const status = await stale.locator('.statusbar').innerText().catch(() => '');
      check('Deploy skew: unsaved work is kept; Reload offered instead of a crash',
        offered && !reloaded && /NexIDE was updated/.test(status),
        `offered=${offered} reloaded=${reloaded} status=${/NexIDE was updated/.test(status)}`);
    } finally {
      renameSync(join(assetsDir, `${chunk}.gone`), join(assetsDir, chunk));
      await staleContext.close();
    }
  }

  // ── Offline (service worker; production build only) ──
  if (server) {
    const offlineContext = await browser.newContext({ viewport: { width: 1500, height: 900 } });
    const off = await offlineContext.newPage();
    const offConsole = (re, timeout) => off.waitForFunction(
      (src) => new RegExp(src).test(document.querySelector('#console-panel')?.innerText || ''), re.source, { timeout }
    ).then(() => true, () => false);
    try {
      await off.goto(BASE);
      await off.evaluate(() => navigator.serviceWorker.ready);
      await off.reload(); // now controlled by the service worker
      // Warm the caches the way a user would: open the editor, run JS and Python once
      await off.click('#welcome-template-py');
      await off.waitForFunction(() => window.monaco?.editor.getEditors().length > 0, null, { timeout: 30000 });
      await off.waitForTimeout(500);
      await off.click('#btn-run-code');
      await offConsole(/✓ Completed/, 90000);

      // npm: first run resolves + pins lodash-es for this workspace (and the SW caches the pinned URL)
      const npmCode = "import { capitalize } from 'lodash-es';\nconsole.log('npm-offline', capitalize('works'));";
      await off.goto(BASE);
      await off.click('#welcome-template-js');
      await off.waitForFunction(() => window.monaco?.editor.getEditors().length > 0, null, { timeout: 30000 });
      await off.waitForTimeout(500);
      await off.evaluate((c) => window.monaco.editor.getEditors()[0].setValue(c), npmCode);
      await off.click('#btn-run-code');
      const pinnedOnline = await offConsole(/lodash-es → lodash-es@[\d.]+ \(pinned[\s\S]*npm-offline Works/, 30000);
      const lock = await off.evaluate(() => JSON.parse(localStorage.getItem('nexide:npm-lock') || '{}').scratch || {});
      check('npm: unversioned import is pinned for the workspace', pinnedOnline && /^lodash-es@\d/.test(lock['lodash-es'] || ''), JSON.stringify(lock));

      await offlineContext.setOffline(true);
      await off.reload();
      await off.click('#welcome-template-py');
      await off.waitForFunction(() => window.monaco?.editor.getEditors().length > 0, null, { timeout: 30000 });
      await off.waitForTimeout(500);
      await off.evaluate(() => window.monaco.editor.getEditors()[0].setValue('print("offline", sum(range(5)))'));
      await off.click('#btn-run-code');
      const pyOffline = await offConsole(/offline 10/, 60000);
      const isolated = await off.evaluate(() => self.crossOriginIsolated === true);
      check('Offline: app, editor and Python run without network (still isolated)', pyOffline && isolated, `py=${pyOffline} isolated=${isolated}`);

      // Pinned npm package keeps working offline (served by the service worker)
      await off.goto(BASE);
      await off.click('#welcome-template-js');
      await off.waitForFunction(() => window.monaco?.editor.getEditors().length > 0, null, { timeout: 30000 });
      await off.waitForTimeout(500);
      await off.evaluate((c) => window.monaco.editor.getEditors()[0].setValue(c), npmCode);
      await off.click('#btn-run-code');
      const npmOffline = await offConsole(/📦 lodash-es@[\d.]+[\s\S]*npm-offline Works/, 30000);
      check('Offline: pinned npm package runs without network', npmOffline,
        npmOffline ? '' : (await off.locator('#console-panel').innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 200));
    } finally {
      await offlineContext.close();
    }
  }

  // Regression: the 2nd+ Python run failed to rebuild the workspace (busy cwd)
  await openTemplate('py');
  await setCode('print("first-run")');
  await run();
  await waitConsole(/first-run[\s\S]*✓ Completed/, 90000);
  await setCode('print("second-run")');
  await run();
  // Wait for *this* run's output — "✓ Completed" from the first run may still be on screen
  const secondDone = await waitConsole(/second-run[\s\S]*(✓ Completed|✗)/, 60000);
  const secondRun = await consoleText();
  check('Python: repeated runs rebuild the workspace cleanly',
    secondDone && !/first-run/.test(secondRun) && !/Resource busy|Could not load workspace/.test(secondRun),
    secondDone ? '' : `console: ${secondRun.replace(/\s+/g, ' ').slice(0, 200)}`);

  const relevant = pageErrors.filter(e => !/favicon/i.test(e));
  check('No page errors or CSP violations', relevant.length === 0, relevant.slice(0, 3).join(' | '));
} finally {
  await browser.close();
  await server?.close();
}

const failed = results.filter(r => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
