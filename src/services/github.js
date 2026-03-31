// GitHub REST API — no OAuth needed for public repos
const GITHUB_API = 'https://api.github.com';

export function parseGitHubUrl(input) {
  // Handle: https://github.com/owner/repo, owner/repo, owner/repo/tree/branch
  input = input.trim();
  const urlMatch = input.match(/github\.com\/([^/]+)\/([^/]+?)(?:\/tree\/([^/]+))?(?:\/.*)?$/);
  if (urlMatch) return { owner: urlMatch[1], repo: urlMatch[2], branch: urlMatch[3] || 'main' };
  const shortMatch = input.match(/^([^/]+)\/([^/]+)$/);
  if (shortMatch) return { owner: shortMatch[1], repo: shortMatch[2], branch: 'main' };
  return null;
}

export async function fetchRepoInfo(owner, repo, token = null) {
  const headers = token ? { Authorization: `token ${token}` } : {};
  const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}`, { headers });
  if (!res.ok) throw new Error(`Repo not found: ${owner}/${repo} (${res.status})`);
  return res.json();
}

export async function fetchRepoTree(owner, repo, branch = 'main', token = null) {
  const headers = token ? { Authorization: `token ${token}` } : {};
  const res = await fetch(
    `${GITHUB_API}/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`,
    { headers }
  );
  if (!res.ok) {
    // Try 'master' if 'main' fails
    if (branch === 'main') return fetchRepoTree(owner, repo, 'master', token);
    throw new Error(`Could not fetch repo tree (${res.status})`);
  }
  const data = await res.json();
  return buildTreeFromFlat(data.tree || []);
}

export async function fetchFileContent(owner, repo, path, branch = 'main', token = null) {
  const headers = token ? { Authorization: `token ${token}` } : {};
  const res = await fetch(
    `${GITHUB_API}/repos/${owner}/${repo}/contents/${path}?ref=${branch}`,
    { headers }
  );
  if (!res.ok) throw new Error(`Cannot read file: ${path}`);
  const data = await res.json();
  if (data.encoding === 'base64') return atob(data.content.replace(/\n/g, ''));
  return data.content;
}

function buildTreeFromFlat(flatItems) {
  // Build directory tree from flat GitHub tree items
  const root = [];
  const dirMap = {};

  // Filter out hidden / too-deep items
  const items = flatItems.filter(item => {
    const parts = item.path.split('/');
    if (parts.some(p => p.startsWith('.') && p !== '.github')) return false;
    if (parts.includes('node_modules') || parts.includes('__pycache__')) return false;
    return true;
  });

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

    if (parentPath === '') {
      root.push(node);
    } else if (dirMap[parentPath]) {
      dirMap[parentPath].children.push(node);
    }
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
