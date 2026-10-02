import { describe, it, expect } from 'vitest';
import { executeJs } from './executeJs';
import { resolveSpecifier, usesModules, collectBareImports, isValidPackageSpec, resolvePackageId, loadPinnedPackage } from './modules';

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

  it('explains missing workspace files', async () => {
    expect((await run("import x from './nope.js';", { path: 'src/app.js', files })).result.error).toMatch(/Cannot find module "\.\/nope\.js"/);
  });

  it('keeps line numbers for the debugger in module code', async () => {
    const code = "import { add } from './math.js';\nconst x = add(1, 2);\nconsole.log(x);";
    const { result, steps } = await run(code, { path: 'src/app.js', files, debug: true });
    expect(result.ok).toBe(true);
    expect(steps.find(s => s.file === 'src/app.js' && s.line === 2)?.state.x).toBe(3);
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

describe('npm packages (bare imports)', () => {
  // Stand-in for import('https://esm.sh/…'): ES module namespaces
  const fakeRegistry = {
    'tiny-math': { default: (a) => a * 10, square: (x) => x * x },
    '@scope/greet@1.2.0': { greet: (n) => `hi ${n}` },
    'lodash/fp': { default: { identity: (x) => x } },
  };
  const loads = [];
  const loadPackage = async (spec, lockedId) => {
    loads.push(spec);
    if (!(spec in fakeRegistry)) throw new Error(`404 ${spec}`);
    return { id: lockedId || `${spec}@9.9.9`, namespace: fakeRegistry[spec], fromLock: !!lockedId };
  };

  it('collects bare imports transitively through workspace files', () => {
    const files = { 'lib/a.js': "import x from 'tiny-math';\nexport * from './b.js';", 'lib/b.js': "export { greet } from '@scope/greet@1.2.0';" };
    const bare = collectBareImports("import { y } from './lib/a.js';\nimport 'side-effect';\nconst s = 'import x from \"not-real\"';", 'main.js', files);
    expect(bare.sort()).toEqual(['@scope/greet@1.2.0', 'side-effect', 'tiny-math']);
  });

  it('validates package names', () => {
    expect(isValidPackageSpec('lodash')).toBe(true);
    expect(isValidPackageSpec('@scope/pkg@^1.2/sub/path')).toBe(true);
    expect(isValidPackageSpec('https://evil.example/x')).toBe(false);
    expect(isValidPackageSpec('../../etc')).toBe(false);
    expect(isValidPackageSpec('a b')).toBe(false);
  });

  it('supports default, named and subpath imports, also from workspace modules', async () => {
    loads.length = 0;
    const files = { 'util.js': "import { greet } from '@scope/greet@1.2.0';\nexport const hello = () => greet('ada');" };
    const code = "import times10, { square } from 'tiny-math';\nimport fp from 'lodash/fp';\nimport { hello } from './util.js';\nconsole.log(times10(square(2)), fp.identity('ok'), hello());";
    const { result, logs } = await run(code, { path: 'main.js', files, loadPackage });
    expect(result.ok).toBe(true);
    expect(logs.at(-1)).toBe('40 ok hi ada');
    expect(logs.filter(l => /📦 .* → .*pinned/.test(l))).toHaveLength(3);
    expect(loads.sort()).toEqual(['@scope/greet@1.2.0', 'lodash/fp', 'tiny-math']);
  });

  it('rejects invalid package names before fetching anything', async () => {
    loads.length = 0;
    const { result } = await run("import x from 'https://evil.example/x.js';", { loadPackage });
    expect(result.error).toMatch(/Invalid package name/);
    expect(loads).toHaveLength(0);
  });
});

describe('cross-file debugging', () => {
  it('records steps and stack frames with their file', async () => {
    const files = { 'lib/calc.js': 'export function triple(n) {\n  const t = n * 3;\n  return t;\n}' };
    const code = "import { triple } from './lib/calc.js';\nconst r = triple(4);\nconsole.log(r);";
    const { result, steps } = await run(code, { path: 'main.js', files, debug: true });
    expect(result.ok).toBe(true);
    const inLib = steps.find(s => s.file === 'lib/calc.js' && s.line === 2);
    expect(inLib?.state).toMatchObject({ n: 4, t: 12 });
    expect(inLib.callStack.at(-1)).toMatchObject({ name: 'triple', file: 'lib/calc.js' });
    expect(steps.find(s => s.file === 'main.js' && s.line === 2)?.state.r).toBe(12);
    // file order: entry → library → back to entry
    const files_ = steps.map(s => s.file);
    expect(files_.indexOf('lib/calc.js')).toBeGreaterThan(files_.indexOf('main.js'));
  });
});

describe('package pinning', () => {
  const esmResponse = (id) => ({
    ok: true,
    status: 200,
    text: async () => `/* esm.sh - ${id} */\nexport * from "/${id}/es2022/x.mjs";`,
  });

  it('resolves the exact version esm.sh served', async () => {
    expect(await resolvePackageId('lodash/fp', async () => esmResponse('lodash@4.18.1/fp'))).toBe('lodash@4.18.1/fp');
    await expect(resolvePackageId('nope-pkg', async () => ({ ok: false, status: 404 }))).rejects.toThrow(/not found/);
  });

  it('imports the locked version without resolving again', async () => {
    const fetchImpl = async () => { throw new Error('should not fetch'); };
    const imported = [];
    const importImpl = async (url) => { imported.push(url); return { default: 1 }; };
    const r = await loadPinnedPackage('dayjs', 'dayjs@1.11.23', { fetchImpl, importImpl });
    expect(r).toMatchObject({ id: 'dayjs@1.11.23', fromLock: true });
    expect(imported).toEqual(['https://esm.sh/dayjs@1.11.23']);
  });

  it('pins on first use and reports the pins from executeJs', async () => {
    const importImpl = async () => ({ default: (s) => s.toUpperCase() });
    const loadPackage = (spec, locked) => loadPinnedPackage(spec, locked, { fetchImpl: async () => esmResponse('shout@2.0.1'), importImpl });
    const first = await run("import shout from 'shout';\nconsole.log(shout('hi'));", { loadPackage });
    expect(first.result.pins).toEqual({ shout: 'shout@2.0.1' });
    expect(first.logs).toContain('HI');
    const second = await run("import shout from 'shout';\nconsole.log(shout('again'));", { loadPackage, packageLock: first.result.pins });
    expect(second.logs).toContain('📦 shout@2.0.1');
    expect(second.logs).toContain('AGAIN');
  });
});
