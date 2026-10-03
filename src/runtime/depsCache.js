// Installed dependencies (node_modules snapshots) kept between visits, so a project restarts in
// seconds instead of reinstalling. Stored in IndexedDB, keyed by the project's dependency set.

const DB_NAME = 'nexide-deps';
const STORE = 'snapshots';
export const MAX_ENTRIES = 3;
export const MAX_BYTES = 600 * 1024 * 1024;

const DEPENDENCY_FIELDS = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies', 'overrides', 'resolutions'];

/** Stable text of everything that decides what `npm install` produces (key order doesn't matter). */
export function dependencySignature(pkg, lockfileText = null) {
  const sorted = (obj) => (obj && typeof obj === 'object' && !Array.isArray(obj)
    ? Object.fromEntries(Object.keys(obj).sort().map(k => [k, sorted(obj[k])]))
    : obj);
  const picked = {};
  for (const field of DEPENDENCY_FIELDS) if (pkg?.[field]) picked[field] = sorted(pkg[field]);
  return JSON.stringify({ deps: picked, lock: lockfileText || null });
}

export async function dependencyKey(pkg, lockfileText) {
  const bytes = new TextEncoder().encode(dependencySignature(pkg, lockfileText));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/** Keys to delete so that, with `incoming` added, the cache stays within its limits (oldest first). */
export function planEviction(entries, incoming, { maxEntries = MAX_ENTRIES, maxBytes = MAX_BYTES } = {}) {
  const others = entries.filter(e => e.key !== incoming.key).sort((a, b) => a.usedAt - b.usedAt);
  const evict = [];
  let count = others.length + 1;
  let bytes = others.reduce((sum, e) => sum + e.size, 0) + incoming.size;
  for (const entry of others) {
    if (count <= maxEntries && bytes <= maxBytes) break;
    evict.push(entry.key);
    count--;
    bytes -= entry.size;
  }
  return evict;
}

// ── IndexedDB ───────────────────────────────────────────────────────
function open() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'key' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore(mode, fn) {
  const db = await open();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const result = fn(tx.objectStore(STORE));
      // A request's result (undefined when a key is missing), else whatever fn returned
      tx.oncomplete = () => resolve(result instanceof IDBRequest ? result.result : result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

/** Metadata of every snapshot: `[{ key, size, usedAt, label }]` (without the data). */
export async function listSnapshots() {
  const all = await withStore('readonly', store => store.getAll());
  return (all || []).map(({ key, size, usedAt, label }) => ({ key, size, usedAt, label }));
}

/** `{ snapshot: Uint8Array, lockfile }` or null. Marks the entry as recently used. */
export async function loadSnapshot(key) {
  const entry = await withStore('readonly', store => store.get(key));
  if (!entry) return null;
  withStore('readwrite', store => store.put({ ...entry, usedAt: Date.now() })).catch(() => {});
  return { snapshot: new Uint8Array(entry.snapshot), lockfile: entry.lockfile ?? null };
}

export async function saveSnapshot(key, snapshot, { lockfile = null, label = '' } = {}) {
  const incoming = { key, size: snapshot.byteLength, usedAt: Date.now(), label };
  const evict = planEviction(await listSnapshots(), incoming);
  await withStore('readwrite', store => {
    evict.forEach(k => store.delete(k));
    store.put({ ...incoming, snapshot, lockfile });
  });
}

export async function clearSnapshots() {
  await withStore('readwrite', store => store.clear());
}
