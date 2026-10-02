import { describe, it, expect } from 'vitest';
import { buildTreeFromPaths, findNodeByPath, flattenFiles, getLang, normalizeRelativePath } from './files';

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
