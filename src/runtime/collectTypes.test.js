import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { collectTypes, typesPackageFor } from './collectTypes.mjs';

let root;
const put = (path, content) => {
  const full = join(root, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, typeof content === 'string' ? content : JSON.stringify(content));
};

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'nexide-types-'));
  put('package.json', { dependencies: { react: '19', next: '15' }, devDependencies: { '@types/react': '19' } });
  // react: no own types → @types/react
  put('node_modules/react/package.json', { name: 'react', main: 'index.js' });
  put('node_modules/react/index.js', 'module.exports = {}');
  put('node_modules/@types/react/package.json', { name: '@types/react', types: 'index.d.ts', dependencies: { csstype: '3' } });
  put('node_modules/@types/react/index.d.ts', 'export function useState<T>(v: T): [T, (v: T) => void];');
  put('node_modules/csstype/package.json', { name: 'csstype', types: 'index.d.ts' });
  put('node_modules/csstype/index.d.ts', 'export interface Properties {}');
  // next: own types, nested dirs, skipped folders, huge non-declaration files
  put('node_modules/next/package.json', { name: 'next', types: 'index.d.ts', dependencies: { 'not-installed': '1' }, scripts: { x: 'y' } });
  put('node_modules/next/index.d.ts', 'export {}');
  put('node_modules/next/dist/server/web.d.ts', 'export {}');
  put('node_modules/next/dist/server/web.js', 'x'.repeat(10000));
  put('node_modules/next/node_modules/inner/index.d.ts', 'export {}');
  put('node_modules/next/test/fixture.d.ts', 'export {}');
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe('collectTypes', () => {
  it('maps packages to their @types companion', () => {
    expect(typesPackageFor('react')).toBe('@types/react');
    expect(typesPackageFor('@tanstack/query')).toBe('@types/tanstack__query');
    expect(typesPackageFor('@types/node')).toBeNull();
  });

  it('collects declarations and package metadata across the dependency graph', async () => {
    const { files, truncated } = await collectTypes(root);
    expect(truncated).toBe(false);
    expect(Object.keys(files).sort()).toEqual([
      'node_modules/@types/react/index.d.ts',
      'node_modules/@types/react/package.json',
      'node_modules/csstype/index.d.ts',
      'node_modules/csstype/package.json',
      'node_modules/next/dist/server/web.d.ts',
      'node_modules/next/index.d.ts',
      'node_modules/next/package.json',
      'node_modules/react/package.json',
    ]);
    // package.json is trimmed to what module resolution needs
    expect(JSON.parse(files['node_modules/next/package.json'])).toEqual({ name: 'next', types: 'index.d.ts' });
  });

  it('stops at the size budget and says so', async () => {
    const { files, truncated } = await collectTypes(root, { maxFiles: 3 });
    expect(Object.keys(files)).toHaveLength(3);
    expect(truncated).toBe(true);
  });

  it('returns nothing without a package.json', async () => {
    const empty = mkdtempSync(join(tmpdir(), 'nexide-empty-'));
    expect(await collectTypes(empty)).toEqual({ files: {}, truncated: false });
    rmSync(empty, { recursive: true, force: true });
  });
});

describe('collectTypes with a pnpm layout', () => {
  let pnpmRoot;
  // Directory links: junctions on Windows (no admin rights needed), symlinks elsewhere
  const link = (target, path) => {
    mkdirSync(dirname(join(pnpmRoot, path)), { recursive: true });
    symlinkSync(join(pnpmRoot, target), join(pnpmRoot, path), 'junction');
  };
  const putIn = (path, content) => {
    const full = join(pnpmRoot, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, typeof content === 'string' ? content : JSON.stringify(content));
  };

  beforeAll(() => {
    pnpmRoot = mkdtempSync(join(tmpdir(), 'nexide-pnpm-'));
    putIn('package.json', { devDependencies: { '@types/react': '19' } });
    // Real packages live under node_modules/.pnpm; only direct dependencies are linked at the top
    putIn('node_modules/.pnpm/@types+react@19/node_modules/@types/react/package.json', { name: '@types/react', types: 'index.d.ts', dependencies: { csstype: '3' } });
    putIn('node_modules/.pnpm/@types+react@19/node_modules/@types/react/index.d.ts', "import type * as CSS from 'csstype';");
    putIn('node_modules/.pnpm/csstype@3/node_modules/csstype/package.json', { name: 'csstype', types: 'index.d.ts' });
    putIn('node_modules/.pnpm/csstype@3/node_modules/csstype/index.d.ts', 'export interface Properties {}');
    link('node_modules/.pnpm/csstype@3/node_modules/csstype', 'node_modules/.pnpm/@types+react@19/node_modules/csstype');
    link('node_modules/.pnpm/@types+react@19/node_modules/@types/react', 'node_modules/@types/react');
  });
  afterAll(() => rmSync(pnpmRoot, { recursive: true, force: true }));

  it('finds indirect dependencies next to a package’s real location', async () => {
    const { files } = await collectTypes(pnpmRoot);
    expect(Object.keys(files).sort()).toEqual([
      'node_modules/@types/react/index.d.ts',
      'node_modules/@types/react/package.json',
      'node_modules/csstype/index.d.ts',
      'node_modules/csstype/package.json',
    ]);
  });
});
