# NexIDE Remediation Plan — Phase 1

Source: full codebase audit (2026-10-02). Each step lists the problem and the fix.
Items marked **[YOU]** need dashboard access and cannot be done from code.

## Step 0 — Secrets (do first)

- [ ] **[YOU]** Supabase → Settings → API: revoke/roll the leaked `service_role` key (it is in the live bundle).
- [ ] **[YOU]** Rotate the Gemini key that was in the first commit's `.env`.
- [ ] **[YOU]** Vercel env: set `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`; delete `VITE_SUPABASE_ANON_KEY`; optionally `GEMINI_API_KEY` (server-only). Redeploy.
- [ ] **[YOU]** Local `.env`: delete the `VITE_SUPABASE_ANON_KEY` and `VITE_GEMINI_API_KEY` lines.
- [ ] **[YOU]** Run `supabase/migrations/001_hardening.sql` (purges stored secrets, tightens RLS).
- [ ] **[YOU]** `git update-ref -d refs/original/refs/heads/main` (+ remotes ref), `git reflog expire --expire=now --all && git gc --prune=now` to drop the old `.env` blob locally.
- [x] Client reads only the publishable key and **refuses to start with a `service_role` JWT**.
- [x] `.env.example` documents every variable; no secret uses a `VITE_` prefix.

## Step 1 — Sandbox code execution

- [x] JS/TS runs in a dedicated module Web Worker (no DOM, no `localStorage`, no session token), off the UI thread.
- [x] Stop button terminates the worker (infinite loops no longer freeze the tab).
- [x] Async output (timers/promises) is streamed; top-level `await` supported.
- [x] TypeScript transpiled with Sucrase (line numbers preserved).

## Step 2 — Debugger correctness

- [x] Replace line/regex instrumentation with an AST (acorn) instrumenter — fixes TDZ ReferenceError, multi-line objects, method chains.
- [x] Real call stack (function enter/exit) for JS; frame stack for Python.
- [x] Breakpoints work: after recording, playhead jumps to first hit; next/prev-breakpoint controls; playback pauses at breakpoints.
- [x] Python: step cap, robust locals serialization, isReady when Pyodide is actually loaded, Stop handler fixed, Pyodide 0.28.3.

## Step 3 — AI

- [x] With a user key, the browser calls Gemini directly (key never touches our server).
- [x] `/api/generate` only uses the system key for **signed-in** users; input size limits; per-user rate limit; valid history.
- [x] Model configurable (`GEMINI_MODEL`, default `gemini-2.5-flash`).
- [x] Chat panel passes the key; code lenses fixed (regex bug).
- [x] `/api` works in `npm run dev` via a Vite dev middleware.

## Step 4 — Data integrity & settings

- [x] Monaco commands use refs → Ctrl+S / Ctrl+Enter act on current content (was data loss).
- [x] Secrets (`geminiApiKey`, `githubToken`) never synced to cloud.
- [x] Cloud settings sync: fetch-then-persist, debounced; no more overwrite race.
- [x] Settings modal uses a draft: Cancel reverts, Esc closes. Auto Save implemented. Monaco follows theme.

## Step 5 — App wiring bugs

- [x] `editorRef` prop mismatch (jump-to-line), console Clear, terminal close/run, Code Map / terminal open empty tabs, workspace model disposal, cloud nested tree + New File + refresh without data loss, error handling on cloud create, AuthContext without Supabase, timeline key capture inside editor, Code Map re-render cost, misc.

## Step 6 — GitHub

- [x] Use repo `default_branch`, UTF-8 decoding, URL-encoded paths, `.git` suffix, truncated-tree warning.

## Step 7 — Preview

- [x] Verify message source; escape `</script>`; TS transpiled in preview.

## Step 8 — Database

- [x] Migration: `(select auth.uid())` policies with explicit `WITH CHECK`, `owner_id` index, purge secrets from `user_settings`.

## Step 9 — Hygiene, deps, tests

- [x] Remove empty `server/`, stale logs, `test.cjs`, unused deps (`bcryptjs`, `jsonwebtoken`).
- [x] dompurify override → patched version; lint clean; ESLint globals for workers / api.
- [x] Lazy-load heavy panels (D3 map, preview, AI SDK) to shrink the main chunk.
- [x] Security headers in `vercel.json`.
- [x] Vitest unit tests: instrumenter, runner, GitHub URL parsing, Gemini history, settings sanitizing.
- [x] README privacy claim corrected.

## Verification (2026-10-02)

- `npm run lint` — clean · `npm test` — 39/39 · `npm run build` — OK (main chunk 712 KB → 130 KB) · `npm audit` — 0 vulnerabilities
- Browser E2E (Edge, headless) against both `vite dev` and the production build: 17/17 — JS/TS run, async output,
  sandbox (no `localStorage`/DOM), Stop on infinite loop, syntax-error line, debugger (TDZ case, timeline, call stack),
  code lenses, preview, Python run/traceback/debug/Stop, no page errors; in-editor Ctrl+Enter runs the latest edit.
- Production bundle contains no `service_role` JWT.

## Phase 2 — Defense in depth

- [x] **E2E in repo**: `npm run test:e2e` builds, serves the production bundle under the real
  `vercel.json` headers, and drives local Edge/Chrome (playwright-core) — 27 checks.
  Found & fixed: code lenses vanished after a layout change during a pending lens request.
- [x] **Worker lockdown**: runner workers lose `indexedDB`, `caches`, `Worker`, `SharedWorker`,
  `BroadcastChannel`, `navigator.storage` (removed from the whole prototype chain; also for Python's `js` module).
- [x] **Content-Security-Policy**: strict app policy (scripts: self + jsDelivr only, no inline/eval,
  restricted `connect-src`, no framing). Preview moved from `srcdoc` (inherits the app CSP) to a sandboxed
  `/preview.html` host with its own permissive policy; workers get minimal per-file policies.
  Monaco pinned to 0.57.0 (CDN default 0.55.1 bundled a vulnerable DOMPurify).
- [x] **Durable rate limits**: Upstash / Vercel KV shared counters, per-minute + daily quota, memory fallback.
- [x] **Encrypted API keys**: AES-GCM with a non-extractable key in IndexedDB; ciphertext in local/session
  storage ("Remember on this device" toggle); legacy plaintext migrated on load.
  Found & fixed: plaintext was stripped before the debounced encrypted save, so a quick close lost the key.

**[YOU]** Optional: create an Upstash Redis (or Vercel KV) store and set `UPSTASH_REDIS_REST_URL` /
`UPSTASH_REDIS_REST_TOKEN` in Vercel for shared limits.

## Phase 3 — CI, self-hosting, Python features (branch `phase-3`)

- [x] **CI**: `.github/workflows/ci.yml` — lint, unit tests, prod-dependency audit, build + browser E2E
  (Chrome on ubuntu-latest) on every push and PR.
- [x] **Self-hosted Monaco**: bundled (lazy chunk) instead of jsDelivr, so no CDN code runs in the app
  origin next to the user's session. App CSP is now `script-src 'self'` / `worker-src 'self'`; jsDelivr is
  only allowed in the isolated Pyodide worker. TS diagnostics verified under CSP.
  Found & fixed: Ctrl+Enter / Ctrl+S / F5 right after typing used the previous text (state lags the editor).
- [x] **Python packages**: imports (numpy, pandas, …) install automatically from the Pyodide distribution.
- [x] **Program input**: console Input box feeds `input()` (Python) and `prompt()` (JS); EOF hint.
- Verification: lint clean · unit 52/52 · E2E 33/33 under production headers.

## Phase 4 — Self-hosted Python, multi-file projects, interactive input (branch `phase-4`)

- [x] **Self-hosted Pyodide core** (`/pyodide/v0.28.3/`, copied from the pinned npm package at build, cached
  immutable); only optional packages use jsDelivr; the Python worker's CSP allows no CDN scripts.
- [x] **Multi-file projects**: JS/TS `import`/`export` between workspace files (Sucrase → CommonJS + workspace
  `require`, `.ts`/`.json`, circular imports; debugger lines preserved); Python `import helper` and
  `open('data.csv')` via the virtual FS.
- [x] **Interactive input**: cross-origin isolation (COOP `same-origin` + COEP `credentialless`) enables a
  SharedArrayBuffer channel; programs block in `input()` / `prompt()` while the console shows an inline prompt
  (Enter to send, Ctrl+D / EOF button). Pre-filled Input-box lines are used first. Stop works while waiting.
- Found & fixed: every Python run after the first failed to rebuild the workspace (cwd inside the folder being
  deleted); Pyodide's `stdin` callback read ahead and asked for the next line early (switched to `read()`).
- Verification: lint clean · unit 66/66 · E2E 41/41 under production headers.

Note: COEP `credentialless` means third-party iframes *inside a user's preview page* (e.g. a YouTube embed)
load only if they are COEP-compatible; scripts, images, fonts and fetch from CDNs are unaffected.
Safari lacks `credentialless`, so there the page isn't isolated and input falls back to the pre-filled box.

## Phase 5 — Deploy resilience, npm packages, per-file input (branch `phase-5`)

- [x] **Deploy skew**: a tab open during a deploy no longer breaks — `/assets` and `/pyodide` aren't rewritten to
  `index.html` (real 404s); on a stale lazy chunk the app reloads itself if nothing is unsaved, otherwise
  `ChunkErrorBoundary` offers Reload and the status bar asks the user to save first.
  Found & fixed along the way: `preventDefault()` on `vite:preloadError` made Vite resolve the import with
  `undefined`, crashing the panel.
- [x] **npm packages in the JS runner**: bare imports (`lodash-es`, `dayjs`, `@scope/pkg@ver/sub`) are fetched from
  esm.sh before the run (names validated; esm.sh is the only remote script source in the worker CSP).
- [x] **Input box per file**, remembered across reloads (50 files × 10 KB cap).
- Verification: lint clean · unit 70/70 · E2E 45/45 under production headers.

## Ideas for a later phase

- Python debugger for imported workspace modules (currently traces the entry file).
- Pin npm package versions per workspace (a small lockfile) for reproducible runs.
- Offline support (service worker caching the app shell, Monaco and the Pyodide core).
