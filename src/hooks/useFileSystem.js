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

  const readAllFiles = useCallback(async (tree) => {
    const results = [];
    const exts = ['.js', '.jsx', '.ts', '.tsx', '.json', '.html', '.css', '.md'];
    
    async function traverse(nodes) {
      for (const node of nodes) {
        if (node.kind === 'directory') {
          await traverse(node.children);
        } else if (node.kind === 'file') {
          const ext = node.name.substring(node.name.lastIndexOf('.'));
          if (exts.includes(ext.toLowerCase())) {
            try {
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
    if (!rootHandle) return;
    const tree = await buildFileTree(rootHandle);
    setFileTree(tree);
  }, [rootHandle]);

  const isSupported = true; // Polyfilled for all browsers

  return {
    rootName, fileTree, isLoading, error, isSupported,
    openFolder, readFile, writeFile, createFile, deleteEntry, refreshTree, readAllFiles
  };
}
