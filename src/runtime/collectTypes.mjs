// Collects the TypeScript declarations of a project's installed packages, for editor IntelliSense.
// Runs with Node inside the project runtime (shipped to it as text, saved as .nexide-types.mjs):
// one local pass is far faster than reading thousands of files from the page one by one.
// Output: .nexide-types.json → { files: { "node_modules/<pkg>/…d.ts": "…" }, truncated }
import { readFile, readdir, writeFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

const DECLARATION = /\.d\.[mc]?ts$/;
const SKIP_DIRS = new Set(['node_modules', '.git', 'test', 'tests', '__tests__', 'docs', 'example', 'examples']);

/** `@scope/pkg` → `@types/scope__pkg`, `pkg` → `@types/pkg` */
export function typesPackageFor(name) {
  if (name.startsWith('@types/')) return null;
  return `@types/${name.startsWith('@') ? name.slice(1).replace('/', '__') : name}`;
}

/**
 * Breadth-first from the project's own dependencies, so the most relevant types fit the budget first.
 * For every installed package: its package.json (for "types" / "exports") and its declaration files,
 * plus its @types companion and its dependencies.
 */
export async function collectTypes(root, { maxBytes = 24 * 1024 * 1024, maxFiles = 8000, maxFileBytes = 2 * 1024 * 1024 } = {}) {
  const files = {};
  let bytes = 0;
  let count = 0;
  let truncated = false;

  const add = (path, content) => {
    if (content.length > maxFileBytes) return;
    if (bytes + content.length > maxBytes || count >= maxFiles) { truncated = true; return; }
    files[path] = content;
    bytes += content.length;
    count++;
  };

  const readJson = async (path) => {
    try { return JSON.parse(await readFile(path, 'utf8')); } catch { return null; }
  };

  const walk = async (dir, rel, depth) => {
    if (truncated || depth > 12) return;
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (truncated) return;
      const childRel = `${rel}/${entry.name}`;
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith('.')) await walk(join(dir, entry.name), childRel, depth + 1);
      } else if (DECLARATION.test(entry.name)) {
        try { add(childRel, await readFile(join(dir, entry.name), 'utf8')); } catch { /* unreadable */ }
      }
    }
  };

  const projectPkg = await readJson(join(root, 'package.json'));
  if (!projectPkg) return { files, truncated };
  const queue = Object.keys({ ...projectPkg.dependencies, ...projectPkg.devDependencies });
  const seen = new Set();

  while (queue.length && !truncated) {
    const name = queue.shift();
    if (seen.has(name)) continue;
    seen.add(name);
    const dir = join(root, 'node_modules', name);
    try { if (!(await stat(dir)).isDirectory()) continue; } catch { continue; }

    const pkgPath = `node_modules/${name}/package.json`;
    const pkg = await readJson(join(dir, 'package.json'));
    if (!pkg) continue;
    add(pkgPath, JSON.stringify({ name: pkg.name, version: pkg.version, types: pkg.types, typings: pkg.typings, main: pkg.main, module: pkg.module, exports: pkg.exports, typesVersions: pkg.typesVersions }));
    await walk(dir, `node_modules/${name}`, 0);

    const typesName = typesPackageFor(name);
    if (typesName) queue.push(typesName);
    queue.push(...Object.keys({ ...pkg.dependencies, ...pkg.peerDependencies }));
  }
  return { files, truncated };
}

if (process.argv[1]?.endsWith('.nexide-types.mjs')) {
  const result = await collectTypes(process.cwd());
  await writeFile('.nexide-types.json', JSON.stringify(result));
}
