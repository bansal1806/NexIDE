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

## Phase 6 — Cross-file debugging, offline support (branch `phase-6`)

- [x] **Time travel across files** (JS and Python): imported workspace modules are recorded too; stepping into
  another file opens it and highlights the line; timeline shows `file · Line N`.
  Found & fixed: breakpoints were keyed by line only, so with multi-file programs a breakpoint matched that line
  in *every* file — now keyed by `file:line`.
- [x] **Offline**: `public/sw.js` — network-first navigations with an offline app shell, cache-first for hashed
  `/assets` and the versioned Pyodide core, stale-while-revalidate for other same-origin files; never `/api`.
  Cached responses keep COOP/COEP, so the page stays cross-origin isolated offline. Production builds only.
- Verification: lint clean · unit 71/71 · E2E 48/48 (incl. going offline and running Python).

## Phase 7 — Reproducible/offline npm packages, App.jsx split (branch `phase-7`)

- [x] **npm pinning**: unversioned imports resolve once to the exact esm.sh build and are pinned per workspace
  (local folder / GitHub repo / cloud project / scratch); "Packages: Update pinned npm versions" re-resolves.
- [x] **Offline npm**: the service worker caches immutable, versioned esm.sh URLs.
  Found & fixed: `/sw.js` inherited the app CSP, whose `connect-src` blocked the service worker's own fetch to
  esm.sh — it would have broken npm imports for every page the worker controls; it now has its own minimal CSP.
- [x] **Refactor**: `App.jsx` 989 → 818 lines — settings, notices, per-file input, package locks, deploy recovery
  and shortcuts are hooks; terminal/console and preview/AI/map/debug panels are components. No behaviour change.
- Verification: lint clean · unit 74/74 · E2E 50/50 (incl. pin, then run the package offline).

## Phase 8 — Packages panel, useWorkspace (branch `phase-8`)

- [x] **Packages panel**: a right-panel tab listing the workspace's pinned npm packages (spec → exact build),
  with npm links, per-package Unpin and Update all.
- [x] **`useWorkspace`**: tabs, opening/editing/saving/closing files and switching between local folders,
  GitHub repos and cloud projects moved out of `App.jsx` (818 → 491 lines; 989 before Phase 7). No behaviour change.
- Verification: lint clean · unit 74/74 · E2E 51/51.

## Phase 9 — Workspace unit tests, accessible tab bar (branch `phase-9`)

- [x] **`useWorkspace` unit tests** (jsdom + Testing Library, mocked file system / Monaco / network): template
  names, open-once, tree resolution, binary guard, dirty + save, close confirmation, workspace keys, run-file
  merge order and the 5 MB cap.
- [x] **Accessible tab bar**: WAI-ARIA tabs with a roving tabindex — ←/→ (wrapping), Home/End, Delete closes the
  focused tab, Enter/Space, middle-click; editor area is the labelled tabpanel. (Ctrl+W is reserved by browsers.)
- Verification: lint clean · unit 88/88 · E2E 52/52 (twice).

## Phase 10 — Accessibility pass (branch `phase-10`)

- [x] **axe-core audit → zero violations** on welcome, editor + console, AI and Packages panels, Settings, the
  GitHub dialog and the command palette. Fixed: muted-text contrast (~2.6:1 → ≥4.5:1 per theme), Run button
  contrast, a button nested inside `role="tab"`, an unfocusable scrolling console, unlabelled Settings controls,
  missing landmarks / `h1` / heading order, dialog semantics for the palette, colour-only links.
  The audit now runs in the E2E suite.
- [x] **File tree keyboard navigation** (WAI-ARIA tree, roving tabindex, ↑/↓/←/→/Home/End/Enter) and visible
  focus rings.
- [x] **Dialog focus management** (`useDialog`): focus in on open, Tab trapped, Escape closes, focus returns.
- Verification: lint clean · unit 92/92 · E2E 55/55 (twice).

Not done: visual-regression snapshots — font rendering differs between Windows dev machines and the Linux CI
runner, so pixel diffs would be noisy.

## Phase 11 — "Playground" UI/UX redesign ✅

- [x] New design language: chunky ink outlines, hard offset shadows, candy accents, pill shapes, dotted canvas,
  Fredoka / Space Grotesk / JetBrains Mono. Tokens in `src/index.css`, component layer in `src/styles/playground.css`.
- [x] Four themes rebuilt and contrast-checked (≥ 4.5:1): Playground, Lagoon, Sunset, Classic (ids unchanged).
- [x] Micro-animations: squishy buttons, striped "running" Run button, bouncing tabs, floaties on the welcome
  screen, confetti on the first successful run (and after fixing an error).
- [x] Reduced motion: CSS `prefers-reduced-motion` block + framer-motion `MotionConfig reducedMotion="user"`;
  confetti is skipped.
- [x] Layout fixes: editor no longer collapses when the console opens; the time-travel timeline sits under the
  editor instead of squeezing a third column; right-panel tabs no longer truncate.
- [x] New welcome screen (template cards, open folder / GitHub, shortcut chips).
- Verification: lint clean · unit 92/92 · E2E 55/55 (twice, incl. axe).

## Phase 12 — Full Node.js projects in the browser (WebContainers)

Goal: run real Next.js / React / Vue / Node projects — `npm install`, dev server, shell — inside the tab,
with no servers of ours. Runtime: StackBlitz WebContainers (`@webcontainer/api`). **Licensing:** free to
prototype; for-profit production use needs a commercial license from StackBlitz (**[YOU]**).

Spike findings (headless Edge, COEP `credentialless`): Vite ✅ · Express ✅ · Next.js 14 ✅ · Next.js 15.3–15.4 ✅ ·
Next.js 15.5+ / 16 ❌ (page render hits Next's async-storage invariants; API routes still work) ·
Turbopack ❌ (needs native binaries). Templates pin `next@15.4.11`; newer versions get a warning.

### 12.1 Project mode ✅ (branch `project-mode`)
- [x] Runtime hook `useProject`: lazy single WebContainer, mount → `npm install` → dev script → preview URL;
  keeps `node_modules` when package.json is unchanged; Stop / Restart; compatibility warnings.
- [x] Starter templates: Next.js (App Router + API route), React + Vite, Vue + Vite, Express API.
- [x] Any workspace with a root `package.json` runs as a project (starter, local folder, cloud project).
- [x] Terminal: xterm with dev-server output and an interactive `jsh` shell (`npm`, `node`, `ls`…).
- [x] Preview: dev-server iframe with address bar, reload, open in new tab; progress steps while starting.
- [x] Editor changes sync into the runtime (debounced) → hot reload.
- [x] CSP: `frame-src` adds only `https://stackblitz.com` and `https://*.webcontainer-api.io` (e2e-enforced).
- Verification: lint clean · unit 99/99 · E2E 63/63 (incl. React start/HMR/shell/stop, Next.js page/API/edit, axe).

Production E2E after merge: 54/54 (incl. all project checks on nex-ide.vercel.app).

### 12.2 Runtime → workspace file sync ✅ (branch `project-sync`)
- [x] Recursive watch of the runtime's files: what the project creates, changes or deletes (generators,
  `npm`'s lockfile, shell commands) reaches the workspace. Ignores `node_modules`, hidden and build
  output, binaries, files over 512 KB.
- [x] Editor writes are recorded so they don't echo back; the watcher pauses while a restart clears files.
- [x] Safety net: a rescan after each shell command and on the explorer's Refresh (watch events can be missed).
- [x] Applied per workspace: starter projects in memory, local folders written to disk, cloud projects saved.
- [x] Clean open tabs follow the project; unsaved edits are never overwritten (notice instead).
- Verification: lint clean · unit 106/106 · E2E 64/64.

Production E2E after merge: 55/55.

### 12.3 IntelliSense from installed packages ✅ (branch `project-intellisense`)
- [x] After `npm install` (and when package.json / tsconfig change), a Node script in the runtime collects the
  installed packages' declarations in one pass: dependency graph breadth-first, `@types` companions,
  24 MB / 8,000-file budget. React + TS: ~230 files; Next.js + TS: ~1,700.
- [x] Monaco's TypeScript service gets them as extra libs plus the project's tsconfig options (strict, jsx,
  `paths` aliases such as `@/*`). Default options: bundler resolution, react-jsx, JSON modules, not strict.
  Cleared when the workspace changes.
- [x] Next.js + TypeScript and React + TypeScript starters.
- [x] Fixed for Monaco 0.57: the TypeScript API now lives at `monaco.typescript`.
- Verification: lint clean · unit 113/113 · E2E 67/67 (twice): no false errors in a TS project, a real type
  error is caught, completions come from the installed React types.

Production E2E after merge: 58/58.

### 12.4 GitHub repos as projects; Svelte and Astro ✅ (branch `project-github`)
- [x] A GitHub repo with a root package.json runs as a project. Starting it downloads its text files first
  (same rules as runtime sync; up to 1,500 files / 30 MB, else a clear error), shown as a "Download" step.
  Public repos: raw.githubusercontent.com (no API rate limit); with a token: the contents API (private repos).
  Downloads are cached on the tree; CSP connect-src adds raw.githubusercontent.com.
- [x] Runtime changes update a GitHub tree in place (`withFileChanges` keeps unloaded files and metadata);
  they stay in NexIDE, since GitHub is read-only here.
- [x] Svelte 5 + Vite and Astro 5 starters (verified: render, hot reload, shell).
- Verification: lint clean · unit 119/119 · E2E 68/68 (twice), incl. a mocked GitHub repo that downloads only
  its eligible files, installs and renders.

Production E2E after merge: 59/59.

### 12.5 Dependencies kept between visits ✅ (branch `project-cache`)
- [x] After a successful install, `node_modules` (binary snapshot) and the generated lockfile go to IndexedDB in
  the background, keyed by a SHA-256 of the dependency fields and lockfile.
- [x] Next start with the same dependencies: mount the snapshot, restore executable bits (snapshots drop them;
  without it `vite` fails with EACCES), then `npm install` only verifies. A "Dependencies restored" badge shows it.
- [x] Least recently used snapshots evicted beyond 3 projects / 600 MB; Settings → Projects shows usage and clears it.
- Measured: React 48s → 14s, Next.js 82s → 20s (snapshot 38 MB / 123 MB).
- Verification: lint clean · unit 125/125 · E2E 69/69 (three runs; one transient CDN failure in an unrelated
  Python check on another run).

**Phase 12 complete.** Ideas beyond it: Remix / SvelteKit / Nuxt starters, pushing changes back to GitHub
(needs OAuth), and a pnpm option.

## Ideas for a later phase

- Screen-reader announcements for run results (polite live region summarising "Completed in 12 ms" / errors).
- Restore a Supabase project for production sign-in and cloud workspaces (**[YOU]**, dashboard).
