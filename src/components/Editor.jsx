import '../lib/monaco'; // must run before <MonacoEditor> mounts (configures the loader)
import MonacoEditor from '@monaco-editor/react';
import { useRef, useEffect } from 'react';
import { STARTERS } from './starters';


// Monaco theme per app theme (backgrounds match the CSS variables in index.css)
const MONACO_THEMES = {
  'nexide-dark': 'nexide-dark',
  'vs-dark': 'vs-dark',
  aurora: 'nexide-aurora',
  crimson: 'nexide-crimson',
};

// Playground syntax colours — all ≥ 4.5:1 on every theme's editor background
const BASE_RULES = [
  { token: 'comment',    foreground: 'ada3c9', fontStyle: 'italic' },
  { token: 'keyword',    foreground: 'ff9ad1', fontStyle: 'bold' },
  { token: 'string',     foreground: '7df2c6' },
  { token: 'number',     foreground: 'ffb98f' },
  { token: 'regexp',     foreground: 'ffb98f' },
  { token: 'delimiter',  foreground: 'cfc6e6' },
  { token: 'variable',   foreground: '8fd8ff' },
  { token: 'type',       foreground: 'ffe27a' },
  { token: 'function',   foreground: '8fd8ff' },
  { token: 'identifier', foreground: 'f7f3ff' },
];

function themeColors({ bg, line, border, accent, fg, gutter }) {
  return {
    'editor.background':           bg,
    'editor.foreground':           fg,
    'editorLineNumber.foreground': gutter,
    'editorLineNumber.activeForeground': fg,
    'editor.selectionBackground':  `${accent}40`,
    'editor.inactiveSelectionBackground': `${accent}26`,
    'editor.lineHighlightBackground': line,
    'editor.lineHighlightBorder':  line,
    'editorCursor.foreground':     accent,
    'editor.findMatchBackground':  `${accent}4d`,
    'editorWidget.background':     line,
    'editorWidget.border':         border,
    'editorSuggestWidget.background': line,
    'editorSuggestWidget.border':  border,
    'editorSuggestWidget.selectedBackground': `${accent}33`,
    'input.background':            line,
    'input.border':                border,
    'focusBorder':                 accent,
    'scrollbarSlider.background':  `${border}88`,
    'scrollbarSlider.hoverBackground': `${border}cc`,
    'editorGutter.background':     bg,
    'editorIndentGuide.background1': border,
    'editorIndentGuide.activeBackground1': gutter,
    'editorBracketMatch.background': `${accent}33`,
    'editorBracketMatch.border':   accent,
  };
}

// Lines that get AI code lenses: JS/TS functions, classes, arrow consts; Python def/class
const LENS_PATTERN = /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function\*?\s+([\w$]+)|class\s+([\w$]+)|(?:const|let|var)\s+([\w$]+)\s*=\s*(?:async\s+)?(?:function\b|\([^)]*\)\s*=>|[\w$]+\s*=>)|def\s+(\w+)\s*\()/;

export function Editor({
  language, code, path, onChange, onRun, onSave, onCursorChange, onAiAction, externalRef,
  fontSize = 13, tabSize = 2, wordWrap = 'off', minimap = true, fontLigatures = true,
  theme = 'nexide-dark',
  debugLine = null,
  breakpoints,
  onToggleBreakpoint,
}) {
  const monacoRef = useRef(null);
  const codeLensProviderRef = useRef(null);
  const debugDecorationsRef = useRef(null);
  const breakpointDecorationsRef = useRef(null);

  // Monaco commands are registered once at mount; route them through refs so they
  // always call the latest callbacks (otherwise Ctrl+S would save stale content).
  const callbacksRef = useRef({});
  useEffect(() => {
    callbacksRef.current = { onRun, onSave, onCursorChange, onAiAction, onToggleBreakpoint };
  });

  // Dispose the global code lens provider when the editor unmounts
  useEffect(() => () => {
    codeLensProviderRef.current?.dispose();
    codeLensProviderRef.current = null;
    if (externalRef) externalRef.current = null;
  }, [externalRef]);

  function handleEditorDidMount(editor, monaco) {
    if (externalRef) externalRef.current = editor;
    monacoRef.current = editor;
    debugDecorationsRef.current = editor.createDecorationsCollection();
    breakpointDecorationsRef.current = editor.createDecorationsCollection();

    // Keyboard shortcuts
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => callbacksRef.current.onRun?.());
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => callbacksRef.current.onSave?.());

    // Cursor position listener
    editor.onDidChangeCursorPosition((e) => {
      callbacksRef.current.onCursorChange?.({ line: e.position.lineNumber, col: e.position.column });
    });

    // Breakpoint toggle on gutter click
    editor.onMouseDown((e) => {
      const T = monaco.editor.MouseTargetType;
      if (e.target.type === T.GUTTER_GLYPH_MARGIN || e.target.type === T.GUTTER_LINE_NUMBERS) {
        const lineNumber = e.target.position?.lineNumber;
        if (lineNumber) callbacksRef.current.onToggleBreakpoint?.(lineNumber);
      }
    });

    editor.updateOptions({ glyphMargin: true });

    // Command used by the AI code lenses
    const cmdId = editor.addCommand(0, (_ctx, action, lineNum, snippet) => {
      callbacksRef.current.onAiAction?.(action, lineNum, snippet);
    });

    codeLensProviderRef.current?.dispose();

    // A layout change (e.g. a side panel opening) cancels an in-flight lens request and
    // Monaco only re-asks on the next edit, so ask again once the layout settles.
    const lensChanged = new monaco.Emitter();
    let relayoutTimer = null;
    const layoutSub = editor.onDidLayoutChange(() => {
      clearTimeout(relayoutTimer);
      relayoutTimer = setTimeout(() => lensChanged.fire(), 300);
    });

    const registration = monaco.languages.registerCodeLensProvider(
      ['javascript', 'typescript', 'python'],
      {
        onDidChange: lensChanged.event,
        provideCodeLenses(model) {
          const lenses = [];
          const lineCount = model.getLineCount();
          for (let i = 1; i <= lineCount; i++) {
            const match = model.getLineContent(i).match(LENS_PATTERN);
            if (!match) continue;
            const name = match[1] || match[2] || match[3] || match[4] || 'function';
            const range = new monaco.Range(i, 1, i, 1);
            lenses.push(
              { range, command: { id: cmdId, title: '✨ Explain',   arguments: ['explain', i, name] } },
              { range, command: { id: cmdId, title: '🐛 Debug',     arguments: ['debug', i, name] } },
              { range, command: { id: cmdId, title: '📝 Docstring', arguments: ['docstring', i, name] } },
            );
          }
          return { lenses, dispose: () => {} };
        },
        resolveCodeLens: (_model, codeLens) => codeLens,
      }
    );
    codeLensProviderRef.current = {
      dispose() {
        clearTimeout(relayoutTimer);
        layoutSub.dispose();
        registration.dispose();
        lensChanged.dispose();
      },
    };

    editor.focus();
  }

  // Debug line highlight
  useEffect(() => {
    const editor = monacoRef.current;
    if (!editor || !debugDecorationsRef.current) return;
    debugDecorationsRef.current.set(debugLine ? [{
      range: { startLineNumber: debugLine, startColumn: 1, endLineNumber: debugLine, endColumn: 1 },
      options: { isWholeLine: true, className: 'debug-line-highlight', marginClassName: 'debug-line-margin', stickiness: 1 },
    }] : []);
    if (debugLine) editor.revealLineInCenterIfOutsideViewport(debugLine);
  }, [debugLine, path]);

  // Breakpoint glyphs
  useEffect(() => {
    if (!breakpointDecorationsRef.current) return;
    breakpointDecorationsRef.current.set(Array.from(breakpoints || []).map(line => ({
      range: { startLineNumber: line, startColumn: 1, endLineNumber: line, endColumn: 1 },
      options: { isWholeLine: false, glyphMarginClassName: 'breakpoint-glyph', stickiness: 1 },
    })));
  }, [breakpoints, path]);

  function handleEditorWillMount(monaco) {
    monaco.editor.defineTheme('nexide-dark', {
      base: 'vs-dark', inherit: true, rules: BASE_RULES,
      colors: themeColors({ bg: '#241f33', line: '#2e2841', border: '#3f3856', accent: '#c9b0ff', fg: '#f7f3ff', gutter: '#a69cc4' }),
    });
    monaco.editor.defineTheme('nexide-aurora', {
      base: 'vs-dark', inherit: true, rules: BASE_RULES,
      colors: themeColors({ bg: '#162829', line: '#1e3334', border: '#2e4a4b', accent: '#7fe3f0', fg: '#effbf8', gutter: '#8fb8b1' }),
    });
    monaco.editor.defineTheme('nexide-crimson', {
      base: 'vs-dark', inherit: true, rules: BASE_RULES,
      colors: themeColors({ bg: '#2c1c1f', line: '#372428', border: '#4d3337', accent: '#ffb07a', fg: '#fff3ee', gutter: '#c09a8f' }),
    });
  }

  const currentCode = code !== undefined ? code : (STARTERS[language] || '// Start coding...\n');

  return (
    <div className="editor-wrapper" id="monaco-editor-container">
      <MonacoEditor
        language={language === 'typescript' ? 'typescript' : language}
        value={currentCode}
        path={path ? `file:///${path}` : undefined}
        theme={MONACO_THEMES[theme] || 'nexide-dark'}
        onChange={val => onChange?.(val ?? '')}
        beforeMount={handleEditorWillMount}
        onMount={handleEditorDidMount}
        options={{
          fontSize,
          fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
          fontLigatures,
          lineHeight: 21,
          minimap: { enabled: minimap, renderCharacters: false, scale: 0.8 },
          scrollBeyondLastLine: false,
          roundedSelection: true,
          padding: { top: 12, bottom: 12 },
          smoothScrolling: true,
          cursorBlinking: 'smooth',
          cursorSmoothCaretAnimation: 'on',
          wordWrap,
          wordWrapColumn: 80,
          renderWhitespace: 'selection',
          bracketPairColorization: { enabled: true },
          guides: { bracketPairs: true, indentation: true },
          suggest: { showKeywords: true, showSnippets: true },
          quickSuggestions: { other: true, comments: false, strings: false },
          tabSize,
          insertSpaces: true,
          formatOnPaste: true,
          renderLineHighlight: 'line',
          scrollbar: {
            verticalScrollbarSize: 6,
            horizontalScrollbarSize: 6,
          },
        }}
      />
    </div>
  );
}

export default Editor;
