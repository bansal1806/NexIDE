import { describe, it, expect, vi } from 'vitest';
import { toFileSystemTree, parsePackageJson, pickDevScript, minVersion, compatibilityWarnings, OutputLog, shouldSyncPath, normalizeWatchPath, removedPaths } from './project';

describe('toFileSystemTree', () => {
  it('nests files into directories', () => {
    const tree = toFileSystemTree([
      { path: 'package.json', content: '{}' },
      { path: 'src/App.jsx', content: 'app' },
      { path: 'src/lib/util.js', content: 'util' },
    ]);
    expect(tree['package.json']).toEqual({ file: { contents: '{}' } });
    expect(tree.src.directory['App.jsx']).toEqual({ file: { contents: 'app' } });
    expect(tree.src.directory.lib.directory['util.js']).toEqual({ file: { contents: 'util' } });
  });

  it('ignores empty paths and does not let a file be overwritten by a directory', () => {
    const tree = toFileSystemTree([{ path: '', content: 'x' }, { path: 'a', content: 'file' }, { path: 'a/b', content: 'nested' }]);
    expect(tree).toEqual({ a: { file: { contents: 'file' } } });
  });
});

describe('package.json helpers', () => {
  it('parses objects only', () => {
    expect(parsePackageJson('{"name":"x"}')).toEqual({ name: 'x' });
    expect(parsePackageJson('[]')).toBeNull();
    expect(parsePackageJson('nope')).toBeNull();
    expect(parsePackageJson(undefined)).toBeNull();
  });

  it('prefers dev, then start, then serve', () => {
    expect(pickDevScript({ scripts: { start: 's', dev: 'd' } })).toBe('dev');
    expect(pickDevScript({ scripts: { start: 's' } })).toBe('start');
    expect(pickDevScript({ scripts: { build: 'b' } })).toBeNull();
    expect(pickDevScript({})).toBeNull();
  });

  it('reads the lowest version of a range', () => {
    expect(minVersion('^15.5.0')).toEqual([15, 5]);
    expect(minVersion('15')).toEqual([15, 0]);
    expect(minVersion('latest')).toBeNull();
  });
});

describe('compatibilityWarnings', () => {
  it('warns about Next.js after 15.4 and Turbopack', () => {
    expect(compatibilityWarnings({ dependencies: { next: '15.4.11' }, scripts: { dev: 'next dev' } })).toEqual([]);
    expect(compatibilityWarnings({ dependencies: { next: '^15.5.0' } })[0]).toMatch(/15\.4/);
    expect(compatibilityWarnings({ dependencies: { next: '16.0.0' } })).toHaveLength(1);
    expect(compatibilityWarnings({ dependencies: { next: '14.2.0' }, scripts: { dev: 'next dev --turbo' } })[0]).toMatch(/Turbopack/);
  });
});

describe('runtime → workspace sync rules', () => {
  const binary = (name) => /\.(png|woff2)$/.test(name);

  it('syncs sources, not dependencies, build output, hidden or binary files', () => {
    expect(shouldSyncPath('src/components/Button.jsx', binary)).toBe(true);
    expect(shouldSyncPath('package-lock.json', binary)).toBe(true);
    expect(shouldSyncPath('node_modules/react/index.js', binary)).toBe(false);
    expect(shouldSyncPath('.next/cache/x.json', binary)).toBe(false);
    expect(shouldSyncPath('src/.DS_Store', binary)).toBe(false);
    expect(shouldSyncPath('dist/index.js', binary)).toBe(false);
    expect(shouldSyncPath('public/logo.png', binary)).toBe(false);
    expect(shouldSyncPath('', binary)).toBe(false);
  });

  it('normalises watcher filenames', () => {
    expect(normalizeWatchPath('./src/a.js')).toBe('src/a.js');
    expect(normalizeWatchPath('/src/a.js')).toBe('src/a.js');
    expect(normalizeWatchPath('src\\lib\\b.js')).toBe('src/lib/b.js');
    expect(normalizeWatchPath(new TextEncoder().encode('src/c.js'))).toBe('src/c.js');
  });

  it('expands a removed directory to the files under it', () => {
    const known = ['src/a.js', 'src/lib/b.js', 'src/libx.js', 'README.md'];
    expect(removedPaths('src/lib', known)).toEqual(['src/lib/b.js']);
    expect(removedPaths('README.md', known)).toEqual(['README.md']);
    expect(removedPaths('nope', known)).toEqual([]);
  });
});

describe('OutputLog', () => {
  it('keeps a bounded log and notifies subscribers', () => {
    const log = new OutputLog(5);
    const seen = vi.fn();
    const unsubscribe = log.subscribe(seen);
    log.append('abc');
    log.append('defg');
    expect(log.text).toBe('cdefg');
    expect(seen).toHaveBeenCalledWith('defg');
    log.clear();
    expect(log.text).toBe('');
    expect(seen).toHaveBeenLastCalledWith(null);
    unsubscribe();
    log.append('x');
    expect(seen).toHaveBeenCalledTimes(3);
  });
});
