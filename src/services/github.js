// GitHub REST API — no OAuth needed for public repos
const GITHUB_API = 'https://api.github.com';

const NAME = /^[A-Za-z0-9_.-]+$/;

export function parseGitHubUrl(input) {
  // Handle: https://github.com/owner/repo(.git), owner/repo, owner/repo/tree/branch
  const text = String(input || '').trim().replace(/\/+$/, '');
  let owner, repo, branch = null;

  const urlMatch = text.match(/github\.com[/:]([^/]+)\/([^/#?]+)(?:\/tree\/([^#?]+))?/);
  const shortMatch = text.match(/^([^/\s]+)\/([^/\s]+)$/);
  if (urlMatch) [, owner, repo, branch] = urlMatch;
  else if (shortMatch) [, owner, repo] = shortMatch;
  else return null;

  repo = repo.replace(/\.git$/, '');
  if (!NAME.test(owner) || !NAME.test(repo)) return null;
  return { owner, repo, branch: branch ? decodeURIComponent(branch) : null };
}

function headers(token) {
  const h = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

const encodePath = (path) => path.split('/').map(encodeURIComponent).join('/');

async function ghError(res, what) {
  if (res.status === 403 || res.status === 429) {
    const reset = res.headers.get('x-ratelimit-reset');
    const when = reset ? ` (resets ${new Date(Number(reset) * 1000).toLocaleTimeString()})` : '';
    return new Error(`GitHub rate limit or permission error${when}. Add a token in Settings.`);
  }
  if (res.status === 404) return new Error(`${what} not found (private repos need a token)`);
  return new Error(`${what} failed (${res.status})`);
}

export async function fetchRepoInfo(owner, repo, token = null) {
  const res = await fetch(`${GITHUB_API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`, { headers: headers(token) });
  if (!res.ok) throw await ghError(res, `Repo ${owner}/${repo}`);
  return res.json();
}

const repoUrl = (owner, repo) => `${GITHUB_API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;

/**
 * Returns { tree, truncated, commitSha } for the given branch/ref. Pinned to one commit (ref →
 * commit → its tree), so what NexIDE shows and the parent of a later commit can't disagree.
 */
export async function fetchRepoTree(owner, repo, branch, token = null) {
  const commitRes = await fetch(`${repoUrl(owner, repo)}/commits/${encodePath(branch)}`, { headers: headers(token) });
  if (!commitRes.ok) throw await ghError(commitRes, `Branch "${branch}"`);
  const commit = await commitRes.json();
  const res = await fetch(`${repoUrl(owner, repo)}/git/trees/${commit.commit.tree.sha}?recursive=1`, { headers: headers(token) });
  if (!res.ok) throw await ghError(res, `Branch "${branch}"`);
  const data = await res.json();
  return { tree: buildTreeFromFlat(data.tree || []), truncated: !!data.truncated, commitSha: commit.sha };
}

/** A file's content at a given commit (diffs and "discard"): raw for public repos, the API with a token. */
export async function fetchFileAt(owner, repo, path, commitSha, token = null) {
  return token
    ? fetchFileContent(owner, repo, path, commitSha, token)
    : fetchRawFile(owner, repo, commitSha, path);
}

// ── Committing ─────────────────────────────────────────────────────

/** Thrown when the branch moved on GitHub since the repo was loaded (someone else pushed). */
export class StaleBranchError extends Error {
  constructor(branch) {
    super(`"${branch}" changed on GitHub since you opened it, so your commit wasn't added to it.`);
    this.name = 'StaleBranchError';
    this.branch = branch;
  }
}

async function writeError(res, what) {
  if (res.status === 401) return new Error('GitHub didn’t accept your token. Check it in Settings → GitHub.');
  if (res.status === 403 || res.status === 404) {
    return new Error(`Your GitHub token can’t write to this repository (${what}). It needs "Contents: Read and write"` +
      ' (and "Pull requests: Read and write" for pull requests) for this repo.');
  }
  let detail = '';
  try { detail = (await res.json()).message || ''; } catch { /* no body */ }
  return new Error(`${what} failed (${res.status}${detail ? `: ${detail}` : ''})`);
}

/**
 * Publish files as a new repository in the token owner's account. GitHub's Git Data API doesn't
 * work on an empty repository, so it's created with an initial README (auto_init) and the files
 * are committed on top of that (a README among the files replaces it).
 * files: [{ path, content }]. Resolves to { owner, repo, branch, commitSha, url }.
 */
export async function publishRepository({ token, name, description = '', isPrivate = true, files, message = 'Initial commit from NexIDE' }) {
  if (!token) throw new Error('Add a GitHub token in Settings → GitHub to publish.');
  if (!NAME.test(name)) throw new Error('Use letters, numbers, ".", "-" or "_" for the repository name.');
  if (!files.length) throw new Error('There are no files to publish.');
  const createRes = await fetch(`${GITHUB_API}/user/repos`, {
    method: 'POST',
    headers: { ...headers(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, description, private: isPrivate, auto_init: true }),
  });
  if (createRes.status === 422) throw new Error(`You already have a repository named "${name}". Pick another name.`);
  if (createRes.status === 401) throw new Error('GitHub didn’t accept your token. Check it in Settings → GitHub.');
  if (createRes.status === 403 || createRes.status === 404) {
    throw new Error('Your GitHub token can’t create repositories. Use a token with the "repo" scope (classic), or a' +
      ' fine-grained token for "All repositories" with "Administration" and "Contents" set to Read and write.');
  }
  if (!createRes.ok) throw await writeError(createRes, 'Creating the repository');
  const created = await createRes.json();
  const [owner, repo] = created.full_name.split('/');
  const branch = created.default_branch || 'main';

  // The initial commit (it can take a moment to appear right after creation)
  let base = null;
  for (let attempt = 0; attempt < 5 && !base; attempt++) {
    const res = await fetch(`${repoUrl(owner, repo)}/commits/${encodePath(branch)}`, { headers: headers(token) });
    if (res.ok) base = (await res.json()).sha;
    else await new Promise(r => setTimeout(r, 800 * (attempt + 1)));
  }
  if (!base) throw new Error(`Created ${created.full_name}, but couldn’t read its first commit. Open it from GitHub and commit again.`);

  const changes = files.map(f => ({ path: f.path, status: 'added', content: f.content }));
  const result = await commitChanges({ owner, repo, token, branch, baseCommitSha: base, changes, message });
  return { owner, repo, branch, commitSha: result.commitSha, url: created.html_url };
}

/**
 * Commit changes on top of `baseCommitSha` through the Git Data API (no git needed):
 * blobs → tree (base_tree) → commit → move `branch` (never forced), or create `newBranch` and
 * optionally open a pull request into `branch`.
 *
 * changes: [{ path, status: 'modified' | 'added' | 'deleted', content?, mode? }]
 * Resolves to { commitSha, branch, pullRequestUrl }.
 */
export async function commitChanges({ owner, repo, token, branch, baseCommitSha, changes, message, newBranch = null, pullRequest = null }) {
  if (!token) throw new Error('Add a GitHub token in Settings → GitHub to commit.');
  if (!changes.length) throw new Error('There are no changes to commit.');
  const url = repoUrl(owner, repo);
  const send = (method, path, body) => fetch(`${url}${path}`, {
    method,
    headers: { ...headers(token), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  // The tree the base commit points to
  const baseRes = await fetch(`${url}/git/commits/${baseCommitSha}`, { headers: headers(token) });
  if (!baseRes.ok) throw await writeError(baseRes, 'Reading the base commit');
  const baseTreeSha = (await baseRes.json()).tree.sha;

  // Contents of changed files, a few at a time
  const entries = [];
  const writes = changes.filter(c => c.status !== 'deleted');
  let next = 0;
  const upload = async () => {
    while (next < writes.length) {
      const change = writes[next++];
      const res = await send('POST', '/git/blobs', { content: change.content, encoding: 'utf-8' });
      if (!res.ok) throw await writeError(res, `Uploading ${change.path}`);
      entries.push({ path: change.path, mode: change.mode || '100644', type: 'blob', sha: (await res.json()).sha });
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, writes.length) }, upload));
  for (const change of changes.filter(c => c.status === 'deleted')) {
    entries.push({ path: change.path, mode: change.mode || '100644', type: 'blob', sha: null });
  }

  const treeRes = await send('POST', '/git/trees', { base_tree: baseTreeSha, tree: entries });
  if (!treeRes.ok) throw await writeError(treeRes, 'Creating the tree');
  const commitRes = await send('POST', '/git/commits', { message, tree: (await treeRes.json()).sha, parents: [baseCommitSha] });
  if (!commitRes.ok) throw await writeError(commitRes, 'Creating the commit');
  const commitSha = (await commitRes.json()).sha;

  if (!newBranch) {
    const refRes = await send('PATCH', `/git/refs/heads/${encodePath(branch)}`, { sha: commitSha, force: false });
    if (refRes.status === 422) throw new StaleBranchError(branch);
    if (!refRes.ok) throw await writeError(refRes, `Updating ${branch}`);
    return { commitSha, branch, pullRequestUrl: null };
  }

  const createRes = await send('POST', '/git/refs', { ref: `refs/heads/${newBranch}`, sha: commitSha });
  if (createRes.status === 422) throw new Error(`A branch named "${newBranch}" already exists. Pick another name.`);
  if (!createRes.ok) throw await writeError(createRes, `Creating branch ${newBranch}`);
  let pullRequestUrl = null;
  if (pullRequest) {
    const prRes = await send('POST', '/pulls', { title: pullRequest.title, body: pullRequest.body || '', head: newBranch, base: branch });
    if (!prRes.ok) throw await writeError(prRes, 'Opening the pull request');
    pullRequestUrl = (await prRes.json()).html_url;
  }
  return { commitSha, branch: newBranch, pullRequestUrl };
}

/** Decode base64 file content as UTF-8 (atob alone garbles non-ASCII text). */
export function decodeBase64Utf8(b64) {
  const binary = atob(b64.replace(/\s/g, ''));
  const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
  return new TextDecoder('utf-8').decode(bytes);
}

export async function fetchFileContent(owner, repo, path, branch, token = null) {
  const res = await fetch(
    `${GITHUB_API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodePath(path)}?ref=${encodeURIComponent(branch)}`,
    { headers: headers(token) }
  );
  if (!res.ok) throw await ghError(res, `File ${path}`);
  const data = await res.json();
  if (Array.isArray(data)) throw new Error(`${path} is a directory`);
  if (data.encoding === 'base64') return decodeBase64Utf8(data.content);
  if (data.encoding === 'none' || !data.content) throw new Error(`${path} is too large to open (over 1 MB)`);
  return data.content;
}

const RAW = 'https://raw.githubusercontent.com';

async function fetchRawFile(owner, repo, branch, path) {
  const res = await fetch(`${RAW}/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${encodePath(branch)}/${encodePath(path)}`);
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.text();
}

/**
 * Download many text files of a repo (running it as a project). Public repos use
 * raw.githubusercontent.com, which has no API rate limit; with a token, the authenticated contents
 * API (5,000 requests/hour, works for private repos). Resolves to `[{ path, content }]`.
 */
export async function fetchRepoFiles({ owner, repo, branch }, paths, token = null, { concurrency = 8, onProgress } = {}) {
  const results = [];
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < paths.length) {
      const path = paths[next++];
      const content = token
        ? await fetchFileContent(owner, repo, path, branch, token)
        : await fetchRawFile(owner, repo, branch, path);
      results.push({ path, content });
      onProgress?.(++done, paths.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, paths.length) }, worker));
  return results;
}

export function buildTreeFromFlat(flatItems) {
  // Build directory tree from flat GitHub tree items
  const root = [];
  const dirMap = {};

  // Filter out hidden / vendored items
  const items = flatItems.filter(item => {
    const parts = item.path.split('/');
    if (parts.some(p => p.startsWith('.') && p !== '.github')) return false;
    if (parts.includes('node_modules') || parts.includes('__pycache__')) return false;
    return item.type === 'tree' || item.type === 'blob';
  });

  // Parents before children, regardless of API ordering
  items.sort((a, b) => a.path.split('/').length - b.path.split('/').length);

  items.forEach(item => {
    const parts = item.path.split('/');
    const name  = parts[parts.length - 1];
    const parentPath = parts.slice(0, -1).join('/');

    const node = {
      name,
      path: item.path,
      kind: item.type === 'tree' ? 'directory' : 'file',
      handle: null, // GitHub nodes don't have FS handles
      githubItem: item,
      children: [],
    };

    if (item.type === 'tree') dirMap[item.path] = node;

    if (parentPath === '') root.push(node);
    else dirMap[parentPath]?.children.push(node);
  });

  // Sort: directories first
  const sortNodes = nodes => {
    nodes.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    nodes.forEach(n => n.children.length && sortNodes(n.children));
    return nodes;
  };

  return sortNodes(root);
}
