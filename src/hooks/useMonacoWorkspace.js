import { useEffect } from 'react';
import { useMonaco } from '@monaco-editor/react';

export function useMonacoWorkspace(files, onModelChanged) {
  const monaco = useMonaco();

  // Sync files to Monaco models
  useEffect(() => {
    if (!monaco || !files) return;

    const currentModels = [];

    files.forEach(file => {
      const uri = monaco.Uri.parse(`file:///${file.path}`);
      let model = monaco.editor.getModel(uri);

      if (!model) {
        // Find language from extension
        const ext = file.path.split('.').pop();
        let lang = 'javascript';
        if (ext === 'ts' || ext === 'tsx') lang = 'typescript';
        else if (ext === 'json') lang = 'json';
        else if (ext === 'html') lang = 'html';
        else if (ext === 'css') lang = 'css';
        else if (ext === 'md') lang = 'markdown';
        else if (ext === 'py') lang = 'python';

        model = monaco.editor.createModel(file.content, lang, uri);
      } else if (model.getValue() !== file.content) {
        // If the model exists but content differs (from an external reload), update it
        // Only do this if it's an initial sync, else let the editor manage it
        // To be safe, we only set it if someone called sync again
        model.setValue(file.content);
      }
      
      currentModels.push(model);
    });

    // Cleanup models when workspace changes
    return () => {
      currentModels.forEach(model => model.dispose());
    };
  }, [monaco, files]);

  // Listen for background edits (multi-file renames)
  useEffect(() => {
    if (!monaco) return;

    const disposables = [];

    // The event fires when a model's content changes
    const attachListener = (model) => {
      disposables.push(
        model.onDidChangeContent((e) => {
          // Detect bulk edits or renames
          // e.isFlush is true if it was a setValue (which we ignore here)
          if (!e.isFlush && onModelChanged) {
            onModelChanged(model.uri.path.substring(1), model.getValue());
          }
        })
      );
    };

    // Attach to existing models
    monaco.editor.getModels().forEach(attachListener);

    // Attach to future models
    disposables.push(
      monaco.editor.onDidCreateModel(attachListener)
    );

    return () => {
      disposables.forEach(d => d.dispose());
    };
  }, [monaco, onModelChanged]);
}
