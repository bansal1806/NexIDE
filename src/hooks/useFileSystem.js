import { useState, useCallback } from 'react';

// Build a recursive file tree from a directory handle
async function buildFileTree(dirHandle, path = '') {
  const children = [];
  for await (const [name, handle] of dirHandle.entries()) {
    const fullPath = path ? `${path}/${name}` : name;
    if (handle.kind === 'directory') {
      // Skip hidden dirs and node_modules
      if (name.startsWith('.') || name === 'node_modules' || name === '__pycache__' || name === '.git') continue;
      const subChildren = await buildFileTree(handle, fullPath);
      children.push({ name, path: fullPath, kind: 'directory', handle, children: subChildren });
    } else {
      children.push({ name, path: fullPath, kind: 'file', handle, children: [] });
    }
  }
  // Sort: directories first, then files, both alphabetical
  children.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return children;
}
// Fallback: Build a file tree from a FileList array (Firefox/Brave fallback)
function buildFallbackTree(files) {
  const root = [];
  files.forEach(file => {
    // webkitRelativePath usually starts with the root folder name "Project/src/app.js"
    const parts = file.webkitRelativePath.split('/');
    parts.shift(); // Remove the top-level directory root
    
    let currentLevel = root;
    
    parts.forEach((part, i) => {
      const isFile = i === parts.length - 1;
      const fullPath = parts.slice(0, i + 1).join('/');
      let existing = currentLevel.find(item => item.name === part);
      
      if (!existing) {
        if (isFile) {
          existing = { name: part, path: fullPath, kind: 'file', handle: { fallback: true, file, content: null }, children: [] };
          currentLevel.push(existing);
        } else {
          existing = { name: part, path: fullPath, kind: 'directory', handle: { fallback: true }, children: [] };
          currentLevel.push(existing);
        }
      }
      
      if (!isFile) {
        currentLevel = existing.children;
      }
    });
  });
  
  // Sort
  const sortTree = (nodes) => {
    nodes.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    nodes.forEach(n => sortTree(n.children));
    return nodes;
  };
  
  return sortTree(root);
}
export function useFileSystem() {
  const [rootName, setRootName]   = useState(null);
  const [fileTree, setFileTree]   = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError]         = useState(null);
  const [rootHandle, setRootHandle] = useState(null);

  const openFolder = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      
      const isNative = typeof window !== 'undefined' && 'showDirectoryPicker' in window;
      
      if (isNative) {
        const dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
        const tree = await buildFileTree(dirHandle);
        setRootHandle(dirHandle);
        setRootName(dirHandle.name);
        setFileTree(tree);
        setIsLoading(false);
        return { name: dirHandle.name, tree };
      } else {
        return new Promise((resolve) => {
          const input = document.createElement('input');
          input.type = 'file';
          input.webkitdirectory = true;
          input.multiple = true;
          input.onchange = (e) => {
            const files = Array.from(e.target.files);
            if (!files.length) {
              setIsLoading(false);
              resolve(null);
              return;
            }
            const rootName = files[0].webkitRelativePath.split('/')[0] || 'Project';
            const tree = buildFallbackTree(files);
            setRootHandle({ fallback: true, rootName, tree });
            setRootName(rootName);
            setFileTree(tree);
            setIsLoading(false);
            resolve({ name: rootName, tree });
          };
          input.oncancel = () => { setIsLoading(false); resolve(null); };
          input.click();
        });
      }
    } catch (e) {
      if (e.name !== 'AbortError') setError(e.message);
      setIsLoading(false);
      return null;
    }
  }, []);

  const readFile = useCallback(async (fileHandle) => {
    if (fileHandle.fallback) {
      if (fileHandle.content !== null) return fileHandle.content;
      return await fileHandle.file.text();
    }
    const file = await fileHandle.getFile();
    return await file.text();
  }, []);

  const writeFile = useCallback(async (fileHandle, content) => {
    if (fileHandle.fallback) {
      fileHandle.content = content;
      return;
    }
    const writable = await fileHandle.createWritable();
    await writable.write(content);
    await writable.close();
  }, []);

  const createFile = useCallback(async (dirHandle, name) => {
    if (dirHandle && dirHandle.fallback) {
      return { fallback: true, file: new File([''], name), content: '' };
    }
    const fileHandle = await dirHandle.getFileHandle(name, { create: true });
    return fileHandle;
  }, []);

  const deleteEntry = useCallback(async (parentHandle, name) => {
    await parentHandle.removeEntry(name, { recursive: true });
  }, []);

  // Path-based access (files a running project creates or deletes). Native folders only:
  // the <input webkitdirectory> fallback is a read-only snapshot. Returns false when unsupported.
  const dirFor = useCallback(async (path, create) => {
    let dir = rootHandle;
    for (const part of path.split('/').slice(0, -1)) dir = await dir.getDirectoryHandle(part, { create });
    return dir;
  }, [rootHandle]);

  const writePath = useCallback(async (path, content) => {
    if (!rootHandle || rootHandle.fallback) return false;
    const dir = await dirFor(path, true);
    const handle = await dir.getFileHandle(path.split('/').pop(), { create: true });
    const writable = await handle.createWritable();
    await writable.write(content);
    await writable.close();
    return true;
  }, [rootHandle, dirFor]);

  const removePath = useCallback(async (path) => {
    if (!rootHandle || rootHandle.fallback) return false;
    try {
      const dir = await dirFor(path, false);
      await dir.removeEntry(path.split('/').pop(), { recursive: true });
    } catch (e) {
      if (e?.name !== 'NotFoundError') throw e; // already gone
    }
    return true;
  }, [rootHandle, dirFor]);

  // Preload source files into Monaco models (bounded so huge folders don't exhaust memory)
  const readAllFiles = useCallback(async (tree) => {
    const results = [];
    const exts = ['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.json', '.html', '.css', '.md', '.py',
                  '.txt', '.csv', '.tsv', '.yaml', '.yml', '.toml', '.xml',
                  // web project sources (mounted when the folder runs as a project)
                  '.vue', '.svelte', '.astro', '.scss', '.sass', '.less', '.svg', '.mdx'];
    const MAX_FILES = 300;
    const MAX_FILE_BYTES = 512 * 1024;

    async function fileSize(handle) {
      if (handle.fallback) return handle.file?.size ?? 0;
      return (await handle.getFile()).size;
    }

    async function traverse(nodes) {
      for (const node of nodes) {
        if (results.length >= MAX_FILES) return;
        if (node.kind === 'directory') {
          await traverse(node.children);
        } else if (node.kind === 'file') {
          const ext = node.name.substring(node.name.lastIndexOf('.'));
          if (exts.includes(ext.toLowerCase())) {
            try {
              if (await fileSize(node.handle) > MAX_FILE_BYTES) continue;
              const content = await readFile(node.handle);
              results.push({ path: node.path, name: node.name, content });
            } catch (e) {
              console.warn(`Failed to read ${node.path}`, e);
            }
          }
        }
      }
    }
    
    await traverse(tree);
    return results;
  }, [readFile]);

  const refreshTree = useCallback(async () => {
    // The <input webkitdirectory> fallback is a one-time snapshot; nothing to re-read
    if (!rootHandle || rootHandle.fallback) return;
    try {
      setFileTree(await buildFileTree(rootHandle));
    } catch (e) {
      setError(e.message);
    }
  }, [rootHandle]);

  const isSupported = true; // Polyfilled for all browsers

  return {
    rootName, fileTree, isLoading, error, isSupported,
    openFolder, readFile, writeFile, createFile, deleteEntry, refreshTree, readAllFiles,
    writePath, removePath,
  };
}
