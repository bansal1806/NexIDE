import MonacoEditor from '@monaco-editor/react';
import { useRef, useEffect } from 'react';

// Starter code templates per language
const STARTERS = {
  javascript: `// Welcome to NexIDE ⚡
// Press Ctrl+Enter to run your code

function fibonacci(n) {
  if (n <= 1) return n;
  return fibonacci(n - 1) + fibonacci(n - 2);
}

// Generate first 10 Fibonacci numbers
for (let i = 0; i < 10; i++) {
  console.log(\`fib(\${i}) = \${fibonacci(i)}\`);
}

// Try some modern JS
const squares = Array.from({ length: 5 }, (_, i) => i ** 2);
console.log('Squares:', squares);
`,
  typescript: `// TypeScript in NexIDE ⚡

interface User {
  id: number;
  name: string;
  email: string;
}

function greetUser(user: User): string {
  return \`Hello, \${user.name}! (ID: \${user.id})\`;
}

const users: User[] = [
  { id: 1, name: 'Alice', email: 'alice@example.com' },
  { id: 2, name: 'Bob',   email: 'bob@example.com' },
];

users.forEach(user => {
  console.log(greetUser(user));
});
`,
  python: `# Python in NexIDE ⚡
# Runs in your browser via Pyodide (Ctrl+Enter)

def fibonacci(n):
    if n <= 1:
        return n
    return fibonacci(n - 1) + fibonacci(n - 2)

for i in range(10):
    print(f"fib({i}) = {fibonacci(i)}")
`,
  html: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>My Page</title>
  <style>
    body { font-family: sans-serif; max-width: 800px; margin: 2rem auto; }
    h1   { color: #7c3aed; }
  </style>
</head>
<body>
  <h1>Hello, NexIDE! ⚡</h1>
  <p>Edit this HTML and explore the code map.</p>
</body>
</html>
`,
  css: `/* CSS in NexIDE ⚡ */

:root {
  --primary: #7c3aed;
  --accent:  #00d4ff;
}

body {
  font-family: 'Inter', sans-serif;
  background: #0d0e14;
  color: #e2e4ef;
}

.container {
  max-width: 1200px;
  margin: 0 auto;
  padding: 2rem;
}

.btn {
  padding: 8px 16px;
  background: var(--primary);
  color: white;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.2s;
}

.btn:hover {
  background: var(--accent);
}
`,
  json: `{
  "name": "nexide-project",
  "version": "1.0.0",
  "description": "Browser-based AI code editor",
  "features": [
    "Monaco Editor",
    "Gemini AI",
    "D3 Code Map",
    "Live Execution"
  ],
  "author": {
    "name": "Developer",
    "tool": "NexIDE"
  }
}
`,
  markdown: `# NexIDE ⚡

> A browser-based AI-powered code editor

## Features

- 🎨 **Monaco Editor** — VS Code's engine in the browser
- 🤖 **Gemini AI** — Ask AI about your code
- 📊 **Code Map** — Visual D3 AST explorer
- ▶ **Live Execution** — Run JS instantly

## Getting Started

1. Write your code in the editor
2. Press **Ctrl+Enter** to run
3. Ask AI for help in the chat panel
4. Explore structure in the Code Map

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| Ctrl+Enter | Run code |
| Ctrl+/ | Toggle comment |
| Ctrl+Shift+F | Format document |
`,
};

// Monaco theme per app theme (backgrounds match the CSS variables in index.css)
const MONACO_THEMES = {
  'nexide-dark': 'nexide-dark',
  'vs-dark': 'vs-dark',
  aurora: 'nexide-aurora',
  crimson: 'nexide-crimson',
};

const BASE_RULES = [
  { token: 'comment',    foreground: '565870', fontStyle: 'italic' },
  { token: 'keyword',    foreground: 'a855f7', fontStyle: 'bold' },
  { token: 'string',     foreground: '6ee7b7' },
  { token: 'number',     foreground: 'f97316' },
  { token: 'delimiter',  foreground: '8b8fa8' },
  { token: 'variable',   foreground: '00d4ff' },
  { token: 'type',       foreground: 'fbbf24' },
  { token: 'function',   foreground: '00d4ff' },
  { token: 'identifier', foreground: 'e2e4ef' },
];

function themeColors(bg, surface, border, accent) {
  return {
    'editor.background':           bg,
    'editor.foreground':           '#e2e4ef',
    'editorLineNumber.foreground': '#3d3f57',
    'editorLineNumber.activeForeground': '#8b8fa8',
    'editor.selectionBackground':  `${accent}33`,
    'editor.lineHighlightBackground': surface,
    'editorCursor.foreground':     accent,
    'editor.findMatchBackground':  `${accent}33`,
    'editorWidget.background':     surface,
    'editorWidget.border':         border,
    'input.background':            surface,
    'input.border':                border,
    'focusBorder':                 accent,
    'scrollbarSlider.background':  `${border}66`,
    'scrollbarSlider.hoverBackground': '#3d3f5766',
    'editorGutter.background':     bg,
    'editorIndentGuide.background1': border,
    'editorIndentGuide.activeBackground1': '#3d3f57',
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
      colors: themeColors('#0d0e14', '#13141c', '#2a2b3d', '#00d4ff'),
    });
    monaco.editor.defineTheme('nexide-aurora', {
      base: 'vs-dark', inherit: true, rules: BASE_RULES,
      colors: themeColors('#0a0b12', '#12101e', '#2d2442', '#5eead4'),
    });
    monaco.editor.defineTheme('nexide-crimson', {
      base: 'vs-dark', inherit: true, rules: BASE_RULES,
      colors: themeColors('#120a0a', '#1c0f0f', '#422424', '#fca5a5'),
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

export { STARTERS };
