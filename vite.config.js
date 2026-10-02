import { readFileSync, createReadStream } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, extname } from 'node:path'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// Serves the Vercel functions in /api during `npm run dev` (Vercel runs them in production).
function vercelApiDev() {
  return {
    name: 'nexide-vercel-api-dev',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const match = req.url?.match(/^\/api\/([\w-]+)(?:\?.*)?$/);
        if (!match) return next();
        try {
          const chunks = [];
          for await (const chunk of req) chunks.push(chunk);
          const raw = Buffer.concat(chunks).toString('utf8');
          let body = {};
          if (raw) {
            try { body = JSON.parse(raw); } catch { body = raw; }
          }
          const { default: handler } = await server.ssrLoadModule(`/api/${match[1]}.js`);
          const vres = {
            status(code) { res.statusCode = code; return vres; },
            setHeader(k, v) { res.setHeader(k, v); return vres; },
            json(obj) { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(obj)); return vres; },
          };
          await handler({ method: req.method, headers: req.headers, body, url: req.url }, vres);
        } catch (err) {
          server.config.logger.error(`[api] ${err.stack || err}`);
          if (!res.headersSent) { res.statusCode = 500; res.end('{"error":"dev api error"}'); }
        }
      });
    },
  };
}

// Applies the "headers" rules from vercel.json in `vite preview`, so the production
// CSP is exercised locally (npm run test:e2e). The sources used in vercel.json are
// plain regexes once anchored, which is all this needs to support.
function vercelHeadersPreview() {
  const rules = JSON.parse(readFileSync(new URL('./vercel.json', import.meta.url), 'utf8')).headers || [];
  const compiled = rules.map(r => ({ re: new RegExp(`^${r.source}$`), headers: r.headers }));
  return {
    name: 'nexide-vercel-headers-preview',
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = (req.url || '/').split('?')[0];
        for (const { re, headers } of compiled) {
          if (re.test(path)) headers.forEach(h => res.setHeader(h.key, h.value));
        }
        next();
      });
    },
  };
}

// Self-host the Pyodide core (interpreter + stdlib) from the `pyodide` npm package at
// /pyodide/v<version>/ — served from node_modules in dev, emitted into dist on build.
// Optional packages (numpy, …) still come from jsDelivr via packageBaseUrl in the worker.
const PYODIDE_CORE_FILES = ['pyodide.js', 'pyodide.asm.js', 'pyodide.asm.wasm', 'python_stdlib.zip', 'pyodide-lock.json'];
const MIME = { '.js': 'text/javascript', '.wasm': 'application/wasm', '.zip': 'application/zip', '.json': 'application/json' };

export function pyodideCoreInfo() {
  const dir = dirname(createRequire(import.meta.url).resolve('pyodide'));
  const { version } = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  return { dir, version, base: `pyodide/v${version}/` };
}

function selfHostPyodide() {
  const { dir, base } = pyodideCoreInfo();
  return {
    name: 'nexide-self-host-pyodide',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = (req.url || '').split('?')[0];
        const file = path.startsWith(`/${base}`) ? path.slice(base.length + 1) : null;
        if (!file || !PYODIDE_CORE_FILES.includes(file)) return next();
        res.setHeader('Content-Type', MIME[extname(file)] || 'application/octet-stream');
        createReadStream(join(dir, file)).pipe(res);
      });
    },
    generateBundle() {
      for (const file of PYODIDE_CORE_FILES) {
        this.emitFile({ type: 'asset', fileName: base + file, source: readFileSync(join(dir, file)) });
      }
    },
  };
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Make server-only variables (GEMINI_API_KEY…) visible to /api handlers in dev
  const env = loadEnv(mode, process.cwd(), '');
  for (const [k, v] of Object.entries(env)) {
    if (process.env[k] === undefined) process.env[k] = v;
  }

  return {
    plugins: [react(), vercelApiDev(), vercelHeadersPreview(), selfHostPyodide()],
    worker: { format: 'es' },
    build: {
      // Monaco (lazy-loaded, self-hosted) is ~2.7 MB minified by design
      chunkSizeWarningLimit: 3000,
      rolldownOptions: {
        output: {
          codeSplitting: {
            groups: [
              { name: 'react', test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/ },
              { name: 'supabase', test: /node_modules[\\/]@supabase[\\/]/ },
              { name: 'motion', test: /node_modules[\\/](framer-motion|motion-dom|motion-utils)[\\/]/ },
            ],
          },
        },
      },
    },
    test: {
      environment: 'node',
    },
  };
})
