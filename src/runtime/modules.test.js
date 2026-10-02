import { describe, it, expect } from 'vitest';
import { executeJs } from './executeJs';
import { resolveSpecifier, usesModules } from './modules';

async function run(code, opts) {
  const logs = [];
  const steps = [];
  const result = await executeJs(code, { ...opts, onLog: (_t, text) => logs.push(text), onSteps: b => steps.push(...b) });
  return { result, logs, steps };
}

describe('resolveSpecifier', () => {
  it('resolves relative paths against the importer', () => {
    expect(resolveSpecifier('./math.js', 'src/app.js')).toBe('src/math.js');
    expect(resolveSpecifier('../lib/x', 'src/app.js')).toBe('lib/x');
    expect(resolveSpecifier('/root.js', 'src/deep/app.js')).toBe('root.js');
    expect(resolveSpecifier('lodash', 'src/app.js')).toBeNull();
  });
});

describe('usesModules', () => {
  it('detects import/export statements but not dynamic import or prose', () => {
    expect(usesModules("import { a } from './a.js';")).toBe(true);
    expect(usesModules('export const x = 1;')).toBe(true);
    expect(usesModules("const m = await import('./a.js');")).toBe(false);
    expect(usesModules('// we import things\nconsole.log(1)')).toBe(false);
  });
});

describe('multi-file execution', () => {
  const files = {
    'src/math.js': 'export const add = (a, b) => a + b;\nexport default function mul(a, b) { return a * b; }',
    'src/util/fmt.ts': 'export function fmt(n: number): string { return `#${n}`; }',
    'src/data.json': '{ "base": 40 }',
    'src/cycle-a.js': "import { b } from './cycle-b.js';\nexport const a = 'A';\nexport const fromB = () => b;",
    'src/cycle-b.js': "import { a } from './cycle-a.js';\nexport const b = 'B';\nexport const fromA = () => a;",
  };

  it('imports named, default, TS and JSON modules', async () => {
    const code = "import mul, { add } from './math.js';\nimport { fmt } from './util/fmt';\nimport data from './data.json';\nconsole.log(fmt(add(data.base, mul(1, 2))));";
    const { result, logs } = await run(code, { path: 'src/app.js', files });
    expect(result.ok).toBe(true);
    expect(logs).toEqual(['#42']);
  });

  it('handles circular imports', async () => {
    const code = "import { fromB, a } from './cycle-a.js';\nimport { fromA } from './cycle-b.js';\nconsole.log(a, fromB(), fromA());";
    const { result, logs } = await run(code, { path: 'src/app.js', files });
    expect(result.ok).toBe(true);
    expect(logs).toEqual(['A B A']);
  });

  it('explains bare (npm) imports and missing files', async () => {
    expect((await run("import _ from 'lodash';", { path: 'src/app.js', files })).result.error).toMatch(/only relative imports/);
    expect((await run("import x from './nope.js';", { path: 'src/app.js', files })).result.error).toMatch(/Cannot find module "\.\/nope\.js"/);
  });

  it('keeps line numbers for the debugger in module code', async () => {
    const code = "import { add } from './math.js';\nconst x = add(1, 2);\nconsole.log(x);";
    const { result, steps } = await run(code, { path: 'src/app.js', files, debug: true });
    expect(result.ok).toBe(true);
    expect(steps.find(s => s.line === 2)?.state.x).toBe(3);
  });

  it('reports module syntax errors with the right line', async () => {
    const { result } = await run("import { add } from './math.js';\nconst = 1;", { path: 'src/app.js', files });
    expect(result.error).toMatch(/SyntaxError/);
    expect(result.line).toBe(2);
  });

  it('plain scripts may still use the names require/module/exports', async () => {
    const { result, logs } = await run('const module = 1;\nconst require = 2;\nconsole.log(module + require);');
    expect(result.ok).toBe(true);
    expect(logs).toEqual(['3']);
  });
});
