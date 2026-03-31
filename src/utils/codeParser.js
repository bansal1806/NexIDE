// Lightweight code parser for the D3 code map
// Extracts functions, classes, variables using regex

export function parseCode(code, language = 'javascript') {
  const nodes = [];
  const edges = [];

  if (!code || code.trim().length === 0) return { nodes, edges };

  if (language === 'javascript' || language === 'typescript') {
    return parseJS(code);
  } else if (language === 'python') {
    return parsePython(code);
  }

  return { nodes, edges };
}

export function parseProjectMap(fileTree) {
  const nodes = [];
  const edges = [];
  let id = 0;
  
  // Flat map for quick lookup by path
  const pathMap = new Map();

  const processNode = (item, parentId = null) => {
    const currentId = id++;
    const isDir = item.kind === 'directory';

    const node = {
      id: currentId,
      type: isDir ? 'folder' : 'component',
      name: item.name,
      path: item.path,
      size: isDir ? 32 : 24,
      content: item._content // If cached/available
    };
    
    nodes.push(node);
    pathMap.set(item.path, node);

    if (parentId !== null) {
      edges.push({ source: parentId, target: currentId, type: 'structural' });
    }

    if (isDir && item.children) {
      item.children.forEach(child => processNode(child, currentId));
    }
  };

  if (fileTree && fileTree.length > 0) {
    fileTree.forEach(item => processNode(item));
  }

  // Second pass: dependency links
  nodes.forEach(srcNode => {
    if (srcNode.type === 'folder' || !srcNode.content) return;

    const deps = extractDependencies(srcNode.content, srcNode.path.split('.').pop());
    deps.forEach(depPath => {
      const resolved = resolveModulePath(depPath, srcNode.path, fileTree);
      if (resolved) {
        const destNode = pathMap.get(resolved);
        if (destNode && destNode.id !== srcNode.id) {
          edges.push({ source: srcNode.id, target: destNode.id, type: 'dependency' });
        }
      }
    });
  });

  return { nodes, edges };
}

function extractDependencies(code, ext) {
  const deps = [];
  if (!code) return deps;

  if (ext === 'js' || ext === 'jsx' || ext === 'ts' || ext === 'tsx') {
    const importRegex = /import\s+.*?\s+from\s+['"]([^'"]+)['"]/g;
    const requireRegex = /require\s*\(['"]([^'"]+)['"]\)/g;
    let match;
    while ((match = importRegex.exec(code)) !== null) deps.push(match[1]);
    while ((match = requireRegex.exec(code)) !== null) deps.push(match[1]);
  } else if (ext === 'py') {
    const fromRegex = /^from\s+([\w.]+)\s+import/gm;
    const importRegex = /^import\s+([\w.]+)/gm;
    let match;
    while ((match = fromRegex.exec(code)) !== null) deps.push(match[1].replace(/\./g, '/'));
    while ((match = importRegex.exec(code)) !== null) deps.push(match[1].replace(/\./g, '/'));
  }
  return [...new Set(deps)];
}

function resolveModulePath(importPath, currentPath, fileTree) {
  // If absolute path or package, skip for now unless we have node_modules mapped
  if (!importPath.startsWith('.')) return null;

  const currentDir = currentPath.split('/').slice(0, -1).join('/');
  const parts = importPath.split('/');
  const dirStack = currentDir ? currentDir.split('/') : [];

  for (const part of parts) {
    if (part === '.') continue;
    if (part === '..') dirStack.pop();
    else dirStack.push(part);
  }

  const resolvedBase = dirStack.join('/');
  
  // Try common extensions
  const extensions = ['', '.js', '.jsx', '.ts', '.tsx', '/index.js', '/index.jsx'];
  
  const findInTree = (path, tree) => {
    for (const node of tree) {
      if (node.path === path) return node.path;
      if (node.kind === 'directory' && node.children) {
        const found = findInTree(path, node.children);
        if (found) return found;
      }
    }
    return null;
  };

  for (const ext of extensions) {
    const found = findInTree(resolvedBase + ext, fileTree);
    if (found) return found;
  }

  return null;
}

function parseJS(code) {
  const nodes = [];
  const edges = [];
  let id = 0;

  const addNode = (type, name, line) => {
    nodes.push({ id: id++, type, name, line });
  };

  const lines = code.split('\n');
  const importNames = [];

  lines.forEach((line, i) => {
    const lineNum = i + 1;
    const trim = line.trim();

    // Import statements
    const importMatch = trim.match(/^import\s+(?:\{([^}]+)\}|(\w+))\s+from\s+['"]([^'"]+)['"]/);
    if (importMatch) {
      const imports = importMatch[1] || importMatch[2];
      const source = importMatch[3];
      const name = `📦 ${source}`;
      addNode('import', name, lineNum);
      if (imports) {
        imports.split(',').forEach(imp => {
          const n = imp.trim();
          if (n) importNames.push(n);
        });
      }
      return;
    }

    // Function declarations
    const fnMatch = trim.match(/^(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(/);
    if (fnMatch) {
      addNode('function', fnMatch[1], lineNum);
      return;
    }

    // Arrow function / const fn
    const arrowMatch = trim.match(/^(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?\([^)]*\)\s*=>/);
    if (arrowMatch) {
      addNode('function', `${arrowMatch[1]}()`, lineNum);
      return;
    }

    // Class declarations
    const classMatch = trim.match(/^(?:export\s+)?(?:default\s+)?class\s+(\w+)/);
    if (classMatch) {
      addNode('class', classMatch[1], lineNum);
      return;
    }

    // React component (const X = () => with JSX hint)
    const reactMatch = trim.match(/^(?:export\s+)?(?:default\s+)?(?:const|function)\s+([A-Z]\w+)/);
    if (reactMatch) {
      addNode('component', reactMatch[1], lineNum);
      return;
    }

    // Variable declarations
    const varMatch = trim.match(/^(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=/);
    if (varMatch && !trim.includes('=>')) {
      addNode('variable', varMatch[1], lineNum);
      return;
    }
  });

  // Build simple edges: connect imports to first function
  const firstFn = nodes.find(n => n.type === 'function' || n.type === 'component');
  nodes.filter(n => n.type === 'import').forEach(imp => {
    if (firstFn) {
      edges.push({ source: imp.id, target: firstFn.id });
    }
  });

  return { nodes, edges };
}

function parsePython(code) {
  const nodes = [];
  const edges = [];
  let id = 0;

  const lines = code.split('\n');

  lines.forEach((line, i) => {
    const lineNum = i + 1;
    const trim = line.trimStart();

    // Import
    if (trim.startsWith('import ') || trim.startsWith('from ')) {
      const name = trim.replace(/^(import|from)\s+/, '').split(' ')[0];
      nodes.push({ id: id++, type: 'import', name: `📦 ${name}`, line: lineNum });
      return;
    }

    // Function def
    const fnMatch = trim.match(/^def\s+(\w+)\s*\(/);
    if (fnMatch) {
      nodes.push({ id: id++, type: 'function', name: fnMatch[1], line: lineNum });
      return;
    }

    // Class def
    const classMatch = trim.match(/^class\s+(\w+)/);
    if (classMatch) {
      nodes.push({ id: id++, type: 'class', name: classMatch[1], line: lineNum });
      return;
    }

    // Variable (top-level only, no indent)
    if (!line.startsWith(' ') && !line.startsWith('\t')) {
      const varMatch = trim.match(/^([a-zA-Z_]\w*)\s*=/);
      if (varMatch && !trim.startsWith('#')) {
        nodes.push({ id: id++, type: 'variable', name: varMatch[1], line: lineNum });
      }
    }
  });

  return { nodes, edges };
}
