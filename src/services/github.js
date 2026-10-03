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

/** Returns { tree, truncated } for the given branch/ref. */
export async function fetchRepoTree(owner, repo, branch, token = null) {
  const res = await fetch(
    `${GITHUB_API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/trees/${encodeURIComponent(branch)}?recursive=1`,
    { headers: headers(token) }
  );
  if (!res.ok) throw await ghError(res, `Branch "${branch}"`);
  const data = await res.json();
  return { tree: buildTreeFromFlat(data.tree || []), truncated: !!data.truncated };
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
