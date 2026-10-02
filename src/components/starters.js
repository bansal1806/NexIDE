// Starter code templates per language
export const STARTERS = {
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
