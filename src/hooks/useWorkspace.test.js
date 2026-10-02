// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// ── Mocks: file system, Monaco models, network services ──
const fakeFs = {
  rootName: null,
  fileTree: [],
  isLoading: false,
  readFile: vi.fn(async (handle) => handle.text),
  writeFile: vi.fn(async (handle, content) => { handle.text = content; }),
  openFolder: vi.fn(),
  readAllFiles: vi.fn(async () => []),
  refreshTree: vi.fn(),
};
vi.mock('./useFileSystem', () => ({ useFileSystem: () => fakeFs }));
vi.mock('./useMonacoWorkspace', () => ({ useMonacoWorkspace: () => {} }));
vi.mock('../services/github', () => ({ fetchFileContent: vi.fn() }));
vi.mock('../services/db', () => ({
  fetchProjects: vi.fn(async () => []),
  createProject: vi.fn(),
  fetchProjectFiles: vi.fn(async () => []),
  saveFileToCloud: vi.fn(),
}));

const { useWorkspace } = await import('./useWorkspace');

function setup(overrides = {}) {
  const opts = {
    userId: null,
    notify: vi.fn(),
    githubToken: '',
    autoSave: false,
    editorRef: { current: null },
    onReset: vi.fn(),
    onRevealSidebar: vi.fn(),
    onNeedAuth: vi.fn(),
    ...overrides,
  };
  const hook = renderHook((props) => useWorkspace(props), { initialProps: opts });
  return { ...hook, opts };
}

const fileNode = (path, text) => ({ path, name: path.split('/').pop(), kind: 'file', handle: { text }, children: [] });

beforeEach(() => {
  vi.clearAllMocks();
  fakeFs.rootName = null;
  fakeFs.fileTree = [];
});

describe('useWorkspace — tabs', () => {
  it('creates template tabs with unique names and activates the newest', () => {
    const { result } = setup();
    act(() => result.current.newFileFromTemplate('js'));
    act(() => result.current.newFileFromTemplate('js'));
    act(() => result.current.newFileFromTemplate('py'));
    expect(result.current.tabs.map(t => t.path)).toEqual(['main.js', 'main-2.js', 'main.py']);
    expect(result.current.activeTab.path).toBe('main.py');
    expect(result.current.activeTab.lang).toBe('python');
  });

  it('opens a file once; reopening activates the existing tab', async () => {
    const { result } = setup();
    let first;
    await act(async () => { first = await result.current.openFileInTab(fileNode('src/a.js', 'let a = 1;')); });
    await act(async () => { await result.current.openFileInTab(fileNode('src/b.js', 'b')); });
    let again;
    await act(async () => { again = await result.current.openFileInTab(fileNode('src/a.js', 'ignored')); });
    expect(again.id).toBe(first.id);
    expect(result.current.tabs).toHaveLength(2);
    expect(result.current.activeTab.path).toBe('src/a.js');
    expect(result.current.activeTab.content).toBe('let a = 1;');
  });

  it('resolves bare { path } through the file tree (code map / terminal)', async () => {
    fakeFs.fileTree = [{ path: 'lib', name: 'lib', kind: 'directory', children: [fileNode('lib/util.js', 'export {}')] }];
    const { result, rerender, opts } = setup();
    rerender(opts);
    await act(async () => { await result.current.openFileInTab({ path: 'lib/util.js' }); });
    expect(result.current.activeTab.content).toBe('export {}');
  });

  it('refuses binary files with a notice', async () => {
    const { result, opts } = setup();
    let tab;
    await act(async () => { tab = await result.current.openFileInTab(fileNode('logo.png', '\u0089PNG')); });
    expect(tab).toBeNull();
    expect(result.current.tabs).toHaveLength(0);
    expect(opts.notify).toHaveBeenCalledWith('info', expect.stringMatching(/binary/));
  });

  it('marks edits dirty and saves through the file handle', async () => {
    const { result } = setup();
    const node = fileNode('main.js', 'old');
    await act(async () => { await result.current.openFileInTab(node); });
    act(() => result.current.handleEditorChange('new text'));
    expect(result.current.activeTab).toMatchObject({ content: 'new text', dirty: true });
    await act(async () => { await result.current.saveFile(); });
    expect(fakeFs.writeFile).toHaveBeenCalledWith(node.handle, 'new text');
    expect(result.current.activeTab.dirty).toBe(false);
  });

  it('asks before closing a dirty tab and activates the previous one', async () => {
    const { result } = setup();
    await act(async () => { await result.current.openFileInTab(fileNode('a.js', 'a')); });
    await act(async () => { await result.current.openFileInTab(fileNode('b.js', 'b')); });
    act(() => result.current.handleEditorChange('b edited'));
    const b = result.current.activeTab;

    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false);
    act(() => result.current.closeTab(b.id));
    expect(result.current.tabs).toHaveLength(2);

    confirm.mockReturnValueOnce(true);
    act(() => result.current.closeTab(b.id));
    expect(result.current.tabs.map(t => t.path)).toEqual(['a.js']);
    expect(result.current.activeTab.path).toBe('a.js');
    confirm.mockRestore();
  });

  it('reports unsaved work', async () => {
    const { result } = setup();
    expect(result.current.hasUnsavedWork()).toBe(false);
    await act(async () => { await result.current.openFileInTab(fileNode('a.js', 'a')); });
    act(() => result.current.handleEditorChange('changed'));
    expect(result.current.hasUnsavedWork()).toBe(true);
  });
});

describe('useWorkspace — workspace identity and run files', () => {
  it('derives a stable key per workspace', () => {
    const { result, rerender, opts } = setup();
    expect(result.current.workspaceKey).toBe('scratch');
    fakeFs.rootName = 'my-project';
    rerender(opts);
    expect(result.current.workspaceKey).toBe('local:my-project');
    expect(result.current.rootName).toBe('my-project');
  });

  it('builds run files with open tabs overriding cached content', async () => {
    fakeFs.fileTree = [{ ...fileNode('lib/x.js', 'tree version'), _content: 'tree version' }];
    const { result, rerender, opts } = setup();
    rerender(opts);
    await act(async () => { await result.current.openFileInTab(fileNode('lib/x.js', 'tab version')); });
    const files = result.current.buildRunFiles({ path: 'main.js', content: 'entry' });
    expect(files).toEqual({ 'lib/x.js': 'tab version', 'main.js': 'entry' });
  });

  it('caps run files at 5 MB', () => {
    const big = 'x'.repeat(3 * 1024 * 1024);
    fakeFs.fileTree = [
      { ...fileNode('a.txt', big), _content: big },
      { ...fileNode('b.txt', big), _content: big },
    ];
    const { result, rerender, opts } = setup();
    rerender(opts);
    const files = result.current.buildRunFiles(null);
    expect(Object.keys(files)).toEqual(['a.txt']);
  });
});
