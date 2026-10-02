import { Package, RotateCcw, ExternalLink } from 'lucide-react';

/**
 * npm packages pinned for the current workspace (spec → exact esm.sh build).
 * Unpinning re-resolves that package to its latest version on the next run.
 */
export function PackagesPanel({ workspaceLabel, pins = {}, onUnpin, onUpdateAll }) {
  const entries = Object.entries(pins).sort(([a], [b]) => a.localeCompare(b));

  return (
    <div className="packages-panel" id="packages-panel" style={{ display: 'flex', flexDirection: 'column', height: '100%', fontSize: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 12px', borderBottom: '1px solid var(--border)' }}>
        <Package size={13} aria-hidden="true" />
        <span style={{ fontWeight: 600 }}>npm packages</span>
        <span style={{ color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={workspaceLabel}>
          · {workspaceLabel}
        </span>
        <div style={{ flex: 1 }} />
        <button
          className="btn-clear"
          id="btn-update-all-packages"
          onClick={onUpdateAll}
          disabled={entries.length === 0}
          title="Re-resolve every package to its latest version on the next run"
        >
          <RotateCcw size={10} /> Update all
        </button>
      </div>

      {entries.length === 0 ? (
        <div style={{ padding: 16, color: 'var(--text-muted)', lineHeight: 1.6 }}>
          No packages pinned yet. Import one in JavaScript or TypeScript —
          <code style={{ display: 'block', margin: '6px 0' }}>import {'{ chunk }'} from 'lodash-es';</code>
          — and run it. The exact version used is pinned here so later runs give the same result
          (and work offline).
        </div>
      ) : (
        <ul role="list" style={{ listStyle: 'none', margin: 0, padding: 0, overflow: 'auto' }}>
          {entries.map(([spec, id]) => (
            <li
              key={spec}
              className="package-row"
              data-spec={spec}
              style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', borderBottom: '1px solid var(--border)' }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>{spec}</div>
                <div style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', fontSize: 11 }}>{id}</div>
              </div>
              <a
                href={`https://www.npmjs.com/package/${spec.replace(/^(@[^/]+\/[^/@]+|[^/@]+).*$/, '$1')}`}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-icon"
                title="View on npm"
                aria-label={`View ${spec} on npm`}
                style={{ width: 22, height: 22 }}
              >
                <ExternalLink size={11} />
              </a>
              <button className="btn-clear" onClick={() => onUnpin(spec)} title="Use the latest version on the next run" aria-label={`Unpin ${spec}`}>
                Unpin
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
