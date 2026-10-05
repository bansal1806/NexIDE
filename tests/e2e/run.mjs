// Browser end-to-end checks against the production build.
// Usage: npm run test:e2e   (builds first; uses the locally installed Edge or Chrome)
//   E2E_BASE=http://localhost:5173/ node tests/e2e/run.mjs   → test a running dev server instead
//   E2E_BROWSER=chrome|msedge                                 → pick the browser channel
import { chromium } from 'playwright-core';
import { preview } from 'vite';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readdirSync, renameSync, readFileSync } from 'node:fs';
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
page.on('console', m => {
  if (m.type() !== 'error') return;
  // A running project's own app (preview iframe / runtime frame) isn't NexIDE
  if (/webcontainer-api\.io|stackblitz\.com/.test(m.location()?.url || '')) return;
  // The expired-link check answers Supabase's verify with a mocked 403 on purpose; browsers log any
  // failed response, even when the app handles it (it shows "expired or was already used")
  if (/\/auth\/v1\/verify/.test(m.location()?.url || '') && /status of 403/.test(m.text())) return;
  const where = m.location()?.url;
  pageErrors.push(`console: ${m.text()}${where ? ` (${where})` : ''}`);
});
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
    // Frames: our preview page plus the Node.js runtime (StackBlitz) and its dev-server previews only
    const frameSrc = app.match(/frame-src ([^;]*)/)?.[1].trim().split(/\s+/) || [];
    const allowedFrames = ["'self'", 'https://stackblitz.com', 'https://*.webcontainer-api.io'];
    check('CSP: frames limited to the app and the project runtime',
      frameSrc.length > 0 && frameSrc.every(s => allowedFrames.includes(s)), frameSrc.join(' '));
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
  // Screen readers get one summary (the console itself is not a live region; it would read every line)
  const announced = () => page.textContent('#announcer').catch(() => '');
  const runSummary = await announced();
  const consoleQuiet = await page.getAttribute('.console-lines', 'aria-live');
  check('A11y: a run is announced as one summary, not line by line',
    /^Run finished in \d+ ms, 2 lines of output\.$/.test(runSummary) && consoleQuiet === 'off', `${JSON.stringify(runSummary)} console aria-live=${consoleQuiet}`);

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
  const failSummary = await page.waitForFunction(() => /^Run failed: SyntaxError.*\(line 2\)/.test(document.querySelector('#announcer')?.textContent || ''), null, { timeout: 5000 })
    .then(() => true, () => false);
  check('A11y: a failed run announces its error', failSummary, failSummary ? '' : JSON.stringify(await page.textContent('#announcer')));

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

  // Packages panel lists the workspace's pins; unpinning re-resolves on the next run
  if (!(await page.locator('.right-panel').isVisible().catch(() => false))) await page.click('#btn-toggle-ai');
  await page.click('.right-panel .panel-tab:has-text("Packages")');
  const pinRows = page.locator('#packages-panel .package-row');
  await pinRows.first().waitFor({ timeout: 10000 }).catch(() => {});
  const listed = await pinRows.allInnerTexts();
  const listsPins = listed.some(t => /lodash-es[\s\S]*lodash-es@\d/.test(t)) && listed.some(t => /dayjs[\s\S]*dayjs@\d/.test(t));
  await page.click('#packages-panel .package-row[data-spec="lodash-es"] button:has-text("Unpin")');
  await page.waitForFunction(() => !JSON.parse(localStorage.getItem('nexide:npm-lock') || '{}').scratch?.['lodash-es'], null, { timeout: 5000 }).catch(() => {});
  const afterUnpin = await page.evaluate(() => JSON.parse(localStorage.getItem('nexide:npm-lock') || '{}').scratch || {});
  await run();
  const repinned = await waitConsole(/lodash-es → lodash-es@[\d.]+ \(pinned/, 30000);
  check('Packages panel: lists pins; Unpin re-resolves on the next run',
    listsPins && !afterUnpin['lodash-es'] && !!afterUnpin.dayjs && repinned,
    `listed=${listsPins} unpinned=${!afterUnpin['lodash-es']} kept=${!!afterUnpin.dayjs} repinned=${repinned}`);
  await page.click('.right-panel .panel-close-btn');
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
    await ws.waitForFunction(() => JSON.parse(localStorage.getItem('nexide:stdin') || '{}')['main.py'] === 'for-python', null, { timeout: 5000 }).catch(() => {});
    const stored = await ws.evaluate(() => JSON.parse(localStorage.getItem('nexide:stdin') || '{}'));
    check('stdin: Input box is per file and remembered', jsInput === '' && pyInput === 'for-python' && stored['main.py'] === 'for-python',
      `js=${JSON.stringify(jsInput)} py=${JSON.stringify(pyInput)}`);

    // File tree keyboard navigation (WAI-ARIA tree). Root: lib/ (expanded), then files.
    const focusedPath = () => document.activeElement?.getAttribute('data-path');
    const waitFocus = (path) => ws.waitForFunction(
      `document.activeElement?.getAttribute('data-path') === ${JSON.stringify(path)}`, null, { timeout: 5000 }
    ).then(() => true, () => false);
    const waitExpanded = (path, value) => ws.waitForFunction(
      `document.querySelector('[role="treeitem"][data-path=${JSON.stringify(path)}]')?.getAttribute('aria-expanded') === ${JSON.stringify(value)}`,
      null, { timeout: 5000 }
    ).then(() => true, () => false);
    await ws.focus('[role="treeitem"][data-path="lib"]');
    const treeSteps = {};
    await ws.keyboard.press('ArrowLeft');          // collapse lib
    treeSteps.collapsed = await waitExpanded('lib', 'false');
    await ws.keyboard.press('ArrowRight');         // expand lib
    treeSteps.expanded = await waitExpanded('lib', 'true');
    await ws.keyboard.press('ArrowRight');         // into first child
    treeSteps.intoChild = await waitFocus('lib/fmt.ts');
    await ws.keyboard.press('ArrowDown');
    treeSteps.down = await waitFocus('lib/math.js');
    await ws.keyboard.press('ArrowLeft');          // back to parent folder
    treeSteps.parent = await waitFocus('lib');
    await ws.keyboard.press('End');
    treeSteps.end = await waitFocus('main.py');
    await ws.keyboard.press('Home');
    treeSteps.home = await waitFocus('lib');
    await ws.focus('[role="treeitem"][data-path="config.json"]');
    await ws.keyboard.press('Enter');              // open the file
    treeSteps.opened = await ws.waitForFunction(
      () => document.querySelector('[role="tab"][aria-selected="true"] .tab-name')?.textContent === 'config.json', null, { timeout: 5000 }
    ).then(() => true, () => false);
    treeSteps.oneTabStop = await ws.evaluate(() => document.querySelectorAll('[role="treeitem"][tabindex="0"]').length === 1);
    check('File tree: arrows / Home / End / Enter follow the ARIA tree pattern',
      Object.values(treeSteps).every(Boolean), JSON.stringify(treeSteps) + ` focused=${await ws.evaluate(focusedPath)}`);

    // Keyboard-accessible tab bar: arrows move focus + selection, Delete closes the focused tab
    const tabState = () => ws.evaluate(() => ({
      names: [...document.querySelectorAll('[role="tab"] .tab-name')].map(e => e.textContent),
      active: document.querySelector('[role="tab"][aria-selected="true"] .tab-name')?.textContent,
      focused: document.activeElement?.getAttribute('role') === 'tab' ? document.activeElement.querySelector('.tab-name')?.textContent : null,
    }));
    // Wait for the specific state after each key (focus moves on the next animation frame)
    const waitTabs = (pred, arg) => ws.waitForFunction(pred, arg, { timeout: 5000 }).catch(() => {});
    const focusedName = () => (document.activeElement?.getAttribute('role') === 'tab'
      ? document.activeElement.querySelector('.tab-name')?.textContent : null);
    await ws.focus('[role="tab"][aria-selected="true"]');
    const before = await tabState();
    await ws.keyboard.press('Home');
    await waitTabs(`(${focusedName})() === ${JSON.stringify(before.names[0])}`);
    const atHome = await tabState();
    await ws.keyboard.press('ArrowRight');
    await waitTabs(`(${focusedName})() === ${JSON.stringify(before.names[1])}`);
    const afterRight = await tabState();
    await ws.keyboard.press('Delete');
    await waitTabs(`document.querySelectorAll('[role="tab"]').length === ${before.names.length - 1} && (${focusedName})() !== null`);
    const afterDelete = await tabState();
    check('Tabs: Home/ArrowRight move selection and focus; Delete closes the focused tab',
      atHome.active === before.names[0] && atHome.focused === before.names[0] &&
      afterRight.active === before.names[1] && afterRight.focused === before.names[1] &&
      afterDelete.names.length === before.names.length - 1 && !afterDelete.names.includes(before.names[1]) &&
      afterDelete.focused !== null,
      JSON.stringify({ before: before.names, afterDelete: afterDelete.names, focused: afterDelete.focused }));
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
      // The pin is persisted just after the run resolves (state → effect → localStorage), so wait for it
      await off.waitForFunction(
        () => !!JSON.parse(localStorage.getItem('nexide:npm-lock') || '{}').scratch?.['lodash-es'],
        null, { timeout: 10000 }
      ).catch(() => {});
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

  // ── Node.js projects in the in-browser runtime (WebContainers; needs network) ──
  {
    const previewText = async () => {
      const src = await page.getAttribute('#project-preview-frame', 'src').catch(() => null);
      const frame = src && page.frames().find(f => f.url().startsWith(new URL(src).origin));
      return frame ? frame.evaluate(() => document.body?.innerText || '').catch(() => '') : '';
    };
    const waitPreview = async (re, timeout) => {
      const end = Date.now() + timeout;
      let text = '';
      while (Date.now() < end) {
        text = await previewText();
        if (re.test(text)) return { ok: true, text };
        await page.waitForTimeout(1000);
      }
      return { ok: false, text };
    };
    const terminalText = (id) => page.evaluate((sel) => document.querySelector(`${sel} .xterm-rows`)?.innerText || '', id);
    const startProject = async (id) => {
      await page.goto(BASE);
      await page.click(`#welcome-project-${id}`);
      await editorReady();
      await page.waitForTimeout(500);
      const idle = (await page.textContent('#btn-run-code'))?.trim();
      const started = Date.now();
      await run();
      const ready = await page.waitForFunction(() => document.querySelector('#project-status')?.textContent === 'Running', null, { timeout: 300000 }).then(() => true, () => false);
      return { idle, ready, secs: Math.round((Date.now() - started) / 1000) };
    };

    // React + Vite: install, dev server, hot reload, shell, stop
    const react = await startProject('react');
    const rendered = await waitPreview(/Hello from React/, 60000);
    check('Project: React + Vite installs, starts and renders in the preview',
      react.idle === 'Start' && react.ready && rendered.ok,
      `${react.secs}s · ${rendered.ok ? 'rendered' : `preview: ${JSON.stringify(rendered.text.slice(0, 80))} · output: ${(await terminalText('#project-output')).replace(/\s+/g, ' ').slice(-200)}`}`);
    const projectSummary = await page.textContent('#announcer').catch(() => '');
    check('A11y: project progress is announced', /Dev server running/.test(projectSummary), JSON.stringify(projectSummary));

    await page.evaluate(() => {
      const editor = window.monaco.editor.getEditors()[0];
      editor.setValue(editor.getValue().replace('Hello from React', 'Hot reloaded!'));
    });
    const hot = await waitPreview(/Hot reloaded!/, 30000);
    check('Project: editor changes hot-reload the preview', hot.ok, JSON.stringify(hot.text.slice(0, 60)));

    await page.click('#term-tab-shell');
    await page.waitForSelector('#project-shell .xterm', { timeout: 10000 });
    // Run one shell command and wait for its prompt to come back (typing earlier would send the
    // next command's keystrokes to the still-running process)
    const prompts = () => page.evaluate(() => (document.querySelector('#project-shell .xterm-rows')?.innerText.match(/❯/g) || []).length);
    await page.waitForFunction(() => /❯/.test(document.querySelector('#project-shell .xterm-rows')?.innerText || ''), null, { timeout: 30000 }).catch(() => {});
    const shellRun = async (command) => {
      const before = await prompts();
      await page.keyboard.type(`${command}\n`);
      return page.waitForFunction((n) => (document.querySelector('#project-shell .xterm-rows')?.innerText.match(/❯/g) || []).length > n,
        before, { timeout: 30000 }).then(() => true, () => false);
    };
    await shellRun('node -e "console.log(6 * 7)"');
    const shellOk = /\b42\b/.test(await terminalText('#project-shell'));
    check('Project: interactive shell runs node', shellOk, shellOk ? '' : (await terminalText('#project-shell')).replace(/\s+/g, ' ').slice(-120));

    // Files the project creates / deletes show up in the explorer (npm's lockfile, shell commands)
    const treeNames = () => page.$$eval('#sidebar .file-tree-name', els => els.map(e => e.textContent.trim()));
    const treeHas = (want, notWant = []) => page.waitForFunction(({ want, notWant }) => {
      const names = [...document.querySelectorAll('#sidebar .file-tree-name')].map(e => e.textContent.trim());
      return want.every(n => names.filter(x => x === n).length === 1) && notWant.every(n => !names.includes(n));
    }, { want, notWant }, { timeout: 15000 }).then(() => true, () => false);
    await shellRun('mkdir -p src/lib && echo "export const answer = 42;" > src/lib/answer.js && echo "todo" > notes.txt');
    const created = await treeHas(['lib', 'notes.txt', 'package-lock.json']);
    await shellRun('rm notes.txt');
    const deleted = await treeHas(['lib'], ['notes.txt']);
    check('Project: files created or deleted by the project appear in the explorer', created && deleted,
      `created=${created} deleted=${deleted} · tree: ${(await treeNames()).join(', ')}` +
      (created && deleted ? '' : ` · shell: ${(await terminalText('#project-shell')).split('\n').filter(Boolean).slice(-5).join(' | ')}`));

    await run(); // Stop
    const stopped = await page.waitForFunction(() => document.querySelector('#project-status')?.textContent === 'Stopped', null, { timeout: 15000 }).then(() => true, () => false);
    check('Project: Stop ends the dev server', stopped && !(await page.$('#project-preview-frame')));

    // Next visit: the installed dependencies were saved (in the background) and are restored
    const saved = await page.waitForFunction(() => new Promise(resolve => {
      const req = indexedDB.open('nexide-deps');
      req.onsuccess = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('snapshots')) { db.close(); return resolve(false); }
        const count = db.transaction('snapshots').objectStore('snapshots').count();
        count.onsuccess = () => { db.close(); resolve(count.result > 0); };
      };
      req.onerror = () => resolve(false);
    }), null, { timeout: 120000, polling: 1000 }).then(() => true, () => false);
    const again = await startProject('react');
    const restoredBadge = !!(await page.$('#project-deps-cached'));
    const againRendered = await waitPreview(/Hello from React/, 60000);
    check('Project: dependencies are kept between visits (restart without reinstalling)',
      saved && again.ready && restoredBadge && againRendered.ok,
      `saved=${saved} restored=${restoredBadge} · first start ${react.secs}s, next visit ${again.secs}s`);
    await run(); // Stop

    // Next.js: Server Component page, API route, edit → recompile
    const next = await startProject('next');
    const nextPage = await waitPreview(/Hello from Next\.js[\s\S]*Rendered on the server/, 120000);
    check('Project: Next.js renders a Server Component page', next.ready && nextPage.ok,
      `${next.secs}s${nextPage.ok ? '' : ` · preview: ${JSON.stringify(nextPage.text.slice(0, 80))} · output: ${(await terminalText('#project-output')).replace(/\s+/g, ' ').slice(-200)}`}`);
    await page.fill('#project-preview-path', '/api/hello');
    await page.press('#project-preview-path', 'Enter');
    const api = await waitPreview(/Hello from a Next\.js API route/, 90000);
    check('Project: Next.js API route responds', api.ok, JSON.stringify(api.text.slice(0, 80)));
    await page.fill('#project-preview-path', '/');
    await page.press('#project-preview-path', 'Enter');
    await waitPreview(/Hello from Next\.js/, 60000);
    await page.evaluate(() => {
      const editor = window.monaco.editor.getEditors()[0];
      editor.setValue(editor.getValue().replace('Hello from Next.js', 'Edited Next page'));
    });
    // Fast Refresh usually applies it; reload as a fallback (an edit right after the first render
    // can land before Next's HMR socket connects)
    let edited = await waitPreview(/Edited Next page/, 30000);
    if (!edited.ok) {
      await page.click('button[aria-label="Reload preview"]');
      edited = await waitPreview(/Edited Next page/, 60000);
    }
    check('Project: Next.js picks up edits', edited.ok, JSON.stringify(edited.text.slice(0, 60)));
    await run(); // Stop

    // SvelteKit: server load() and an API endpoint
    {
      const kit = await startProject('sveltekit');
      const kitPage = await waitPreview(/Hello from SvelteKit[\s\S]*Loaded on the server at/, 120000);
      await page.fill('#project-preview-path', '/api/hello');
      await page.press('#project-preview-path', 'Enter');
      const kitApi = await waitPreview(/Hello from a SvelteKit endpoint/, 90000);
      check('Project: SvelteKit renders server-loaded data and serves an API route',
        kit.ready && kitPage.ok && kitApi.ok,
        `${kit.secs}s · page=${kitPage.ok} api=${kitApi.ok}${kitPage.ok ? '' : ` · output: ${(await terminalText('#project-output')).replace(/\s+/g, ' ').slice(-200)}`}`);
      await run(); // Stop
    }

    // React Router v7 (framework mode): loader, action (form post), resource route
    {
      const rr = await startProject('react-router');
      const rrPage = await waitPreview(/Hello from React Router[\s\S]*Loaded on the server at/, 120000);
      let posted = false;
      const src = await page.getAttribute('#project-preview-frame', 'src').catch(() => null);
      const frame = src && page.frames().find(f => f.url().startsWith(new URL(src).origin));
      if (frame) {
        await frame.fill('input[name="note"]', 'Posted by the e2e suite').catch(() => {});
        await frame.click('button[type="submit"]').catch(() => {});
        posted = (await waitPreview(/Posted by the e2e suite/, 30000)).ok;
      }
      await page.fill('#project-preview-path', '/api/hello');
      await page.press('#project-preview-path', 'Enter');
      const rrApi = await waitPreview(/Hello from a React Router resource route/, 90000);
      check('Project: React Router runs its loader, action (form post) and resource route',
        rr.ready && rrPage.ok && posted && rrApi.ok, `${rr.secs}s · page=${rrPage.ok} action=${posted} api=${rrApi.ok}`);
      await run(); // Stop
    }

    // A GitHub repo runs as a project: its text files are downloaded, then installed and started.
    // GitHub itself is mocked (no rate limits, deterministic); everything after the download is real.
    {
      const repoFiles = {
        'package.json': JSON.stringify({ name: 'gh-demo', private: true, type: 'module', scripts: { dev: 'vite' }, devDependencies: { vite: '^6.3.0' } }),
        'index.html': '<!doctype html><html><body><h1>Hello from a GitHub repo</h1><script type="module" src="/main.js"></script></body></html>',
        'main.js': "document.body.insertAdjacentHTML('beforeend', '<p>JS ran</p>');",
      };
      const tree = [
        ...Object.entries(repoFiles).map(([path, content]) => ({ path, type: 'blob', size: content.length })),
        { path: 'assets', type: 'tree' },
        { path: 'assets/logo.png', type: 'blob', size: 2048 },        // binary: never downloaded
        { path: 'data.json', type: 'blob', size: 3 * 1024 * 1024 },    // too big: never downloaded
      ];
      const rawRequests = [];
      await page.route('https://api.github.com/repos/e2e/demo', r => r.fulfill({ json: { default_branch: 'main' } }));
      await page.route('https://api.github.com/repos/e2e/demo/git/trees/**', r => r.fulfill({ json: { tree, truncated: false } }));
      await page.route('https://raw.githubusercontent.com/e2e/demo/main/**', r => {
        const path = new URL(r.request().url()).pathname.split('/main/')[1];
        rawRequests.push(path);
        return repoFiles[path] !== undefined ? r.fulfill({ body: repoFiles[path], contentType: 'text/plain' }) : r.fulfill({ status: 404 });
      });
      await page.goto(BASE);
      await page.click('#welcome-btn-open-github');
      await page.fill('#github-repo-input', 'e2e/demo');
      await page.click('#btn-load-github-repo');
      await page.waitForSelector('#github-modal', { state: 'detached', timeout: 15000 });
      await page.waitForFunction(() => document.querySelector('#btn-run-code')?.textContent.trim() === 'Start', null, { timeout: 15000 });
      const started = Date.now();
      await run();
      const ready = await page.waitForFunction(() => document.querySelector('#project-status')?.textContent === 'Running', null, { timeout: 300000 }).then(() => true, () => false);
      const ghRendered = await waitPreview(/Hello from a GitHub repo[\s\S]*JS ran/, 60000);
      check('Project: a GitHub repo downloads its files and runs',
        ready && ghRendered.ok && rawRequests.sort().join(',') === 'index.html,main.js,package.json',
        `${Math.round((Date.now() - started) / 1000)}s · downloaded: ${rawRequests.join(', ')}${ghRendered.ok ? '' : ` · preview: ${JSON.stringify(ghRendered.text.slice(0, 60))}`}`);
      await run(); // Stop
      await page.unrouteAll({ behavior: 'ignoreErrors' });
    }

    // TypeScript project: the installed packages' types power editor diagnostics and completions
    const tsDiagnostics = (path) => page.evaluate(async (path) => {
      const ts = window.monaco.typescript ?? window.monaco.languages.typescript;
      const uri = window.monaco.Uri.parse(`file:///${path}`);
      const worker = await (await ts.getTypeScriptWorker())(uri);
      const all = [...await worker.getSyntacticDiagnostics(uri.toString()), ...await worker.getSemanticDiagnostics(uri.toString())];
      return all.map(d => `${d.code}: ${typeof d.messageText === 'string' ? d.messageText : d.messageText.messageText}`);
    }, path);
    const reactTs = await startProject('react-ts');
    const tsRendered = await waitPreview(/Hello from React \+ TypeScript/, 60000);
    check('Project: React + TypeScript renders', reactTs.ready && tsRendered.ok, JSON.stringify(tsRendered.text.slice(0, 60)));
    // Before the types arrive, "Cannot find module 'react'" (2307); wait until the editor is clean
    let clean = [];
    for (const end = Date.now() + 120000; Date.now() < end;) {
      clean = [...await tsDiagnostics('src/App.tsx'), ...await tsDiagnostics('src/main.tsx')];
      if (!clean.length) break;
      await page.waitForTimeout(2000);
    }
    check('Project: installed types give error-free TypeScript in the editor', clean.length === 0, clean.slice(0, 2).join(' | '));
    await setCode('import { useState } from "react";\nexport default function App() {\n  const [n] = useState<number>("nope");\n  return <h1>{n}</h1>;\n}\n');
    await page.waitForTimeout(800);
    const caught = (await tsDiagnostics('src/App.tsx')).some(d => d.startsWith('2345'));
    const completions = await page.evaluate(async () => {
      const ts = window.monaco.typescript ?? window.monaco.languages.typescript;
      const model = window.monaco.editor.getModel(window.monaco.Uri.parse('file:///src/App.tsx'));
      model.setValue('import * as React from "react";\nReact.use');
      const worker = await (await ts.getTypeScriptWorker())(model.uri);
      const info = await worker.getCompletionsAtPosition(model.uri.toString(), model.getValue().length);
      return (info?.entries || []).map(e => e.name);
    });
    check('Project: type errors and completions come from the installed packages',
      caught && completions.includes('useState') && completions.includes('useEffect'),
      `caught=${caught} completions=${completions.filter(n => n.startsWith('use')).slice(0, 4).join(',')}`);
    await run(); // Stop
  }

  // ── Auth: an expired / reused email confirmation link explains itself and offers sign-in ──
  {
    // Arrive from elsewhere, as the email link does (a hash-only change wouldn't reload the app)
    await page.goto('about:blank');
    await page.goto(`${BASE}#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired&sb=`);
    const dialog = await page.waitForSelector('[role="dialog"][aria-label="Authentication"]', { timeout: 10000 }).then(() => true, () => false);
    const notice = await page.textContent('.statusbar [role="alert"]').catch(() => '');
    const cleaned = !new URL(page.url()).hash;
    check('Auth: an expired email link shows why and offers sign-in', dialog && /expired or was already used/.test(notice) && cleaned,
      `dialog=${dialog} cleaned=${cleaned} notice=${JSON.stringify(notice)}`);
    await page.keyboard.press('Escape');
    await page.goto(BASE);
  }

  // ── Auth: our email links (/auth/confirm?token_hash=…) are verified by the app itself ──
  // Supabase is mocked (no real accounts or emails). Builds without Supabase settings skip this.
  {
    const configured = await page.evaluate(async () => {
      const html = await (await fetch('/')).text();
      const entry = html.match(/src="(\/assets\/index-[^"]+\.js)"/)?.[1];
      return !!entry && /\.supabase\.co/.test(await (await fetch(entry)).text());
    });
    if (!configured) {
      console.log('SKIP  Auth: email confirmation links (this build has no Supabase settings)');
    } else {
      const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
      const exp = Math.floor(Date.now() / 1000) + 3600;
      const user = { id: '00000000-0000-4000-8000-0000000000e2', aud: 'authenticated', role: 'authenticated', email: 'e2e@nexide.test', app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() };
      const session = {
        access_token: `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: user.id, aud: 'authenticated', role: 'authenticated', email: user.email, exp })}.sig`,
        token_type: 'bearer', expires_in: 3600, expires_at: exp, refresh_token: 'e2e-refresh', user,
      };
      const verifyCalls = [];
      await page.route('**/auth/v1/verify**', async r => {
        const body = r.request().postDataJSON();
        verifyCalls.push(body);
        return body.token_hash === 'expired-hash'
          ? r.fulfill({ status: 403, json: { code: 403, error_code: 'otp_expired', msg: 'Email link is invalid or has expired' } })
          : r.fulfill({ json: session });
      });
      await page.route('**/auth/v1/user**', r => r.fulfill({ json: user }));     // updateUser (new password)
      await page.route('**/auth/v1/logout**', r => r.fulfill({ status: 204, body: '' }));
      await page.route('**/rest/v1/**', r => r.fulfill({ json: [] }));          // settings / projects
      const notice = () => page.textContent('.statusbar [role="status"], .statusbar [role="alert"]').catch(() => '');
      const arrive = async (query) => { await page.goto('about:blank'); await page.goto(`${BASE}auth/confirm?${query}`); };
      const signOut = () => page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('sb-')).forEach(k => localStorage.removeItem(k)));

      await arrive('token_hash=good-hash&type=email');
      const confirmed = await page.waitForFunction(() => /Email confirmed/.test(document.querySelector('.statusbar')?.textContent || ''), null, { timeout: 10000 }).then(() => true, () => false);
      const cleanUrl = new URL(page.url()).pathname === '/' && !new URL(page.url()).search;
      check('Auth: an email link is verified by the app (scanner-safe) and signs the user in',
        confirmed && cleanUrl && verifyCalls[0]?.token_hash === 'good-hash' && verifyCalls[0]?.type === 'email',
        `confirmed=${confirmed} cleanUrl=${cleanUrl} notice=${JSON.stringify(await notice())}`);
      await signOut();

      await arrive('token_hash=expired-hash&type=email');
      const expired = await page.waitForFunction(() => /expired or was already used/.test(document.querySelector('.statusbar')?.textContent || ''), null, { timeout: 10000 }).then(() => true, () => false);
      check('Auth: an expired email link explains itself', expired, JSON.stringify(await notice()));

      await arrive('token_hash=reset-hash&type=recovery');
      const form = await page.waitForSelector('#auth-new-password-form', { timeout: 10000 }).then(() => true, () => false);
      let saved = false;
      if (form) {
        await page.fill('#auth-new-password', 'a-brand-new-password');
        await page.click('#auth-new-password-form button[type="submit"]');
        saved = await page.waitForFunction(() => /Password updated/.test(document.querySelector('.statusbar')?.textContent || ''), null, { timeout: 10000 }).then(() => true, () => false);
      }
      check('Auth: a password-reset link asks for a new password and saves it', form && saved, `form=${form} saved=${saved}`);

      await signOut();

      // Signing up with an address that already has an account: Supabase sends no email (and says
      // "ok" with an identity-less user), so the app must say so instead of "check your email"
      await page.route('**/auth/v1/signup**', r => r.fulfill({ json: { user: { ...user, identities: [] } } })); // the shape supabase-js reads (data.user)
      await page.goto(BASE);
      await page.click('#btn-topbar-auth');
      await page.click('button:has-text("Sign Up")');
      await page.fill('input[type="email"]', 'e2e@nexide.test');
      await page.fill('input[type="password"]', 'correct-horse-battery');
      await page.click('[aria-label="Authentication"] button[type="submit"]');
      const exists = await page.waitForFunction(() => /already has an account/.test(document.querySelector('[aria-label="Authentication"]')?.textContent || ''), null, { timeout: 10000 }).then(() => true, () => false);
      check('Auth: signing up with a registered email says so (no email is sent)', exists);
      await page.keyboard.press('Escape');

      await page.unrouteAll({ behavior: 'ignoreErrors' });
      await page.goto(BASE);
    }
  }

  // ── Dialogs: focus moves in, Tab is trapped, Escape closes, focus returns to the opener ──
  {
    await page.focus('#btn-topbar-settings');
    await page.keyboard.press('Enter');
    await page.waitForSelector('#settings-modal', { timeout: 5000 });
    const inside = () => page.evaluate(() => !!document.querySelector('#settings-modal')?.contains(document.activeElement));
    const focusedIn = await page.waitForFunction(() => document.querySelector('#settings-modal')?.contains(document.activeElement), null, { timeout: 5000 }).then(() => true, () => false);
    let trapped = true;
    for (let i = 0; i < 30; i++) {
      await page.keyboard.press(i % 7 === 6 ? 'Shift+Tab' : 'Tab');
      if (!(await inside())) { trapped = false; break; }
    }
    await page.keyboard.press('Escape');
    const closed = await page.waitForSelector('#settings-modal', { state: 'detached', timeout: 5000 }).then(() => true, () => false);
    const returned = await page.waitForFunction(() => document.activeElement?.id === 'btn-topbar-settings', null, { timeout: 5000 }).then(() => true, () => false);
    check('Dialogs: focus moves in, Tab is trapped, Escape closes, focus returns',
      focusedIn && trapped && closed && returned, JSON.stringify({ focusedIn, trapped, closed, returned }));
  }

  // ── Accessibility: axe-core audit of the main screens (WCAG 2.x A/AA rules) ──
  {
    // Own context with bypassCSP so axe can be injected; the CSP itself is checked above
    const a11yContext = await browser.newContext({ viewport: { width: 1500, height: 900 }, bypassCSP: true });
    const a = await a11yContext.newPage();
    const axeSource = readFileSync(new URL('../../node_modules/axe-core/axe.min.js', import.meta.url), 'utf8');
    const findings = [];
    const audit = async (screen) => {
      // Let enter animations (≤300ms opacity fades) finish: mid-fade text is partly transparent,
      // which axe measures as low contrast
      await a.waitForTimeout(700);
      await a.addScriptTag({ content: axeSource }).catch(() => {});
      const violations = await a.evaluate(async () => {
        // Monaco's internals are third-party; audit our UI around the editor
        const r = await window.axe.run(document, { exclude: [['.monaco-editor']], resultTypes: ['violations'] });
        return r.violations.map(v => `${v.id} (${v.impact}): ${v.nodes.slice(0, 2).map(n => n.target.join(' ')).join(', ')}`);
      });
      violations.forEach(v => findings.push(`${screen}: ${v}`));
    };
    try {
      await a.goto(BASE);
      await a.waitForTimeout(500);
      await audit('welcome');
      await a.click('#welcome-template-js');
      await a.waitForFunction(() => window.monaco?.editor.getEditors().length > 0, null, { timeout: 30000 });
      await a.click('#btn-run-code');
      await a.waitForFunction(() => /✓ Completed/.test(document.querySelector('#console-panel')?.innerText || ''), null, { timeout: 15000 }).catch(() => {});
      await audit('editor + console');
      await a.click('#btn-toggle-ai');
      await audit('AI panel');
      await a.click('.right-panel .panel-tab:has-text("Packages")');
      await audit('packages panel');
      await a.click('#btn-topbar-settings');
      await audit('settings');
      await a.keyboard.press('Escape');
      await a.click('#btn-topbar-open-github');
      await audit('GitHub dialog');
      await a.click('#btn-close-github');
      await a.keyboard.press('Control+p');
      await audit('command palette');
      await a.keyboard.press('Escape');
      // Project mode (not started: no network needed): status chip, terminal, preview placeholder
      await a.goto(BASE);
      await a.click('#welcome-project-react');
      await a.waitForFunction(() => window.monaco?.editor.getEditors().length > 0, null, { timeout: 30000 });
      await a.click('#btn-toggle-preview');
      await a.click('.activity-btn[aria-label="Terminal"]');
      await a.waitForSelector('#project-output .xterm', { timeout: 10000 }).catch(() => {});
      await audit('project mode');
    } finally {
      await a11yContext.close();
    }
    check('Accessibility: no axe violations on the main screens', findings.length === 0, findings.slice(0, 3).join(' | '));
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
