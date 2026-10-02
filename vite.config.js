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

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Make server-only variables (GEMINI_API_KEY…) visible to /api handlers in dev
  const env = loadEnv(mode, process.cwd(), '');
  for (const [k, v] of Object.entries(env)) {
    if (process.env[k] === undefined) process.env[k] = v;
  }

  return {
    plugins: [react(), vercelApiDev()],
    worker: { format: 'es' },
    build: {
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
