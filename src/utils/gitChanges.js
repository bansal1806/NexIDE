// What changed in a GitHub workspace since it was loaded, the way Git sees it: a file is modified
// when its blob SHA differs from the one GitHub reported, added when the repo didn't have it, deleted
// when an original file is gone. Opening, running or downloading files never counts as a change.
import { flattenFiles } from './files';

/** Git's blob id for text: SHA-1 of "blob <byte length>\0<UTF-8 bytes>". */
export async function gitBlobSha(text) {
  const body = new TextEncoder().encode(text);
  const header = new TextEncoder().encode(`blob ${body.length}\0`);
  const bytes = new Uint8Array(header.length + body.length);
  bytes.set(header);
  bytes.set(body, header.length);
  const digest = await crypto.subtle.digest('SHA-1', bytes);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/** path → blob SHA for every file of a freshly loaded GitHub tree (its baseline). */
export function baselineFromTree(tree) {
  const baseline = new Map();
  for (const node of flattenFiles(tree)) {
    if (node.githubItem?.sha) baseline.set(node.path, node.githubItem.sha);
  }
  return baseline;
}

/**
 * `[{ path, status: 'modified' | 'added' | 'deleted', content? }]`, sorted by path.
 * Only files whose content is loaded can differ from the baseline (the rest are untouched).
 */
export async function computeGitChanges(tree, baseline) {
  const changes = [];
  const present = new Set();
  for (const node of flattenFiles(tree)) {
    present.add(node.path);
    if (typeof node._content !== 'string') continue;
    const original = baseline.get(node.path);
    if (!original) changes.push({ path: node.path, status: 'added', content: node._content });
    else if (await gitBlobSha(node._content) !== original) changes.push({ path: node.path, status: 'modified', content: node._content });
  }
  for (const path of baseline.keys()) {
    if (!present.has(path)) changes.push({ path, status: 'deleted' });
  }
  return changes.sort((a, b) => a.path.localeCompare(b.path));
}
