import { describe, it, expect } from 'vitest';
import { buildTreeFromPaths, findNodeByPath, flattenFiles, getLang, normalizeRelativePath, withFileChanges, isBinaryName } from './files';

describe('getLang', () => {
  it('maps extensions', () => {
    expect(getLang('a.tsx')).toBe('typescript');
    expect(getLang('main.PY')).toBe('python');
    expect(getLang('Makefile')).toBe('plaintext');
  });
});

describe('buildTreeFromPaths', () => {
  it('builds nested directories for cloud files', () => {
    const tree = buildTreeFromPaths([
      { path: 'src/utils/x.js', content: 'x' },
      { path: 'index.html', content: '<p>' },
      { path: 'src/app.js', content: 'a' },
    ]);
    expect(tree.map(n => n.name)).toEqual(['src', 'index.html']);
    expect(findNodeByPath(tree, 'src/utils/x.js')._content).toBe('x');
    expect(flattenFiles(tree).map(f => f.path).sort()).toEqual(['index.html', 'src/app.js', 'src/utils/x.js']);
  });
});

describe('normalizeRelativePath', () => {
  it('accepts normal paths and rejects traversal', () => {
    expect(normalizeRelativePath(' /src\\app.js ')).toBe('src/app.js');
    expect(normalizeRelativePath('../secret')).toBeNull();
    expect(normalizeRelativePath('a/./b')).toBeNull();
    expect(normalizeRelativePath('')).toBeNull();
    expect(normalizeRelativePath('bad\u0001name')).toBeNull();
  });
});

const gh = (path, kind = 'file', children = []) => ({
  name: path.split('/').pop(), path, kind, handle: null, githubItem: { path, size: 10 }, children,
});

describe('withFileChanges', () => {
  const tree = [
    gh('src', 'directory', [gh('src/App.jsx'), gh('src/util.js')]),
    gh('package.json'),
  ];

  it('adds, updates and removes files without touching the rest', () => {
    const next = withFileChanges(tree, [
      { type: 'write', path: 'src/lib/answer.js', content: 'export const a = 42;' },
      { type: 'write', path: 'src/App.jsx', content: 'changed' },
      { type: 'delete', path: 'src/util.js' },
    ]);
    const files = Object.fromEntries(flattenFiles(next).map(n => [n.path, n]));
    expect(Object.keys(files).sort()).toEqual(['package.json', 'src/App.jsx', 'src/lib/answer.js']);
    expect(files['src/App.jsx']._content).toBe('changed');
    expect(files['src/App.jsx'].githubItem).toEqual({ path: 'src/App.jsx', size: 10 });
    expect(files['package.json']._content).toBeUndefined(); // still not loaded
    expect(files['src/lib/answer.js']._content).toBe('export const a = 42;');
    // directories first, then files
    expect(next.find(n => n.name === 'src').children.map(n => n.name)).toEqual(['lib', 'App.jsx']);
  });

  it('does not mutate the original tree', () => {
    withFileChanges(tree, [{ type: 'delete', path: 'src/App.jsx' }, { type: 'write', path: 'package.json', content: '{}' }]);
    expect(tree[0].children.map(n => n.name)).toEqual(['App.jsx', 'util.js']);
    expect(tree[1]._content).toBeUndefined();
  });

  it('ignores deletes of unknown paths', () => {
    expect(flattenFiles(withFileChanges(tree, [{ type: 'delete', path: 'nope/x.js' }]))).toHaveLength(3);
  });
});

describe('file helpers', () => {
  it('detects binary names and languages', () => {
    expect(isBinaryName('logo.png')).toBe(true);
    expect(isBinaryName('also')).toBe(false);
    expect(isBinaryName('App.vue')).toBe(false);
    expect(getLang('App.vue')).toBe('html');
    expect(getLang('page.tsx')).toBe('typescript');
  });
});
