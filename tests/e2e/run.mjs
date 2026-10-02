// Browser end-to-end checks against the production build.
// Usage: npm run test:e2e   (builds first; uses the locally installed Edge or Chrome)
//   E2E_BASE=http://localhost:5173/ node tests/e2e/run.mjs   → test a running dev server instead
//   E2E_BROWSER=chrome|msedge                                 → pick the browser channel
import { chromium } from 'playwright-core';
import { preview } from 'vite';

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
  await page.goto(BASE);
  // A stored secret that user code must not be able to read
  await page.evaluate(() => localStorage.setItem('nexide:settings', JSON.stringify({ geminiApiKey: 'AIza-E2E-SECRET' })));

  // ── JavaScript ──
  await openTemplate('js');
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
  await page.selectOption('#language-select', 'javascript');

  // ── Live preview ──
  await setCode(`console.log('from preview');\ndocument.body.innerHTML = '<p id="out">"</script>" ok</p>';`);
  await page.click('#btn-toggle-preview');
  const frame = page.frameLocator('#preview-iframe');
  const frameText = await frame.locator('#out').innerText({ timeout: 10000 }).catch(e => `ERR ${e.message}`);
  check('Preview: renders; </script> in code does not break it', /ok$/.test(frameText.trim()), frameText.slice(0, 40));
  check('Preview: console bridged to app console', await waitConsole(/from preview/, 5000));

  // ── Python ──
  await openTemplate('py');
  await setCode(`def square(n):\n    r = n * n\n    return r\n\nnums = [square(i) for i in range(4)]\nprint("nums", nums)`);
  await run();
  check('Python: runs via Pyodide', await waitConsole(/nums \[0, 1, 4, 9\]/, 90000));

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

  const relevant = pageErrors.filter(e => !/favicon/i.test(e));
  check('No page errors or CSP violations', relevant.length === 0, relevant.slice(0, 3).join(' | '));
} finally {
  await browser.close();
  await server?.close();
}

const failed = results.filter(r => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
