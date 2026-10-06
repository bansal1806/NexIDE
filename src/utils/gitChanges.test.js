import { describe, it, expect } from 'vitest';
import { gitBlobSha, baselineFromTree, computeGitChanges, repoNameFrom } from './gitChanges';
import { withFileChanges } from './files';

describe('gitBlobSha', () => {
  // Reference values from `git hash-object --stdin`
  it('matches git for plain, empty and non-ASCII text', async () => {
    expect(await gitBlobSha('hello\n')).toBe('ce013625030ba8dba906f756967f9e9ca394464a');
    expect(await gitBlobSha('')).toBe('e69de29bb2d1d6434b8b29ae775ad8c2e48c5391');
    expect(await gitBlobSha('héllo — ünïcode ✨\n')).toBe('1f48766b7165d318b80ac7fb4c1ee7b4ace3df2c');
  });
});

describe('computeGitChanges', () => {
  const HELLO = 'ce013625030ba8dba906f756967f9e9ca394464a'; // "hello\n"
  const file = (path, sha, content) => ({
    name: path.split('/').pop(), path, kind: 'file', handle: null, githubItem: { path, sha, size: 6 }, children: [],
    ...(content !== undefined ? { _content: content } : {}),
  });
  const tree = () => [
    { name: 'src', path: 'src', kind: 'directory', handle: null, children: [file('src/a.js', HELLO, 'hello\n'), file('src/b.js', HELLO)] },
    file('README.md', HELLO, 'hello\n'),
  ];

  it('finds nothing in a freshly loaded (or merely downloaded) repo', async () => {
    const t = tree();
    expect(await computeGitChanges(t, baselineFromTree(t))).toEqual([]);
  });

  it('reports modified, added and deleted files, sorted', async () => {
    const original = tree();
    const baseline = baselineFromTree(original);
    const edited = withFileChanges(original, [
      { type: 'write', path: 'src/a.js', content: 'hello world\n' },
      { type: 'write', path: 'src/new.js', content: 'export {}\n' },
      { type: 'delete', path: 'README.md' },
    ]);
    expect(await computeGitChanges(edited, baseline)).toEqual([
      { path: 'README.md', status: 'deleted' },
      { path: 'src/a.js', status: 'modified', content: 'hello world\n' },
      { path: 'src/new.js', status: 'added', content: 'export {}\n' },
    ]);
  });

  it('a change undone by hand is no change', async () => {
    const original = tree();
    const baseline = baselineFromTree(original);
    const back = withFileChanges(original, [{ type: 'write', path: 'src/a.js', content: 'hello\n' }]);
    expect(await computeGitChanges(back, baseline)).toEqual([]);
  });
});

describe('repoNameFrom', () => {
  it('turns a project name into a valid repository name', () => {
    expect(repoNameFrom('My Cool App!')).toBe('my-cool-app');
    expect(repoNameFrom('React + Vite')).toBe('react-vite');
    expect(repoNameFrom('...')).toBe('nexide-project');
    expect(repoNameFrom(undefined)).toBe('nexide-project');
  });
});
