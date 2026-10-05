import { describe, it, expect } from 'vitest';
import { dependencySignature, dependencyKey, planEviction } from './depsCache';

describe('dependency key', () => {
  it('depends only on what npm install uses, not on key order or other fields', async () => {
    const a = { name: 'a', scripts: { dev: 'vite' }, dependencies: { react: '19', vite: '6' } };
    const b = { name: 'b', version: '2.0.0', dependencies: { vite: '6', react: '19' } };
    expect(dependencySignature(a)).toBe(dependencySignature(b));
    expect(await dependencyKey(a)).toBe(await dependencyKey(b));
    expect(await dependencyKey(a)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('changes when dependencies, overrides or the lockfile change', () => {
    const base = { dependencies: { react: '19' } };
    const sig = dependencySignature(base);
    expect(dependencySignature({ dependencies: { react: '18' } })).not.toBe(sig);
    expect(dependencySignature({ ...base, devDependencies: { vite: '6' } })).not.toBe(sig);
    expect(dependencySignature({ ...base, overrides: { lodash: '4' } })).not.toBe(sig);
    expect(dependencySignature(base, '{"lockfileVersion":3}')).not.toBe(sig);
  });

  it('separates package managers, keeping npm keys as before', () => {
    const base = { dependencies: { react: '19' } };
    expect(dependencySignature(base, null, 'npm')).toBe(dependencySignature(base));
    expect(dependencySignature(base, null, 'pnpm')).not.toBe(dependencySignature(base, null, 'npm'));
    expect(dependencySignature(base, null, 'yarn')).not.toBe(dependencySignature(base, null, 'pnpm'));
  });
});

describe('planEviction', () => {
  const MB = 1024 * 1024;
  const entry = (key, size, usedAt) => ({ key, size: size * MB, usedAt });

  it('keeps everything within the limits', () => {
    expect(planEviction([entry('a', 10, 1)], entry('b', 10, 2))).toEqual([]);
  });

  it('evicts the least recently used beyond the entry limit', () => {
    const existing = [entry('new', 10, 30), entry('old', 10, 10), entry('mid', 10, 20)];
    expect(planEviction(existing, entry('in', 10, 40), { maxEntries: 3 })).toEqual(['old']);
  });

  it('evicts until the total size fits', () => {
    const existing = [entry('a', 300, 1), entry('b', 200, 2), entry('c', 50, 3)];
    expect(planEviction(existing, entry('in', 300, 4), { maxBytes: 600 * MB, maxEntries: 10 })).toEqual(['a']);
    expect(planEviction(existing, entry('in', 500, 4), { maxBytes: 600 * MB, maxEntries: 10 })).toEqual(['a', 'b']);
  });

  it('replacing an existing key does not evict it', () => {
    expect(planEviction([entry('same', 100, 1)], entry('same', 120, 2), { maxEntries: 1 })).toEqual([]);
  });
});
