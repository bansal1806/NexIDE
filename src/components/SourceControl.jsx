import '../lib/monaco'; // self-hosted Monaco for the diff view (configures the loader)
import { useEffect, useState } from 'react';
import { DiffEditor } from '@monaco-editor/react';
import { GitCommit, GitPullRequest, Undo2, ExternalLink, AlertTriangle, Loader2, KeyRound, UploadCloud } from 'lucide-react';
import { getLang } from '../utils/files';
import { repoNameFrom } from '../utils/gitChanges';

const BADGE = { modified: 'M', added: 'A', deleted: 'D' };
const branchStamp = () => {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `nexide/${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
};

const TokenNote = ({ onOpenSettings, children }) => (
  <div className="scm-note" role="note">
    <KeyRound size={14} aria-hidden="true" />
    <span>{children}</span>
    <button className="btn-clear" onClick={onOpenSettings}>Open Settings</button>
  </div>
);

/** Publish a local folder, cloud project or starter as a new GitHub repository. */
function PublishPanel({ projectName, hasToken, onPublish, onOpenRepo, onOpenSettings }) {
  const [name, setName] = useState(() => repoNameFrom(projectName));
  const [isPrivate, setIsPrivate] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null);

  const publish = async () => {
    setBusy(true);
    setError(null);
    try {
      setDone(await onPublish({ name: name.trim(), isPrivate }));
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="scm-panel" id="scm-publish">
      <div className="scm-head"><UploadCloud size={14} aria-hidden="true" /><span className="scm-repo">Publish to GitHub</span></div>
      <p className="scm-empty">Create a new repository from this project’s files. Only text files are published (images and other binary files aren’t included yet).</p>
      {!hasToken && (
        <TokenNote onOpenSettings={onOpenSettings}>
          To publish, add a GitHub token in Settings → GitHub that can create repositories: a classic token with the
          “repo” scope, or a fine-grained token for “All repositories” with “Administration” and “Contents” set to Read and write.
        </TokenNote>
      )}
      {done ? (
        <div className="scm-done" role="status" id="scm-publish-result">
          Published <a href={done.url} target="_blank" rel="noopener noreferrer" id="scm-publish-link">{done.owner}/{done.repo}</a>.{' '}
          <button className="btn-clear" id="btn-scm-open-published" onClick={() => onOpenRepo(done)}>Continue here as a GitHub workspace</button>
        </div>
      ) : (
        <div className="scm-commit">
          <label className="settings-label" htmlFor="scm-repo-name">Repository name</label>
          <input id="scm-repo-name" className="scm-branch-input" value={name} onChange={e => setName(e.target.value)} spellCheck={false} />
          <div className="scm-targets" role="radiogroup" aria-label="Visibility">
            <label><input type="radio" id="scm-private" name="scm-visibility" checked={isPrivate} onChange={() => setIsPrivate(true)} /> Private</label>
            <label><input type="radio" id="scm-public" name="scm-visibility" checked={!isPrivate} onChange={() => setIsPrivate(false)} /> Public</label>
          </div>
          <button className="btn-run scm-commit-btn" id="btn-scm-publish" onClick={publish} disabled={busy || !hasToken || !name.trim()}>
            {busy ? <Loader2 size={14} className="spin" aria-hidden="true" /> : <UploadCloud size={14} aria-hidden="true" />}
            Publish
          </button>
        </div>
      )}
      {error && <div className="scm-error" role="alert" id="scm-error"><p>{error}</p></div>}
    </div>
  );
}

/**
 * Source Control. In a GitHub workspace: what changed since the repo was loaded, a diff per file,
 * discard, and commit (to the branch, or to a new branch with a pull request). Elsewhere
 * (mode "publish"): publish the project as a new repository.
 */
export default function SourceControl(props) {
  return props.mode === 'publish' ? <PublishPanel {...props} /> : <GitHubChanges {...props} />;
}

function GitHubChanges({
  info, hasToken, theme, unsavedNames = [],
  listGitChanges, gitOriginal, discardGitChange, commitToGitHub, onOpenSettings,
}) {
  const onDefaultBranch = ['main', 'master', info.defaultBranch].includes(info.branch);
  const [changes, setChanges] = useState(null);
  const [selected, setSelected] = useState(null); // { path, original, current, lang }
  const [target, setTarget] = useState(onDefaultBranch ? 'pr' : 'branch');
  const [message, setMessage] = useState('');
  const [newBranch, setNewBranch] = useState(branchStamp);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [stale, setStale] = useState(false);
  const [done, setDone] = useState(null);

  // listGitChanges changes identity whenever the workspace's files do
  useEffect(() => {
    let cancelled = false;
    listGitChanges().then(list => { if (!cancelled) setChanges(list); });
    return () => { cancelled = true; };
  }, [listGitChanges]);

  const showDiff = async (change) => {
    setError(null);
    try {
      const original = change.status === 'added' ? '' : await gitOriginal(change.path);
      setSelected({ path: change.path, original, current: change.content ?? '', lang: getLang(change.path) });
    } catch (e) {
      setError(`Couldn’t load the original of ${change.path}: ${e.message}`);
    }
  };

  const discard = async (change) => {
    if (!window.confirm(`Discard your changes to ${change.path}?`)) return;
    try {
      await discardGitChange(change);
      if (selected?.path === change.path) setSelected(null);
    } catch (e) {
      setError(e.message);
    }
  };

  const commit = async (mode = target) => {
    setBusy(true);
    setError(null);
    setStale(false);
    setDone(null);
    const text = message.trim() || 'Update from NexIDE';
    try {
      const result = await commitToGitHub({
        message: text,
        newBranch: mode === 'pr' ? newBranch.trim() : null,
        pullRequest: mode === 'pr' ? { title: text.split('\n')[0], body: 'Committed from NexIDE.' } : null,
      });
      setDone(result);
      setMessage('');
      setNewBranch(branchStamp());
      setSelected(null);
      if (mode === 'pr') setTarget('branch'); // keep working on the pull request's branch
    } catch (e) {
      if (e.name === 'StaleBranchError') setStale(true);
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const repoUrl = `https://github.com/${info.owner}/${info.repo}`;

  return (
    <div className="scm-panel" id="scm-panel">
      <div className="scm-head">
        <GitCommit size={14} aria-hidden="true" />
        <span className="scm-repo">{info.owner}/{info.repo}</span>
        <span className="scm-branch" title="Branch">{info.branch}</span>
        {info.commitSha && <code className="scm-sha" title="Commit your changes are based on">{info.commitSha.slice(0, 7)}</code>}
      </div>

      {!hasToken && (
        <TokenNote onOpenSettings={onOpenSettings}>
          To commit, add a GitHub token in Settings → GitHub: a fine-grained token for this repo with
          “Contents: Read and write” (and “Pull requests: Read and write” for pull requests).
        </TokenNote>
      )}

      {unsavedNames.length > 0 && (
        <div className="scm-note warn" role="note">
          <AlertTriangle size={14} aria-hidden="true" />
          <span>Unsaved edits in {unsavedNames.join(', ')}. Save (Ctrl+S) to include them.</span>
        </div>
      )}

      <div className="scm-section-title">Changes {changes ? `(${changes.length})` : ''}</div>
      {changes === null ? (
        <div className="scm-empty"><Loader2 size={14} className="spin" aria-hidden="true" /> Checking…</div>
      ) : changes.length === 0 ? (
        <div className="scm-empty">No changes. Edit and save files, and they’ll show up here.</div>
      ) : (
        <ul className="scm-list" aria-label="Changed files">
          {changes.map(change => (
            <li key={change.path} className={`scm-change ${selected?.path === change.path ? 'selected' : ''}`} data-path={change.path}>
              <button className="scm-change-main" onClick={() => showDiff(change)} title="Show the difference">
                <span className={`scm-badge ${change.status}`} aria-label={change.status}>{BADGE[change.status]}</span>
                <span className="scm-path">{change.path}</span>
              </button>
              <button className="btn-icon" onClick={() => discard(change)} aria-label={`Discard changes to ${change.path}`} title="Discard">
                <Undo2 size={13} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {selected && (
        <div className="scm-diff" aria-label={`Difference in ${selected.path}`}>
          <div className="scm-diff-title">{selected.path}</div>
          <DiffEditor
            height="260px"
            // One pair of models per file, kept and reused: letting the wrapper dispose them on unmount
            // races the diff widget ("TextModel got disposed before DiffEditorWidget model got reset")
            originalModelPath={`inmemory://scm/original/${selected.path}`}
            modifiedModelPath={`inmemory://scm/modified/${selected.path}`}
            keepCurrentOriginalModel
            keepCurrentModifiedModel
            language={selected.lang === 'plaintext' ? undefined : selected.lang}
            original={selected.original}
            modified={selected.current}
            theme={theme}
            options={{
              readOnly: true, renderSideBySide: false, minimap: { enabled: false }, fontSize: 12, scrollBeyondLastLine: false,
              originalAriaLabel: `${selected.path} as committed`, modifiedAriaLabel: `${selected.path} with your changes`,
            }}
          />
        </div>
      )}

      {changes?.length > 0 && (
        <div className="scm-commit">
          <label className="settings-label" htmlFor="scm-message">Commit message</label>
          <textarea
            id="scm-message"
            className="scm-message"
            rows={3}
            placeholder="Update from NexIDE"
            value={message}
            onChange={e => setMessage(e.target.value)}
          />
          <div className="scm-targets" role="radiogroup" aria-label="Where to commit">
            <label>
              <input type="radio" id="scm-target-pr" name="scm-target" checked={target === 'pr'} onChange={() => setTarget('pr')} />
              New branch + pull request into <b>{info.branch}</b>
            </label>
            {target === 'pr' && (
              <input
                id="scm-new-branch"
                className="scm-branch-input"
                aria-label="New branch name"
                value={newBranch}
                onChange={e => setNewBranch(e.target.value)}
                spellCheck={false}
              />
            )}
            <label>
              <input type="radio" id="scm-target-branch" name="scm-target" checked={target === 'branch'} onChange={() => setTarget('branch')} />
              Commit straight to <b>{info.branch}</b>
            </label>
          </div>
          <button className="btn-run scm-commit-btn" id="btn-scm-commit" onClick={() => commit()} disabled={busy || !hasToken || (target === 'pr' && !newBranch.trim())}>
            {busy ? <Loader2 size={14} className="spin" aria-hidden="true" /> : target === 'pr' ? <GitPullRequest size={14} aria-hidden="true" /> : <GitCommit size={14} aria-hidden="true" />}
            {target === 'pr' ? `Commit ${changes.length} and open PR` : `Commit ${changes.length} to ${info.branch}`}
          </button>
        </div>
      )}

      {error && (
        <div className="scm-error" role="alert" id="scm-error">
          <p>{error}</p>
          {stale && (
            <button className="pg-chunky" id="btn-scm-stale-pr" onClick={() => { setTarget('pr'); commit('pr'); }} disabled={busy}>
              <GitPullRequest size={14} aria-hidden="true" /> Put my changes on a new branch + PR
            </button>
          )}
        </div>
      )}

      {done && (
        <div className="scm-done" role="status" id="scm-result">
          Committed {done.count} {done.count === 1 ? 'file' : 'files'} to <b>{done.branch}</b>{' '}
          (<a href={`${repoUrl}/commit/${done.commitSha}`} target="_blank" rel="noopener noreferrer">{done.commitSha.slice(0, 7)}</a>).
          {done.pullRequestUrl && (
            <> <a href={done.pullRequestUrl} target="_blank" rel="noopener noreferrer" id="scm-pr-link">Open the pull request <ExternalLink size={11} aria-hidden="true" /></a></>
          )}
        </div>
      )}
    </div>
  );
}
