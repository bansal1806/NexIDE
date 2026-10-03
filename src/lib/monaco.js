// Bundled (self-hosted) Monaco. Loading it from a CDN would give that CDN script access to
// the app's origin — including the signed-in session — so the editor ships with the app.
// Only imported from lazily loaded code (Editor, workspace models) to keep startup small.
import * as monaco from 'monaco-editor';
import { loader } from '@monaco-editor/react';
import EditorWorker from 'monaco-editor/editor/editor.worker?worker';
import JsonWorker from 'monaco-editor/language/json/json.worker?worker';
import CssWorker from 'monaco-editor/language/css/css.worker?worker';
import HtmlWorker from 'monaco-editor/language/html/html.worker?worker';
import TsWorker from 'monaco-editor/language/typescript/ts.worker?worker';

self.MonacoEnvironment = {
  getWorker(_workerId, label) {
    switch (label) {
      case 'json': return new JsonWorker();
      case 'css': case 'scss': case 'less': return new CssWorker();
      case 'html': case 'handlebars': case 'razor': return new HtmlWorker();
      case 'typescript': case 'javascript': return new TsWorker();
      default: return new EditorWorker();
    }
  },
};

// Make @monaco-editor/react use this instance instead of fetching one from jsDelivr
loader.config({ monaco });

// TypeScript / JavaScript language service: resolve modules like a bundler (package.json "exports",
// node_modules — filled in by a running project's installed types) and understand JSX.
// Not strict by default, so scratch files don't drown in errors; projects apply their tsconfig.
// Monaco 0.57 moved the TypeScript API from monaco.languages.typescript to monaco.typescript
export const tsApi = () => monaco.typescript ?? monaco.languages.typescript;

export const BASE_COMPILER_OPTIONS = {
  target: 99,               // ESNext
  module: 99,               // ESNext
  moduleResolution: 100,    // Bundler (TS 5)
  jsx: 4,                   // react-jsx
  allowJs: true,
  allowNonTsExtensions: true,
  allowSyntheticDefaultImports: true,
  esModuleInterop: true,
  resolveJsonModule: true,
  isolatedModules: true,
  skipLibCheck: true,
};
{
  const ts = tsApi();
  ts.typescriptDefaults.setCompilerOptions(BASE_COMPILER_OPTIONS);
  ts.javascriptDefaults.setCompilerOptions(BASE_COMPILER_OPTIONS);
}

// Handy in devtools; also used by the E2E suite to drive the editor
window.monaco = monaco;

export { monaco };
