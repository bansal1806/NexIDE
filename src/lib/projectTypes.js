// Feeds a running project's installed type declarations (and its tsconfig) to Monaco's
// TypeScript service, so imports like `react` or `next/link` get completions, hovers and checks.

const COPIED_OPTIONS = ['strict', 'noImplicitAny', 'strictNullChecks', 'paths', 'jsx', 'jsxImportSource', 'experimentalDecorators'];
const JSX = { preserve: 1, react: 2, 'react-native': 3, 'react-jsx': 4, 'react-jsxdev': 5 };

/**
 * The tsconfig/jsconfig options that matter to the editor. Path aliases ("@/*") resolve from the
 * project root. `text` may contain comments and trailing commas (JSONC, as tsconfig allows).
 */
export function editorOptionsFromTsconfig(text) {
  if (typeof text !== 'string') return {};
  let config;
  try {
    // Strip comments outside strings, then trailing commas
    const json = text
      .replace(/("(?:[^"\\]|\\.)*")|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, (m, str) => str ?? '')
      .replace(/,(\s*[}\]])/g, '$1');
    config = JSON.parse(json);
  } catch {
    return {};
  }
  const source = config?.compilerOptions || {};
  const options = {};
  for (const key of COPIED_OPTIONS) {
    if (source[key] !== undefined) options[key] = source[key];
  }
  if (typeof options.jsx === 'string') {
    const kind = JSX[options.jsx.toLowerCase()];
    if (kind) options.jsx = kind; else delete options.jsx;
  }
  if (options.paths) options.baseUrl = 'file:///';
  return options;
}

/**
 * Apply a project's types: `files` maps "node_modules/…" paths to declaration text.
 * Call with no files to clear (workspace switched).
 */
export async function setProjectTypes(files = {}, tsconfigText) {
  const { tsApi, BASE_COMPILER_OPTIONS } = await import('./monaco');
  const ts = tsApi();
  const libs = Object.entries(files).map(([path, content]) => ({ content, filePath: `file:///${path}` }));
  const options = { ...BASE_COMPILER_OPTIONS, ...editorOptionsFromTsconfig(tsconfigText) };
  for (const defaults of [ts.typescriptDefaults, ts.javascriptDefaults]) {
    defaults.setExtraLibs(libs);
    defaults.setCompilerOptions(options);
  }
  return libs.length;
}
