import { describe, it, expect } from 'vitest';
import { executeJs, formatValue } from './executeJs';
import { instrumentJS } from './instrument';
import { transpileTS } from './transpile';

async function run(code, opts = {}) {
  const logs = [];
  const steps = [];
  const result = await executeJs(code, {
    ...opts,
    onLog: (type, text) => logs.push({ type, text }),
    onSteps: batch => steps.push(...batch),
  });
  return { result, logs, steps };
}

describe('debug instrumentation (regressions from audit)', () => {
  it('handles multiple let/const declarations (TDZ)', async () => {
    const { result, steps, logs } = await run('const a = 1;\nconst b = 2;\nconsole.log(a + b);', { debug: true });
    expect(result.ok).toBe(true);
    expect(logs[0].text).toBe('3');
    expect(steps[0]).toMatchObject({ line: 1, state: { a: 1 } });
    expect(steps[0].state).not.toHaveProperty('b');
    expect(steps[1].state).toEqual({ a: 1, b: 2 });
  });

  it('handles multi-line object literals', async () => {
    const { result, steps } = await run('const o = {\n  a: 1,\n  b: [1, 2]\n};\nconsole.log(o.a);', { debug: true });
    expect(result.ok).toBe(true);
    expect(steps[0].state.o).toEqual({ a: 1, b: [1, 2] });
  });

  it('handles method chains starting with a dot', async () => {
    const { result, steps } = await run('const r = [1, 2, 3]\n  .map(x => x * 2)\n  .filter(Boolean);', { debug: true });
    expect(result.ok).toBe(true);
    expect(steps.at(-1).state.r).toEqual([2, 4, 6]);
  });

  it('records loop iterations and preserves line numbers', async () => {
    const code = 'let total = 0;\nfor (let i = 0; i < 3; i++) {\n  total += i;\n}\nconsole.log(total);';
    const { result, steps } = await run(code, { debug: true });
    expect(result.ok).toBe(true);
    expect(steps.filter(s => s.line === 3)).toHaveLength(3);
    expect(steps.at(-1).state.total).toBe(3);
    expect(instrumentJS(code).split('\n')).toHaveLength(code.split('\n').length);
  });

  it('tracks the call stack', async () => {
    const code = 'function outer() {\n  return inner();\n}\nconst inner = () => {\n  const x = 1;\n  return x;\n};\nouter();';
    const { result, steps } = await run(code, { debug: true });
    expect(result.ok).toBe(true);
    const deep = steps.find(s => s.line === 5);
    expect(deep.callStack.map(f => f.name)).toEqual(['outer', 'inner']);
    expect(steps.at(-1).callStack).toEqual([]);
  });

  it('captures function parameters', async () => {
    const { steps } = await run('function f(n, { k }) {\n  const d = n * 2;\n  return d + k;\n}\nf(2, { k: 1 });', { debug: true });
    expect(steps.find(s => s.line === 2).state).toMatchObject({ n: 2, k: 1, d: 4 });
  });

  it('stops runaway loops with a step limit', async () => {
    const { result } = await run('let i = 0;\nwhile (true) {\n  i++;\n}', { debug: true, maxSteps: 500 });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/exceeded 500 steps/);
  });

  it('handles classes, getters and derived constructors', async () => {
    const code = 'class A { constructor(x) { this.x = x; } get double() { return this.x * 2; } }\nclass B extends A { constructor() { super(3); } }\nconsole.log(new B().double);';
    const { result, logs } = await run(code, { debug: true });
    expect(result.ok).toBe(true);
    expect(logs[0].text).toBe('6');
  });

  it('runs the starter fibonacci program', async () => {
    const code = 'function fibonacci(n) {\n  if (n <= 1) return n;\n  return fibonacci(n - 1) + fibonacci(n - 2);\n}\nfor (let i = 0; i < 10; i++) {\n  console.log(`fib(${i}) = ${fibonacci(i)}`);\n}\nconst squares = Array.from({ length: 5 }, (_, i) => i ** 2);\nconsole.log(\'Squares:\', squares);';
    const { result, logs } = await run(code, { debug: true });
    expect(result.ok).toBe(true);
    expect(logs.at(-1).text).toBe('Squares: [0, 1, 4, 9, 16]');
  });
});

describe('normal execution', () => {
  it('supports top-level await and async output', async () => {
    const { result, logs } = await run('await new Promise(r => setTimeout(r, 5));\nconsole.log("after");');
    expect(result.ok).toBe(true);
    expect(logs[0].text).toBe('after');
  });

  it('reports syntax errors with a line number', async () => {
    const { result } = await run('const a = 1;\nconst = 2;');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/^SyntaxError/);
    expect(result.line).toBe(2);
  });

  it('explains unsupported module syntax', async () => {
    const { result } = await run('import x from "y";');
    expect(result.error).toMatch(/not supported/);
  });

  it('reports runtime errors', async () => {
    const { result } = await run('const a = 1;\nnull.foo;');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/TypeError/);
  });
});

describe('formatValue', () => {
  it('handles circular structures and collections', () => {
    const o = { a: 1 };
    o.self = o;
    expect(formatValue(o)).toBe('{a: 1, self: [Circular]}');
    expect(formatValue(new Map([['k', 1]]))).toBe('Map(1) {"k" => 1}');
    expect(formatValue(new Set([1, 2]))).toBe('Set(2) {1, 2}');
  });
});

describe('TypeScript', () => {
  it('transpiles while preserving line numbers', async () => {
    const ts = 'interface User {\n  id: number;\n}\nfunction greet(u: User): string {\n  return `#${u.id}`;\n}\nconsole.log(greet({ id: 7 }));';
    const js = transpileTS(ts);
    expect(js.split('\n')).toHaveLength(ts.split('\n').length);
    const { result, logs, steps } = await run(js, { debug: true });
    expect(result.ok).toBe(true);
    expect(logs[0].text).toBe('#7');
    expect(steps.some(s => s.line === 5)).toBe(true);
  });
});
