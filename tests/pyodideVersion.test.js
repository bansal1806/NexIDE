import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

describe('self-hosted Pyodide', () => {
  it('worker version matches the bundled pyodide package', () => {
    const pkg = JSON.parse(readFileSync(new URL('../node_modules/pyodide/package.json', import.meta.url), 'utf8'));
    const worker = readFileSync(new URL('../public/pyodide.worker.js', import.meta.url), 'utf8');
    const version = worker.match(/const PYODIDE_VERSION = '([^']+)'/)?.[1];
    expect(version).toBe(pkg.version);
  });

  it('pins the exact pyodide version (packages must match the core)', () => {
    const app = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    expect(app.devDependencies.pyodide).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
