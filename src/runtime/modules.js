import { transform } from 'sucrase';

// Minimal module system for the JS runner: ES `import`/`export` between workspace files.
// Each file is converted to CommonJS by Sucrase (line numbers preserved, so stack traces
// and the debugger still match the editor) and loaded through a small require().

const IMPORT_EXPORT = /^\s*(?:import\s*(?:[\w$*{]|["'])|export\s)/m;
const RESOLVE_SUFFIXES = ['', '.js', '.mjs', '.cjs', '.ts', '.mts', '.json', '/index.js', '/index.ts'];

export const usesModules = (code) => IMPORT_EXPORT.test(code);

export function toCommonJS(code, path) {
  const transforms = ['imports'];
  if (/\.(ts|mts|cts)$/.test(path)) transforms.push('typescript');
  return transform(code, { transforms, disableESTransforms: true, filePath: path }).code;
}

/** Resolve "./x" / "../x" / "/x" against the importing file's path. Returns null for bare specifiers. */
export function resolveSpecifier(spec, fromPath) {
  if (!/^(\.{1,2}\/|\/)/.test(spec)) return null;
  const parts = spec.startsWith('/') ? [] : fromPath.split('/').slice(0, -1);
  for (const seg of spec.split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') parts.pop();
    else parts.push(seg);
  }
  return parts.join('/');
}

// ── npm packages (bare imports) ─────────────────────────────────────────────────────────
// Fetched as ES modules from esm.sh before the program runs (require() is synchronous).
// Only esm.sh is allowed by the runner worker's CSP.

export const PACKAGE_CDN = 'https://esm.sh/';
// name, @scope/name, optional @version, optional /subpath
const PACKAGE_SPEC = /^(?:@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*(?:@[\w.^~<>=*|-]+)?(?:\/[\w./-]+)?$/i;
const STATIC_IMPORT = /(?:^|[\s;])(?:import|export)\s[^'"`;]*?\bfrom\s*['"]([^'"]+)['"]|(?:^|[\s;])import\s*['"]([^'"]+)['"]/g;

export function isValidPackageSpec(spec) {
  return PACKAGE_SPEC.test(spec) && !spec.includes('..');
}

/** Bare specifiers imported by the entry file and the workspace files it (transitively) imports. */
export function collectBareImports(entryCode, entryPath, files) {
  const bare = new Set();
  const seen = new Set();
  const visit = (code, fromPath) => {
    for (const m of code.matchAll(STATIC_IMPORT)) {
      const spec = m[1] || m[2];
      const target = resolveSpecifier(spec, fromPath);
      if (target === null) { bare.add(spec); continue; }
      const found = RESOLVE_SUFFIXES.map(s => target + s).find(p => Object.prototype.hasOwnProperty.call(files, p));
      if (found && !seen.has(found) && !found.endsWith('.json')) {
        seen.add(found);
        visit(files[found], found);
      }
    }
  };
  visit(entryCode, entryPath);
  return [...bare];
}

/** ES module namespace → what Sucrase's CommonJS interop expects. */
export function packageExports(namespace) {
  return { __esModule: true, ...namespace };
}

/**
 * @param {Record<string, string>} files  workspace path → source
 * @param {object} fakeConsole            console given to every module
 * @param {Record<string, object>} [packages]  preloaded npm packages (spec → module namespace)
 */
export function createModuleSystem(files, fakeConsole, packages = {}) {
  const cache = new Map(); // resolved path → module

  function makeRequire(fromPath) {
    return function require(spec) {
      const target = resolveSpecifier(spec, fromPath);
      if (target === null) {
        if (Object.prototype.hasOwnProperty.call(packages, spec)) return packageExports(packages[spec]);
        throw new Error(`Cannot import "${spec}": the package was not loaded (only static imports are prefetched).`);
      }
      const found = RESOLVE_SUFFIXES.map(s => target + s).find(p => Object.prototype.hasOwnProperty.call(files, p));
      if (!found) throw new Error(`Cannot find module "${spec}" imported from ${fromPath}`);
      if (cache.has(found)) return cache.get(found).exports;

      const module = { exports: {} };
      cache.set(found, module); // before evaluating, so circular imports see partial exports
      try {
        if (found.endsWith('.json')) {
          module.exports = JSON.parse(files[found]);
        } else {
          const fn = new Function('require', 'module', 'exports', 'console', toCommonJS(files[found], found));
          fn(makeRequire(found), module, module.exports, fakeConsole);
        }
      } catch (err) {
        cache.delete(found);
        if (err instanceof Error && !err.message.includes(found)) err.message = `${err.message} (in ${found})`;
        throw err;
      }
      return module.exports;
    };
  }

  return {
    /** Scope for the entry file: { require, module, exports } */
    entry(path) {
      const module = { exports: {} };
      cache.set(path, module);
      return { require: makeRequire(path), module, exports: module.exports };
    },
  };
}
