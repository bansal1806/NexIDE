import { describe, it, expect, vi, afterEach } from 'vitest';
import { commitChanges, fetchRepoTree, StaleBranchError, publishRepository } from './github';

// A fake GitHub: records every request and answers from `routes` ("METHOD /path" → { status, json })
function fakeGitHub(routes) {
  const calls = [];
  const fetchMock = vi.fn(async (url, init = {}) => {
    const method = init.method || 'GET';
    const path = new URL(url).pathname.replace('/repos/me/app', '');
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ method, path, body, auth: init.headers?.Authorization });
    const route = routes[`${method} ${path}`];
    const { status = 200, json = {} } = typeof route === 'function' ? route(body) : (route || { status: 404 });
    return { ok: status < 400, status, json: async () => json, headers: new Headers() };
  });
  vi.stubGlobal('fetch', fetchMock);
  return calls;
}
afterEach(() => vi.unstubAllGlobals());

const base = { owner: 'me', repo: 'app', token: 'tok', branch: 'main', baseCommitSha: 'c0', message: 'Update app' };
const changes = [
  { path: 'src/a.js', status: 'modified', content: 'a2' },
  { path: 'bin/run.sh', status: 'modified', content: 'echo hi', mode: '100755' },
  { path: 'new.md', status: 'added', content: '# hi' },
  { path: 'old.js', status: 'deleted' },
];
let blob = 0;
const happy = (extra = {}) => ({
  'GET /git/commits/c0': { json: { tree: { sha: 't0' } } },
  'POST /git/blobs': () => ({ json: { sha: `b${++blob}` } }),
  'POST /git/trees': { json: { sha: 't1' } },
  'POST /git/commits': { json: { sha: 'c1' } },
  ...extra,
});

describe('commitChanges', () => {
  it('blobs → tree on the base tree → commit with the loaded parent → branch moved without force', async () => {
    const calls = fakeGitHub(happy({ 'PATCH /git/refs/heads/main': { json: {} } }));
    const result = await commitChanges({ ...base, changes });
    expect(result).toEqual({ commitSha: 'c1', branch: 'main', pullRequestUrl: null });

    expect(calls.filter(c => c.path === '/git/blobs').map(c => c.body)).toEqual(expect.arrayContaining([
      { content: 'a2', encoding: 'utf-8' }, { content: 'echo hi', encoding: 'utf-8' }, { content: '# hi', encoding: 'utf-8' },
    ]));
    const tree = calls.find(c => c.path === '/git/trees').body;
    expect(tree.base_tree).toBe('t0');
    expect(tree.tree).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'bin/run.sh', mode: '100755', type: 'blob' }),        // executable stays executable
      { path: 'old.js', mode: '100644', type: 'blob', sha: null },                         // deletion
    ]));
    expect(tree.tree).toHaveLength(4);
    expect(calls.find(c => c.method === 'POST' && c.path === '/git/commits').body).toEqual({ message: 'Update app', tree: 't1', parents: ['c0'] });
    expect(calls.find(c => c.method === 'PATCH').body).toEqual({ sha: 'c1', force: false });
    expect(calls.every(c => c.auth === 'Bearer tok')).toBe(true);
  });

  it('refuses to overwrite a branch that moved (no force push)', async () => {
    fakeGitHub(happy({ 'PATCH /git/refs/heads/main': { status: 422, json: { message: 'Update is not a fast forward' } } }));
    await expect(commitChanges({ ...base, changes })).rejects.toBeInstanceOf(StaleBranchError);
  });

  it('creates a new branch and opens a pull request into the original one', async () => {
    const calls = fakeGitHub(happy({
      'POST /git/refs': { status: 201, json: {} },
      'POST /pulls': { status: 201, json: { html_url: 'https://github.com/me/app/pull/7' } },
    }));
    const result = await commitChanges({ ...base, changes, newBranch: 'nexide/update', pullRequest: { title: 'Update app' } });
    expect(result).toEqual({ commitSha: 'c1', branch: 'nexide/update', pullRequestUrl: 'https://github.com/me/app/pull/7' });
    expect(calls.find(c => c.path === '/git/refs').body).toEqual({ ref: 'refs/heads/nexide/update', sha: 'c1' });
    expect(calls.find(c => c.path === '/pulls').body).toMatchObject({ head: 'nexide/update', base: 'main', title: 'Update app' });
    expect(calls.some(c => c.method === 'PATCH')).toBe(false); // the original branch is untouched
  });

  it('explains missing write access and taken branch names', async () => {
    fakeGitHub({ 'GET /git/commits/c0': { json: { tree: { sha: 't0' } } }, 'POST /git/blobs': { status: 403, json: {} } });
    await expect(commitChanges({ ...base, changes })).rejects.toThrow(/Contents: Read and write/);

    fakeGitHub(happy({ 'POST /git/refs': { status: 422, json: { message: 'Reference already exists' } } }));
    await expect(commitChanges({ ...base, changes, newBranch: 'taken' })).rejects.toThrow(/already exists/);
  });

  it('needs a token and something to commit', async () => {
    await expect(commitChanges({ ...base, token: '', changes })).rejects.toThrow(/Settings/);
    await expect(commitChanges({ ...base, changes: [] })).rejects.toThrow(/no changes/);
  });
});

describe('fetchRepoTree', () => {
  it('pins the tree to the branch’s current commit', async () => {
    const calls = fakeGitHub({
      'GET /commits/main': { json: { sha: 'c9', commit: { tree: { sha: 't9' } } } },
      'GET /git/trees/t9': { json: { tree: [{ path: 'a.js', type: 'blob', sha: 's1', mode: '100644', size: 3 }], truncated: false } },
    });
    const result = await fetchRepoTree('me', 'app', 'main');
    expect(result.commitSha).toBe('c9');
    expect(result.tree[0]).toMatchObject({ path: 'a.js', githubItem: expect.objectContaining({ sha: 's1' }) });
    expect(calls.map(c => `${c.method} ${c.path}`)).toEqual(['GET /commits/main', 'GET /git/trees/t9']);
  });
});

describe('publishRepository', () => {
  const files = [{ path: 'package.json', content: '{}' }, { path: 'src/index.js', content: 'export {}' }];

  it('creates the repo with a first commit, then commits the files on top of it', async () => {
    const calls = [];
    vi.stubGlobal('fetch', vi.fn(async (url, init = {}) => {
      const method = init.method || 'GET';
      const path = new URL(url).pathname;
      const body = init.body ? JSON.parse(init.body) : undefined;
      calls.push({ method, path, body });
      const reply = (json, status = 200) => ({ ok: status < 400, status, json: async () => json, headers: new Headers() });
      if (method === 'POST' && path === '/user/repos') return reply({ full_name: 'me/site', default_branch: 'main', html_url: 'https://github.com/me/site' }, 201);
      if (method === 'GET' && path === '/repos/me/site/commits/main') return reply({ sha: 'init', commit: { tree: { sha: 't-init' } } });
      if (method === 'GET' && path === '/repos/me/site/git/commits/init') return reply({ tree: { sha: 't-init' } });
      if (method === 'POST' && path === '/repos/me/site/git/blobs') return reply({ sha: 'b' }, 201);
      if (method === 'POST' && path === '/repos/me/site/git/trees') return reply({ sha: 't1' }, 201);
      if (method === 'POST' && path === '/repos/me/site/git/commits') return reply({ sha: 'c1' }, 201);
      if (method === 'PATCH' && path === '/repos/me/site/git/refs/heads/main') return reply({});
      return reply({}, 404);
    }));
    const result = await publishRepository({ token: 'tok', name: 'site', files });
    expect(result).toEqual({ owner: 'me', repo: 'site', branch: 'main', commitSha: 'c1', url: 'https://github.com/me/site' });
    expect(calls[0].body).toEqual({ name: 'site', description: '', private: true, auto_init: true });
    expect(calls.find(c => c.path.endsWith('/git/trees')).body).toMatchObject({ base_tree: 't-init' });
    expect(calls.find(c => c.method === 'POST' && c.path.endsWith('/git/commits')).body.parents).toEqual(['init']);
  });

  it('explains a taken name and a token that can’t create repositories', async () => {
    fakeGitHub({});
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 422, json: async () => ({}), headers: new Headers() })));
    await expect(publishRepository({ token: 'tok', name: 'site', files })).rejects.toThrow(/already have a repository/);
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 403, json: async () => ({}), headers: new Headers() })));
    await expect(publishRepository({ token: 'tok', name: 'site', files })).rejects.toThrow(/can’t create repositories/);
  });

  it('validates the name and needs a token', async () => {
    await expect(publishRepository({ token: 'tok', name: 'bad name!', files })).rejects.toThrow(/letters, numbers/);
    await expect(publishRepository({ token: '', name: 'site', files })).rejects.toThrow(/Settings/);
  });
});
