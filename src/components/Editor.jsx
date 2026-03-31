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
# Note: Running in browser simulation mode

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

  export function Editor({
  language, code, path, onChange, onRun, onSave, onCursorChange, onAiAction, editorRef: externalRef,
  fontSize = 13, tabSize = 2, wordWrap = 'off', minimap = true, fontLigatures = true,
  debugLine = null,
  breakpoints = new Set(),
  onToggleBreakpoint,
}) {
  const monacoRef = useRef(null);
  const monacoInstanceRef = useRef(null);
  const codeLensProviderRef = useRef(null);
  const debugDecorationsRef = useRef([]);
  const breakpointDecorationsRef = useRef([]);

  function handleEditorDidMount(editor, monaco) {
    if (externalRef) externalRef.current = editor;
    monacoRef.current = editor;
    monacoInstanceRef.current = monaco;

    // Keyboard shortcuts
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => { if (onRun) onRun(); });
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => { if (onSave) onSave(); });

    // Cursor position listener
    editor.onDidChangeCursorPosition((e) => {
      if (onCursorChange) onCursorChange({ line: e.position.lineNumber, col: e.position.column });
    });

    // ── Breakpoint toggle on gutter click ────────────────────────
    editor.onMouseDown((e) => {
      // e.target.type 2 = GUTTER_GLYPH_MARGIN, 3 = GUTTER_LINE_NUMBERS
      if (e.target.type === 2 || e.target.type === 3) {
        const lineNumber = e.target.position?.lineNumber;
        if (lineNumber && onToggleBreakpoint) {
          onToggleBreakpoint(lineNumber);
        }
      }
    });

    // Enable glyph margin
    editor.updateOptions({ glyphMargin: true });

    // Register a command for AI Actions triggered by Code Lenses
    const cmdId = editor.addCommand(0, (ctx, action, lineNum, snippet) => {
      if (onAiAction) onAiAction(action, lineNum, snippet);
    });

    // Cleanup previous provider if any
    if (codeLensProviderRef.current) {
      codeLensProviderRef.current.dispose();
    }

    // Register simple regex-based Code Lens provider for AI
    codeLensProviderRef.current = monaco.languages.registerCodeLensProvider('*', {
      provideCodeLenses: function (model) {
        const text = model.getValue();
        const lines = text.split('\\n');
        const lenses = [];

        lines.forEach((line, i) => {
          const match = line.match(/^(?:export\\s+)?(?:async\\s+)?(?:function|class)\\s+(\\w+)|^(?:(?:export\\s+)?const|let|var)\\s+(\\w+)\\s*=\\s*(?:async\\s+)?(?:function|\\(.*\\)\\s*=>)/);
          if (match) {
            const name = match[1] || match[2] || 'function';
            const range = new monaco.Range(i + 1, 1, i + 1, 1);
            lenses.push({
              range,
              command: { id: cmdId, title: '✨ Explain', arguments: ['explain', i + 1, name] }
            });
            lenses.push({
              range,
              command: { id: cmdId, title: '🐛 Debug', arguments: ['debug', i + 1, name] }
            });
            lenses.push({
              range,
              command: { id: cmdId, title: '📝 Docstring', arguments: ['docstring', i + 1, name] }
            });
          }
        });
        return { lenses, dispose: () => {} };
      },
      resolveCodeLens: function (model, codeLens) {
        return codeLens;
      }
    });

    editor.focus();
  }

  // Update debug line + breakpoint decorations
  useEffect(() => {
    if (!monacoRef.current) return;
    const editor = monacoRef.current;

    // Debug line decoration
    const debugDecorations = debugLine ? [
      {
        range: { startLineNumber: debugLine, startColumn: 1, endLineNumber: debugLine, endColumn: 1 },
        options: {
          isWholeLine: true,
          className: 'debug-line-highlight',
          marginClassName: 'debug-line-margin',
          stickiness: 1
        }
      }
    ] : [];

    debugDecorationsRef.current = editor.deltaDecorations(debugDecorationsRef.current, debugDecorations);

    if (debugLine) {
      editor.revealLineInCenterIfOutsideViewport(debugLine);
    }
  }, [debugLine]);

  // Breakpoint glyph decorations
  useEffect(() => {
    if (!monacoRef.current) return;
    const editor = monacoRef.current;

    const bpDecorations = Array.from(breakpoints).map(line => ({
      range: { startLineNumber: line, startColumn: 1, endLineNumber: line, endColumn: 1 },
      options: {
        isWholeLine: false,
        glyphMarginClassName: 'breakpoint-glyph',
        stickiness: 1,
      }
    }));

    breakpointDecorationsRef.current = editor.deltaDecorations(
      breakpointDecorationsRef.current,
      bpDecorations
    );
  }, [breakpoints]);

  function handleEditorWillMount(monaco) {
    // Define NexIDE dark theme
    monaco.editor.defineTheme('nexide-dark', {
      base: 'vs-dark',
      inherit: true,
      rules: [
        { token: 'comment',    foreground: '565870', fontStyle: 'italic' },
        { token: 'keyword',    foreground: 'a855f7', fontStyle: 'bold' },
        { token: 'string',     foreground: '6ee7b7' },
        { token: 'number',     foreground: 'f97316' },
        { token: 'delimiter',  foreground: '8b8fa8' },
        { token: 'variable',   foreground: '00d4ff' },
        { token: 'type',       foreground: 'fbbf24' },
        { token: 'function',   foreground: '00d4ff' },
        { token: 'identifier', foreground: 'e2e4ef' },
      ],
      colors: {
        'editor.background':           '#0d0e14',
        'editor.foreground':           '#e2e4ef',
        'editorLineNumber.foreground': '#3d3f57',
        'editorLineNumber.activeForeground': '#8b8fa8',
        'editor.selectionBackground':  '#7c3aed33',
        'editor.lineHighlightBackground': '#13141c',
        'editorCursor.foreground':     '#00d4ff',
        'editor.findMatchBackground':  '#00d4ff33',
        'editorWidget.background':     '#13141c',
        'editorWidget.border':         '#2a2b3d',
        'input.background':            '#0f1018',
        'input.border':                '#2a2b3d',
        'focusBorder':                 '#7c3aed',
        'scrollbarSlider.background':  '#2a2b3d66',
        'scrollbarSlider.hoverBackground': '#3d3f5766',
        'editorGutter.background':     '#0d0e14',
        'editorIndentGuide.background1': '#2a2b3d',
        'editorIndentGuide.activeBackground1': '#3d3f57',
      },
    });
  }

  const currentCode = code !== undefined ? code : (STARTERS[language] || '// Start coding...\n');

  return (
    <div className="editor-wrapper" id="monaco-editor-container">
      <MonacoEditor
        language={language === 'typescript' ? 'typescript' : language}
        value={currentCode}
        path={path ? `file:///${path}` : undefined}
        theme="nexide-dark"
        onChange={val => onChange && onChange(val || '')}
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
