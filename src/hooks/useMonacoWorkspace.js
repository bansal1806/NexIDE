import { useEffect, useRef, useState } from 'react';
import { getLang } from '../utils/files';

const uriFor = (monaco, path) => monaco.Uri.parse(`file:///${path}`);

/**
 * Keep a Monaco model for every workspace file so cross-file features work, and
 * report edits made to background models (e.g. multi-file rename) via onModelChanged.
 *
 * Only models that this hook created and that are no longer part of the workspace are
 * disposed — never the model the editor is currently showing.
 */
export function useMonacoWorkspace(files, onModelChanged) {
  // Load the (large, lazily bundled) editor only once there is a workspace to model
  const [monaco, setMonaco] = useState(null);
  const needMonaco = !monaco && files?.length > 0;
  useEffect(() => {
    if (!needMonaco) return;
    let cancelled = false;
    import('../lib/monaco').then(m => { if (!cancelled) setMonaco(m.monaco); });
    return () => { cancelled = true; };
  }, [needMonaco]);

  const ownedRef = useRef(new Map()); // uri string -> model

  useEffect(() => {
    if (!monaco || !files) return;
    const owned = ownedRef.current;
    const wanted = new Set();

    for (const file of files) {
      const uri = uriFor(monaco, file.path);
      const key = uri.toString();
      wanted.add(key);
      let model = monaco.editor.getModel(uri);
      if (!model) {
        model = monaco.editor.createModel(file.content ?? '', getLang(file.path), uri);
        owned.set(key, model);
      } else if (!model.isAttachedToEditor() && model.getValue() !== (file.content ?? '')) {
        // Stale model left over from a previous workspace with the same path
        model.setValue(file.content ?? '');
      }
    }

    for (const [key, model] of owned) {
      if (!wanted.has(key)) {
        if (!model.isDisposed() && !model.isAttachedToEditor()) model.dispose();
        owned.delete(key);
      }
    }
  }, [monaco, files]);

  // Dispose everything we created on unmount
  useEffect(() => () => {
    for (const model of ownedRef.current.values()) {
      if (!model.isDisposed()) model.dispose();
    }
    ownedRef.current.clear();
  }, []);

  const onChangedRef = useRef(onModelChanged);
  useEffect(() => { onChangedRef.current = onModelChanged; }, [onModelChanged]);

  // Report edits to models that are not attached to the visible editor
  useEffect(() => {
    if (!monaco) return;
    const disposables = [];
    const attach = (model) => {
      disposables.push(model.onDidChangeContent((e) => {
        if (e.isFlush || model.isAttachedToEditor()) return; // the editor's own onChange handles these
        onChangedRef.current?.(model.uri.path.substring(1), model.getValue());
      }));
    };
    monaco.editor.getModels().forEach(attach);
    disposables.push(monaco.editor.onDidCreateModel(attach));
    return () => disposables.forEach(d => d.dispose());
  }, [monaco]);
}
