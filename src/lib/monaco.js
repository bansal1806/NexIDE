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

// Handy in devtools; also used by the E2E suite to drive the editor
window.monaco = monaco;

export { monaco };
