// Starter projects that run in the in-browser Node.js runtime (WebContainers).
// Versions are pinned to ones verified to work there: Next.js after 15.4 hits
// async-storage invariants in the browser runtime, and Turbopack needs native binaries.

const json = (value) => JSON.stringify(value, null, 2) + '\n';

const NEXT = {
  'package.json': json({
    name: 'my-next-app',
    private: true,
    scripts: { dev: 'next dev', build: 'next build', start: 'next start' },
    dependencies: { next: '15.4.11', react: '19.1.0', 'react-dom': '19.1.0' },
  }),
  'next.config.mjs': `/** @type {import('next').NextConfig} */
const nextConfig = {};

export default nextConfig;
`,
  'jsconfig.json': json({ compilerOptions: { paths: { '@/*': ['./*'] } } }),
  'app/layout.jsx': `import './globals.css';

export const metadata = {
  title: 'My Next.js app',
  description: 'Built in NexIDE',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
`,
  'app/page.jsx': `import Counter from './counter';

export default async function Home() {
  // Server Component: this runs on the (in-browser) Node.js server
  const renderedAt = new Date().toLocaleTimeString();

  return (
    <main>
      <h1>Hello from Next.js</h1>
      <p>Edit <code>app/page.jsx</code> and save — the page updates instantly.</p>
      <p className="muted">Rendered on the server at {renderedAt}</p>
      <Counter />
      <p>
        API route: <a href="/api/hello">/api/hello</a>
      </p>
    </main>
  );
}
`,
  'app/counter.jsx': `'use client';

import { useState } from 'react';

export default function Counter() {
  const [count, setCount] = useState(0);
  return (
    <button onClick={() => setCount(c => c + 1)}>
      Clicked {count} {count === 1 ? 'time' : 'times'}
    </button>
  );
}
`,
  'app/api/hello/route.js': `export function GET() {
  return Response.json({ message: 'Hello from a Next.js API route', time: Date.now() });
}
`,
  'app/globals.css': `body {
  margin: 0;
  font-family: system-ui, sans-serif;
  background: #1b1726;
  color: #f7f3ff;
}

main {
  max-width: 640px;
  margin: 64px auto;
  padding: 0 24px;
}

a { color: #8fd8ff; }
.muted { color: #cfc6e6; }

button {
  font: inherit;
  font-weight: 700;
  padding: 8px 16px;
  border: 2px solid #0d0b13;
  border-radius: 999px;
  background: #7df2c6;
  color: #0d0b13;
  cursor: pointer;
}
`,
};

const REACT = {
  'package.json': json({
    name: 'my-react-app',
    private: true,
    type: 'module',
    scripts: { dev: 'vite', build: 'vite build', preview: 'vite preview' },
    dependencies: { react: '19.1.0', 'react-dom': '19.1.0' },
    devDependencies: { vite: '^6.3.0', '@vitejs/plugin-react': '^4.5.0' },
  }),
  'vite.config.js': `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
});
`,
  'index.html': `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>My React app</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>
`,
  'src/main.jsx': `import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './index.css';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
`,
  'src/App.jsx': `import { useState } from 'react';

export default function App() {
  const [count, setCount] = useState(0);

  return (
    <main>
      <h1>Hello from React</h1>
      <p>Edit <code>src/App.jsx</code> — changes appear instantly (hot reload).</p>
      <button onClick={() => setCount(c => c + 1)}>
        Clicked {count} {count === 1 ? 'time' : 'times'}
      </button>
    </main>
  );
}
`,
  'src/index.css': `body {
  margin: 0;
  font-family: system-ui, sans-serif;
  background: #1b1726;
  color: #f7f3ff;
}

main {
  max-width: 640px;
  margin: 64px auto;
  padding: 0 24px;
}

button {
  font: inherit;
  font-weight: 700;
  padding: 8px 16px;
  border: 2px solid #0d0b13;
  border-radius: 999px;
  background: #ffe27a;
  color: #0d0b13;
  cursor: pointer;
}
`,
};

const VUE = {
  'package.json': json({
    name: 'my-vue-app',
    private: true,
    type: 'module',
    scripts: { dev: 'vite', build: 'vite build', preview: 'vite preview' },
    dependencies: { vue: '^3.5.0' },
    devDependencies: { vite: '^6.3.0', '@vitejs/plugin-vue': '^5.2.0' },
  }),
  'vite.config.js': `import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
});
`,
  'index.html': `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>My Vue app</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.js"></script>
  </body>
</html>
`,
  'src/main.js': `import { createApp } from 'vue';
import App from './App.vue';
import './style.css';

createApp(App).mount('#app');
`,
  'src/App.vue': `<script setup>
import { ref } from 'vue';

const count = ref(0);
</script>

<template>
  <main>
    <h1>Hello from Vue</h1>
    <p>Edit <code>src/App.vue</code> — changes appear instantly (hot reload).</p>
    <button @click="count++">Clicked {{ count }} {{ count === 1 ? 'time' : 'times' }}</button>
  </main>
</template>
`,
  'src/style.css': `body {
  margin: 0;
  font-family: system-ui, sans-serif;
  background: #1b1726;
  color: #f7f3ff;
}

main {
  max-width: 640px;
  margin: 64px auto;
  padding: 0 24px;
}

button {
  font: inherit;
  font-weight: 700;
  padding: 8px 16px;
  border: 2px solid #0d0b13;
  border-radius: 999px;
  background: #7df2c6;
  color: #0d0b13;
  cursor: pointer;
}
`,
};

// Shared look for the TypeScript starters
const TS_CSS = `body {
  margin: 0;
  font-family: system-ui, sans-serif;
  background: #1b1726;
  color: #f7f3ff;
}

main {
  max-width: 640px;
  margin: 64px auto;
  padding: 0 24px;
}

a { color: #8fd8ff; }
.muted { color: #cfc6e6; }

button {
  font: inherit;
  font-weight: 700;
  padding: 8px 16px;
  border: 2px solid #0d0b13;
  border-radius: 999px;
  background: #8fd8ff;
  color: #0d0b13;
  cursor: pointer;
}
`;

const NEXT_TS = {
  'package.json': json({
    name: 'my-next-ts-app',
    private: true,
    scripts: { dev: 'next dev', build: 'next build', start: 'next start' },
    dependencies: { next: '15.4.11', react: '19.1.0', 'react-dom': '19.1.0' },
    devDependencies: { typescript: '^5.8.0', '@types/node': '^22.0.0', '@types/react': '^19.1.0', '@types/react-dom': '^19.1.0' },
  }),
  'tsconfig.json': json({
    compilerOptions: {
      target: 'ES2017',
      lib: ['dom', 'dom.iterable', 'esnext'],
      allowJs: true,
      skipLibCheck: true,
      strict: true,
      noEmit: true,
      esModuleInterop: true,
      module: 'esnext',
      moduleResolution: 'bundler',
      resolveJsonModule: true,
      isolatedModules: true,
      jsx: 'preserve',
      incremental: true,
      plugins: [{ name: 'next' }],
      paths: { '@/*': ['./*'] },
    },
    include: ['next-env.d.ts', '**/*.ts', '**/*.tsx', '.next/types/**/*.ts'],
    exclude: ['node_modules'],
  }),
  'next-env.d.ts': `/// <reference types="next" />
/// <reference types="next/image-types/global" />
`,
  'next.config.ts': `import type { NextConfig } from 'next';

const nextConfig: NextConfig = {};

export default nextConfig;
`,
  'lib/greeting.ts': `export type Visitor = { name: string; visits: number };

export function greet(visitor: Visitor): string {
  return \`Hello \${visitor.name}, visit #\${visitor.visits}\`;
}
`,
  'app/layout.tsx': `import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'My Next.js + TypeScript app',
  description: 'Built in NexIDE',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
`,
  'app/page.tsx': `import { greet } from '@/lib/greeting';
import Counter from './counter';

export default async function Home() {
  // Server Component: this runs on the (in-browser) Node.js server
  const message = greet({ name: 'TypeScript', visits: 1 });

  return (
    <main>
      <h1>Hello from Next.js + TypeScript</h1>
      <p>{message}</p>
      <p className="muted">Hover a symbol or type a dot for type-aware completions.</p>
      <Counter start={0} />
      <p>
        API route: <a href="/api/hello">/api/hello</a>
      </p>
    </main>
  );
}
`,
  'app/counter.tsx': `'use client';

import { useState } from 'react';

type CounterProps = { start: number };

export default function Counter({ start }: CounterProps) {
  const [count, setCount] = useState(start);
  return (
    <button onClick={() => setCount(c => c + 1)}>
      Clicked {count} {count === 1 ? 'time' : 'times'}
    </button>
  );
}
`,
  'app/api/hello/route.ts': `export function GET(): Response {
  return Response.json({ message: 'Hello from a typed Next.js API route', time: Date.now() });
}
`,
  'app/globals.css': TS_CSS,
};

const REACT_TS = {
  'package.json': json({
    name: 'my-react-ts-app',
    private: true,
    type: 'module',
    scripts: { dev: 'vite', build: 'vite build', preview: 'vite preview' },
    dependencies: { react: '19.1.0', 'react-dom': '19.1.0' },
    devDependencies: { vite: '^6.3.0', '@vitejs/plugin-react': '^4.5.0', '@types/react': '^19.1.0', '@types/react-dom': '^19.1.0' },
  }),
  'tsconfig.json': json({
    compilerOptions: {
      target: 'ES2020',
      useDefineForClassFields: true,
      lib: ['ES2020', 'DOM', 'DOM.Iterable'],
      module: 'ESNext',
      skipLibCheck: true,
      moduleResolution: 'bundler',
      allowImportingTsExtensions: true,
      isolatedModules: true,
      moduleDetection: 'force',
      noEmit: true,
      jsx: 'react-jsx',
      strict: true,
    },
    include: ['src'],
  }),
  'vite.config.ts': `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
});
`,
  'index.html': `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>My React + TypeScript app</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`,
  'src/vite-env.d.ts': `/// <reference types="vite/client" />
`,
  'src/main.tsx': `import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App title="Hello from React + TypeScript" />
  </StrictMode>,
);
`,
  'src/App.tsx': `import { useState } from 'react';

type AppProps = { title: string };

export default function App({ title }: AppProps) {
  const [count, setCount] = useState(0);

  return (
    <main>
      <h1>{title}</h1>
      <p>Edit <code>src/App.tsx</code> — types are checked as you type, and changes hot-reload.</p>
      <button onClick={() => setCount(c => c + 1)}>
        Clicked {count} {count === 1 ? 'time' : 'times'}
      </button>
    </main>
  );
}
`,
  'src/index.css': TS_CSS,
};

const SVELTE = {
  'package.json': json({
    name: 'my-svelte-app',
    private: true,
    type: 'module',
    scripts: { dev: 'vite', build: 'vite build', preview: 'vite preview' },
    devDependencies: { vite: '^6.3.0', svelte: '^5.0.0', '@sveltejs/vite-plugin-svelte': '^5.0.0' },
  }),
  'vite.config.js': `import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  plugins: [svelte()],
});
`,
  'index.html': `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>My Svelte app</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.js"></script>
  </body>
</html>
`,
  'src/main.js': `import { mount } from 'svelte';
import App from './App.svelte';
import './app.css';

mount(App, { target: document.getElementById('app') });
`,
  'src/App.svelte': `<script>
  let count = $state(0);
</script>

<main>
  <h1>Hello from Svelte</h1>
  <p>Edit <code>src/App.svelte</code> — changes appear instantly (hot reload).</p>
  <button onclick={() => count++}>Clicked {count} {count === 1 ? 'time' : 'times'}</button>
</main>
`,
  'src/app.css': `body {
  margin: 0;
  font-family: system-ui, sans-serif;
  background: #1b1726;
  color: #f7f3ff;
}

main {
  max-width: 640px;
  margin: 64px auto;
  padding: 0 24px;
}

button {
  font: inherit;
  font-weight: 700;
  padding: 8px 16px;
  border: 2px solid #0d0b13;
  border-radius: 999px;
  background: #ffb98f;
  color: #0d0b13;
  cursor: pointer;
}
`,
};

const ASTRO = {
  'package.json': json({
    name: 'my-astro-site',
    private: true,
    type: 'module',
    scripts: { dev: 'astro dev', build: 'astro build', preview: 'astro preview' },
    dependencies: { astro: '^5.0.0' },
  }),
  'astro.config.mjs': `import { defineConfig } from 'astro/config';

export default defineConfig({});
`,
  'src/layouts/Layout.astro': `---
const { title } = Astro.props;
---

<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width" />
    <title>{title}</title>
  </head>
  <body>
    <slot />
  </body>
</html>

<style is:global>
  body {
    margin: 0;
    font-family: system-ui, sans-serif;
    background: #1b1726;
    color: #f7f3ff;
  }
  main {
    max-width: 640px;
    margin: 64px auto;
    padding: 0 24px;
  }
  a { color: #8fd8ff; }
</style>
`,
  'src/pages/index.astro': `---
import Layout from '../layouts/Layout.astro';

// Runs on the server for every request in dev
const planets = ['Mercury', 'Venus', 'Earth', 'Mars'];
---

<Layout title="My Astro site">
  <main>
    <h1>Hello from Astro</h1>
    <p>Edit <code>src/pages/index.astro</code> — the page reloads as you type.</p>
    <ul>
      {planets.map((planet) => <li>{planet}</li>)}
    </ul>
    <p><a href="/about">About this site →</a></p>
  </main>
</Layout>
`,
  'src/pages/about.astro': `---
import Layout from '../layouts/Layout.astro';
---

<Layout title="About">
  <main>
    <h1>About</h1>
    <p>Every <code>.astro</code> file in <code>src/pages</code> is a route.</p>
    <p><a href="/">← Home</a></p>
  </main>
</Layout>
`,
};

const SVELTEKIT = {
  'package.json': json({
    name: 'my-sveltekit-app',
    private: true,
    type: 'module',
    scripts: { dev: 'vite dev', build: 'vite build', preview: 'vite preview' },
    devDependencies: {
      '@sveltejs/adapter-auto': '^6.0.0',
      '@sveltejs/kit': '^2.20.0',
      '@sveltejs/vite-plugin-svelte': '^5.0.0',
      svelte: '^5.0.0',
      vite: '^6.3.0',
    },
  }),
  'svelte.config.js': `import adapter from '@sveltejs/adapter-auto';

export default {
  kit: { adapter: adapter() },
};
`,
  'vite.config.js': `import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [sveltekit()],
});
`,
  'src/app.html': `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    %sveltekit.head%
  </head>
  <body data-sveltekit-preload-data="hover">
    <div style="display: contents">%sveltekit.body%</div>
  </body>
</html>
`,
  'src/routes/+layout.svelte': `<script>
  import '../app.css';
  let { children } = $props();
</script>

{@render children()}
`,
  'src/routes/+page.server.js': `// Runs on the (in-browser) Node.js server for every request
export function load() {
  return { renderedAt: new Date().toLocaleTimeString() };
}
`,
  'src/routes/+page.svelte': `<script>
  let { data } = $props();
  let count = $state(0);
</script>

<main>
  <h1>Hello from SvelteKit</h1>
  <p>Edit <code>src/routes/+page.svelte</code> — changes appear instantly.</p>
  <p class="muted">Loaded on the server at {data.renderedAt}</p>
  <button onclick={() => count++}>Clicked {count} {count === 1 ? 'time' : 'times'}</button>
  <p>API route: <a href="/api/hello">/api/hello</a></p>
</main>
`,
  'src/routes/api/hello/+server.js': `import { json } from '@sveltejs/kit';

export function GET() {
  return json({ message: 'Hello from a SvelteKit endpoint', time: Date.now() });
}
`,
  'src/app.css': `body {
  margin: 0;
  font-family: system-ui, sans-serif;
  background: #1b1726;
  color: #f7f3ff;
}

main {
  max-width: 640px;
  margin: 64px auto;
  padding: 0 24px;
}

a { color: #8fd8ff; }
.muted { color: #cfc6e6; }

button {
  font: inherit;
  font-weight: 700;
  padding: 8px 16px;
  border: 2px solid #0d0b13;
  border-radius: 999px;
  background: #ffb98f;
  color: #0d0b13;
  cursor: pointer;
}
`,
};

const NUXT = {
  'package.json': json({
    name: 'my-nuxt-app',
    private: true,
    type: 'module',
    scripts: { dev: 'nuxt dev', build: 'nuxt build', postinstall: 'nuxt prepare' },
    dependencies: { nuxt: '^3.17.0', vue: '^3.5.0' },
  }),
  'nuxt.config.ts': `export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: false },
  css: ['~/assets/main.css'],
});
`,
  'app.vue': `<script setup>
// useFetch runs on the server first, then hydrates in the browser
const { data } = await useFetch('/api/hello');
const count = ref(0);
</script>

<template>
  <main>
    <h1>Hello from Nuxt</h1>
    <p>Edit <code>app.vue</code> — changes appear instantly (hot reload).</p>
    <p class="muted">From the server: {{ data?.message }}</p>
    <button @click="count++">Clicked {{ count }} {{ count === 1 ? 'time' : 'times' }}</button>
    <p>API route: <a href="/api/hello">/api/hello</a></p>
  </main>
</template>
`,
  'server/api/hello.ts': `export default defineEventHandler(() => ({
  message: 'Hello from a Nuxt server route',
  time: Date.now(),
}));
`,
  'assets/main.css': `body {
  margin: 0;
  font-family: system-ui, sans-serif;
  background: #1b1726;
  color: #f7f3ff;
}

main {
  max-width: 640px;
  margin: 64px auto;
  padding: 0 24px;
}

a { color: #8fd8ff; }
.muted { color: #cfc6e6; }

button {
  font: inherit;
  font-weight: 700;
  padding: 8px 16px;
  border: 2px solid #0d0b13;
  border-radius: 999px;
  background: #7df2c6;
  color: #0d0b13;
  cursor: pointer;
}
`,
};

const EXPRESS = {
  'package.json': json({
    name: 'my-express-api',
    private: true,
    type: 'module',
    scripts: { dev: 'node --watch server.js', start: 'node server.js' },
    dependencies: { express: '^4.21.0' },
  }),
  'server.js': `import express from 'express';

const app = express();
app.use(express.json());

const todos = [
  { id: 1, title: 'Try NexIDE projects', done: true },
  { id: 2, title: 'Build something fun', done: false },
];

app.get('/', (req, res) => {
  res.send(\`<h1>Hello from Express</h1>
<p>Edit <code>server.js</code> and save — the server restarts automatically.</p>
<p>Try the JSON API: <a href="/api/todos">/api/todos</a></p>\`);
});

app.get('/api/todos', (req, res) => res.json(todos));

app.post('/api/todos', (req, res) => {
  const todo = { id: todos.length + 1, title: String(req.body?.title || 'Untitled'), done: false };
  todos.push(todo);
  res.status(201).json(todo);
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(\`API listening on http://localhost:\${port}\`));
`,
};

export const PROJECT_TEMPLATES = [
  { id: 'next',    emoji: '▲',  label: 'Next.js',      blurb: 'App Router, API routes', tone: 'lilac', files: NEXT },
  { id: 'next-ts', emoji: 'TS', label: 'Next.js + TS', blurb: 'typed, with IntelliSense', tone: 'lemon', files: NEXT_TS },
  { id: 'react',   emoji: '⚛️', label: 'React + Vite', blurb: 'hot reload, JSX',        tone: 'sky',   files: REACT },
  { id: 'react-ts', emoji: 'TS', label: 'React + TS',  blurb: 'Vite, strict types',     tone: 'pink',  files: REACT_TS },
  { id: 'vue',     emoji: '💚', label: 'Vue + Vite',   blurb: 'single-file components', tone: 'mint',  files: VUE },
  { id: 'svelte',  emoji: '🔥', label: 'Svelte + Vite', blurb: 'runes, hot reload',     tone: 'peach', files: SVELTE },
  { id: 'astro',   emoji: '🚀', label: 'Astro',        blurb: 'content sites, routes',  tone: 'sky',   files: ASTRO },
  { id: 'sveltekit', emoji: '🧡', label: 'SvelteKit',  blurb: 'full-stack Svelte',       tone: 'peach', files: SVELTEKIT },
  { id: 'nuxt',    emoji: '💚', label: 'Nuxt',         blurb: 'full-stack Vue · big first install', tone: 'mint',  files: NUXT },
  { id: 'express', emoji: '🚂', label: 'Express API',  blurb: 'a real Node.js server',  tone: 'peach', files: EXPRESS },
];

/** Template files as `{ path, name, content }` records (the workspace file format). */
export function templateFiles(id) {
  const template = PROJECT_TEMPLATES.find(t => t.id === id);
  if (!template) return null;
  return Object.entries(template.files).map(([path, content]) => ({ path, name: path.split('/').pop(), content }));
}
