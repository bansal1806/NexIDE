import { describe, it, expect, vi } from 'vitest';

vi.mock('../lib/supabase', () => ({ supabase: null }));

const { parseGitHubUrl, decodeBase64Utf8, buildTreeFromFlat } = await import('./github');
const { sanitizeForCloud, SECRET_KEYS } = await import('./settings');

describe('parseGitHubUrl', () => {
  it.each([
    ['facebook/react', { owner: 'facebook', repo: 'react', branch: null }],
    ['https://github.com/vercel/next.js', { owner: 'vercel', repo: 'next.js', branch: null }],
    ['https://github.com/a/b.git', { owner: 'a', repo: 'b', branch: null }],
    ['git@github.com:a/b.git', { owner: 'a', repo: 'b', branch: null }],
    ['https://github.com/a/b/tree/feature/x', { owner: 'a', repo: 'b', branch: 'feature/x' }],
    ['https://github.com/a/b/', { owner: 'a', repo: 'b', branch: null }],
  ])('%s', (input, expected) => {
    expect(parseGitHubUrl(input)).toEqual(expected);
  });

  it('rejects junk', () => {
    expect(parseGitHubUrl('not a repo')).toBeNull();
    expect(parseGitHubUrl('../../etc/passwd')).toBeNull();
  });
});

describe('decodeBase64Utf8', () => {
  it('decodes non-ASCII text correctly', () => {
    const text = 'héllo — 世界 ⚡';
    const b64 = Buffer.from(text, 'utf8').toString('base64').replace(/(.{10})/g, '$1\n');
    expect(decodeBase64Utf8(b64)).toBe(text);
  });
});

describe('buildTreeFromFlat', () => {
  it('nests children even if the API lists them before their parent', () => {
    const tree = buildTreeFromFlat([
      { path: 'src/a.js', type: 'blob' },
      { path: 'src', type: 'tree' },
      { path: 'README.md', type: 'blob' },
      { path: '.git/config', type: 'blob' },
      { path: 'node_modules/x', type: 'tree' },
    ]);
    expect(tree.map(n => n.path)).toEqual(['src', 'README.md']);
    expect(tree[0].children.map(n => n.path)).toEqual(['src/a.js']);
  });
});

describe('sanitizeForCloud', () => {
  it('never uploads secrets or unknown keys', () => {
    const clean = sanitizeForCloud({ geminiApiKey: 'AIza-secret', githubToken: 'ghp_x', fontSize: 14, theme: 'aurora', evil: 1, tabSize: 'bad' });
    SECRET_KEYS.forEach(k => expect(clean).not.toHaveProperty(k));
    expect(clean).toEqual({ fontSize: 14, theme: 'aurora' });
  });
});
