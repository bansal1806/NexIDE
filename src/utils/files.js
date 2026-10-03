// Language detection and file-tree helpers shared across the app.

const EXT_LANG = {
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  ts: 'typescript', tsx: 'typescript', mts: 'typescript', cts: 'typescript',
  py: 'python', html: 'html', htm: 'html', css: 'css', scss: 'css',
  json: 'json', md: 'markdown', txt: 'plaintext', sh: 'shell',
  yaml: 'yaml', yml: 'yaml', toml: 'plaintext',
  vue: 'html', svelte: 'html', astro: 'html', svg: 'xml', xml: 'xml', mdx: 'markdown',
  less: 'less', sass: 'scss', env: 'plaintext',
};

const BINARY_EXT = /\.(png|jpe?g|gif|webp|avif|ico|bmp|pdf|zip|gz|tgz|tar|7z|woff2?|ttf|otf|eot|mp[34]|wav|ogg|webm|mov|exe|dll|so|node|wasm|class|jar)$/i;

/** Files the editor can't show as text (images, archives, fonts, binaries). */
export function isBinaryName(name) {
  return BINARY_EXT.test(name || '');
}

export function getLang(filename) {
  if (!filename || !filename.includes('.')) return 'plaintext';
  const ext = filename.split('.').pop().toLowerCase();
  return EXT_LANG[ext] || 'plaintext';
}

export function findNodeByPath(nodes, targetPath) {
  for (const node of nodes || []) {
    if (node.path === targetPath) return node;
    if (node.children?.length) {
      const found = findNodeByPath(node.children, targetPath);
      if (found) return found;
    }
  }
  return null;
}

export function flattenFiles(nodes, acc = []) {
  for (const n of nodes || []) {
    if (n.kind === 'file') acc.push(n);
    if (n.children?.length) flattenFiles(n.children, acc);
  }
  return acc;
}

/** Validate a user-entered relative path like "src/app.js". Returns the normalized path or null. */
export function normalizeRelativePath(input) {
  const path = String(input || '').trim().replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\/|\/$/g, '');
  if (!path || path.length > 512) return null;
  const parts = path.split('/');
  const badPart = p => !p || p === '.' || p === '..' || /[<>:"|?*]/.test(p) || [...p].some(c => c.charCodeAt(0) < 32);
  if (parts.some(badPart)) return null;
  return path;
}

function sortTree(nodes) {
  nodes.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  nodes.forEach(n => n.children.length && sortTree(n.children));
  return nodes;
}

/**
 * A copy of `tree` with file changes applied: `[{ type: 'write' | 'delete', path, content? }]`.
 * Untouched nodes keep everything they carry (GitHub metadata, handles, not-yet-loaded content);
 * written files get `_content`, missing parent directories are created.
 */
export function withFileChanges(tree, changes) {
  const clone = (nodes) => nodes.map(n => ({ ...n, children: n.children?.length ? clone(n.children) : [] }));
  const root = clone(tree || []);
  const childrenOf = (dirPath, create) => {
    let children = root;
    let path = '';
    for (const name of dirPath ? dirPath.split('/') : []) {
      path = path ? `${path}/${name}` : name;
      let dir = children.find(n => n.name === name && n.kind === 'directory');
      if (!dir) {
        if (!create) return null;
        dir = { name, path, kind: 'directory', handle: null, children: [] };
        children.push(dir);
      }
      children = dir.children;
    }
    return children;
  };
  for (const change of changes) {
    const parts = change.path.split('/');
    const name = parts.pop();
    const siblings = childrenOf(parts.join('/'), change.type !== 'delete');
    if (!siblings) continue;
    const index = siblings.findIndex(n => n.name === name);
    if (change.type === 'delete') {
      if (index !== -1) siblings.splice(index, 1);
    } else if (index !== -1 && siblings[index].kind === 'file') {
      siblings[index] = { ...siblings[index], _content: change.content };
    } else if (index === -1) {
      siblings.push({ name, path: change.path, kind: 'file', handle: null, _content: change.content, children: [] });
    }
  }
  return sortTree(root);
}

/**
 * Build a nested tree from flat `{ path, content }` records (cloud project files).
 * File nodes carry `_content`; missing parent directories are created.
 */
export function buildTreeFromPaths(files) {
  const root = [];
  const dirs = new Map();

  const ensureDir = (dirPath) => {
    if (!dirPath) return root;
    if (dirs.has(dirPath)) return dirs.get(dirPath).children;
    const parts = dirPath.split('/');
    const parent = ensureDir(parts.slice(0, -1).join('/'));
    const node = { name: parts[parts.length - 1], path: dirPath, kind: 'directory', handle: null, children: [] };
    parent.push(node);
    dirs.set(dirPath, node);
    return node.children;
  };

  for (const f of files) {
    const parts = f.path.split('/');
    const parent = ensureDir(parts.slice(0, -1).join('/'));
    parent.push({
      name: parts[parts.length - 1],
      path: f.path,
      kind: 'file',
      handle: null,
      _content: f.content ?? '',
      children: [],
    });
  }
  return sortTree(root);
}
