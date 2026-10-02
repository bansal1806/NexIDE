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

/**
 * @param {Record<string, string>} files  workspace path → source
 * @param {object} fakeConsole            console given to every module
 */
export function createModuleSystem(files, fakeConsole) {
  const cache = new Map(); // resolved path → module

  function makeRequire(fromPath) {
    return function require(spec) {
      const target = resolveSpecifier(spec, fromPath);
      if (target === null) {
        throw new Error(`Cannot import "${spec}": only relative imports of files in this workspace are supported (no npm packages).`);
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
