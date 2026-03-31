import { memo, useState, useCallback } from 'react';
import {
  Box, Hash, Type, Braces, List,
  ToggleRight, CircleSlash, ChevronRight, ChevronDown,
  Eye, EyeOff, Search, Copy, Check, X
} from 'lucide-react';

export const VariableInspector = memo(function VariableInspector({
  snapshot,
  previousSnapshot,
  changedVars = new Set(),
  watchList = [],
  onAddWatch,
  onRemoveWatch,
  callStack = [],
}) {
  const [filter, setFilter]       = useState('');
  const [activeTab, setActiveTab] = useState('vars'); // 'vars' | 'watch' | 'stack'
  const [copiedKey, setCopiedKey] = useState(null);

  const copyValue = useCallback((name, value) => {
    navigator.clipboard?.writeText(JSON.stringify(value, null, 2))
      .then(() => {
        setCopiedKey(name);
        setTimeout(() => setCopiedKey(null), 1500);
      })
      .catch(() => {});
  }, []);

  if (!snapshot) {
    return (
      <div className="vi-empty" id="variable-inspector-empty">
        <div className="vi-empty-icon">
          <BugIcon size={32} />
        </div>
        <div className="vi-empty-text">
          <h3>No Execution Snapshot</h3>
          <p>Run your code in <strong>Debug mode</strong> to record state history and scrub through time.</p>
        </div>
        <div className="vi-empty-shortcuts">
          <span><kbd>F5</kbd> Debug</span>
          <span><kbd>←→</kbd> Step</span>
          <span><kbd>Space</kbd> Play</span>
        </div>
      </div>
    );
  }

  const { line, state } = snapshot;
  const entries = Object.entries(state || {});
  const filteredEntries = filter
    ? entries.filter(([name]) => name.toLowerCase().includes(filter.toLowerCase()))
    : entries;
  const sortedEntries = filteredEntries.sort(([a], [b]) => a.localeCompare(b));

  const prevState = previousSnapshot?.state || {};

  // Watch values
  const watchEntries = watchList.map(name => ({
    name,
    value: state?.[name],
    exists: name in (state || {}),
  }));

  return (
    <div className="vi-container" id="variable-inspector">
      {/* ── Header ── */}
      <div className="vi-header">
        <div className="vi-header-left">
          <Braces size={14} className="vi-header-icon" />
          <span className="vi-header-title">STATE</span>
          <span className="vi-header-line">L{line}</span>
        </div>
        <div className="vi-header-badges">
          <span className="vi-badge vi-badge-vars">{entries.length} vars</span>
          {changedVars.size > 0 && (
            <span className="vi-badge vi-badge-changed">{changedVars.size} changed</span>
          )}
        </div>
      </div>

      {/* ── Tab bar ── */}
      <div className="vi-tabs">
        <button
          className={`vi-tab ${activeTab === 'vars' ? 'active' : ''}`}
          onClick={() => setActiveTab('vars')}
        >
          Variables
          <span className="vi-tab-count">{entries.length}</span>
        </button>
        <button
          className={`vi-tab ${activeTab === 'watch' ? 'active' : ''}`}
          onClick={() => setActiveTab('watch')}
        >
          Watch
          <span className="vi-tab-count">{watchList.length}</span>
        </button>
        <button
          className={`vi-tab ${activeTab === 'stack' ? 'active' : ''}`}
          onClick={() => setActiveTab('stack')}
        >
          Stack
        </button>
      </div>

      {/* ── Variables Tab ── */}
      {activeTab === 'vars' && (
        <>
          {/* Search */}
          <div className="vi-search">
            <Search size={12} className="vi-search-icon" />
            <input
              type="text"
              placeholder="Filter variables…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="vi-search-input"
            />
            {filter && (
              <button className="vi-search-clear" onClick={() => setFilter('')}>
                <X size={12} />
              </button>
            )}
          </div>

          {/* Variable list */}
          <div className="vi-list">
            {sortedEntries.length === 0 ? (
              <div className="vi-list-empty">
                {filter ? 'No matching variables' : 'No local variables at this step'}
              </div>
            ) : (
              sortedEntries.map(([name, value]) => (
                <VariableRow
                  key={name}
                  name={name}
                  value={value}
                  prevValue={prevState[name]}
                  isChanged={changedVars.has(name)}
                  isNew={!(name in prevState)}
                  onCopy={copyValue}
                  isCopied={copiedKey === name}
                  isWatched={watchList.includes(name)}
                  onToggleWatch={
                    watchList.includes(name)
                      ? () => onRemoveWatch?.(name)
                      : () => onAddWatch?.(name)
                  }
                />
              ))
            )}
          </div>
        </>
      )}

      {/* ── Watch Tab ── */}
      {activeTab === 'watch' && (
        <div className="vi-list">
          {watchEntries.length === 0 ? (
            <div className="vi-list-empty">
              No watch expressions. Click the <Eye size={10} /> icon on a variable to watch it.
            </div>
          ) : (
            watchEntries.map(({ name, value, exists }) => (
              <VariableRow
                key={name}
                name={name}
                value={exists ? value : undefined}
                isChanged={changedVars.has(name)}
                isNew={false}
                onCopy={exists ? copyValue : undefined}
                isCopied={copiedKey === name}
                isWatched={true}
                onToggleWatch={() => onRemoveWatch?.(name)}
                dimmed={!exists}
              />
            ))
          )}
        </div>
      )}

      {/* ── Stack Tab ── */}
      {activeTab === 'stack' && (
        <div className="vi-list">
          {(!callStack || callStack.length === 0) ? (
            <div className="vi-list-empty">
              Call stack tracking requires function declarations in your code.
            </div>
          ) : (
            callStack.map((frame, i) => (
              <div key={i} className={`vi-stack-frame ${i === 0 ? 'current' : ''}`}>
                <span className="vi-stack-idx">{i}</span>
                <span className="vi-stack-name">{frame.name || 'anonymous'}</span>
                {frame.line && <span className="vi-stack-line">L{frame.line}</span>}
              </div>
            ))
          )}
        </div>
      )}

      {/* ── Legend ── */}
      <div className="vi-legend">
        <div className="vi-legend-item">
          <span className="vi-legend-dot" style={{ background: 'var(--accent-cyan)' }} /> String/Number
        </div>
        <div className="vi-legend-item">
          <span className="vi-legend-dot" style={{ background: '#a855f7' }} /> Object/Array
        </div>
        <div className="vi-legend-item">
          <span className="vi-legend-dot" style={{ background: 'var(--accent-orange)' }} /> Bool/Null
        </div>
        <div className="vi-legend-item">
          <span className="vi-legend-dot vi-legend-dot-changed" /> Changed
        </div>
      </div>
    </div>
  );
});

/* ── Variable Row ────────────────────────────────────────────── */

const VariableRow = memo(function VariableRow({
  name, value, prevValue, isChanged, isNew, onCopy, isCopied,
  isWatched, onToggleWatch, dimmed = false,
}) {
  const [expanded, setExpanded] = useState(false);

  const isObject = value !== null && typeof value === 'object';
  const isArray  = Array.isArray(value);
  const isString = typeof value === 'string';
  const isBool   = typeof value === 'boolean';
  const isNull   = value === null || value === undefined;
  const isNumber = typeof value === 'number';

  let typeClass = 'vi-type-number';
  let TypeIcon = Hash;
  let typeLabel = typeof value;

  if (isNull)        { typeClass = 'vi-type-null';   TypeIcon = CircleSlash; typeLabel = value === null ? 'null' : 'undefined'; }
  else if (isBool)   { typeClass = 'vi-type-bool';   TypeIcon = ToggleRight; typeLabel = 'boolean'; }
  else if (isString) { typeClass = 'vi-type-string'; TypeIcon = Type;        typeLabel = 'string'; }
  else if (isArray)  { typeClass = 'vi-type-array';  TypeIcon = List;        typeLabel = `array[${value.length}]`; }
  else if (isObject) { typeClass = 'vi-type-object'; TypeIcon = Box;         typeLabel = `object{${Object.keys(value).length}}`; }
  else if (isNumber) { typeClass = 'vi-type-number'; TypeIcon = Hash;        typeLabel = 'number'; }

  const canExpand = isObject || isArray;

  return (
    <div className={`vi-row ${isChanged ? 'changed' : ''} ${isNew ? 'new' : ''} ${dimmed ? 'dimmed' : ''}`}>
      <div className="vi-row-main" onClick={canExpand ? () => setExpanded(!expanded) : undefined}>
        {/* Expand toggle */}
        <span className={`vi-expand ${canExpand ? 'expandable' : ''}`}>
          {canExpand ? (expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />) : <span style={{ width: 12 }} />}
        </span>

        {/* Type icon */}
        <TypeIcon size={12} className={`vi-type-icon ${typeClass}`} />

        {/* Name */}
        <span className="vi-name">{name}</span>

        {/* Type badge */}
        <span className={`vi-type-badge ${typeClass}`}>{typeLabel}</span>

        {/* Value */}
        <span className={`vi-value ${typeClass}`}>
          {formatValue(value)}
        </span>

        {/* Change indicator */}
        {isChanged && !isNew && (
          <span className="vi-change-indicator" title={`Previous: ${safeStringify(prevValue)}`}>
            Δ
          </span>
        )}
        {isNew && <span className="vi-new-indicator">NEW</span>}

        {/* Actions */}
        <span className="vi-row-actions">
          {onToggleWatch && (
            <button
              className={`vi-action-btn ${isWatched ? 'watched' : ''}`}
              onClick={(e) => { e.stopPropagation(); onToggleWatch(); }}
              title={isWatched ? 'Unwatch' : 'Watch this variable'}
            >
              {isWatched ? <EyeOff size={11} /> : <Eye size={11} />}
            </button>
          )}
          {onCopy && (
            <button
              className="vi-action-btn"
              onClick={(e) => { e.stopPropagation(); onCopy(name, value); }}
              title="Copy value"
            >
              {isCopied ? <Check size={11} /> : <Copy size={11} />}
            </button>
          )}
        </span>
      </div>

      {/* Expanded object view */}
      {expanded && canExpand && (
        <div className="vi-expanded">
          {(isArray ? value.map((v, i) => [String(i), v]) : Object.entries(value)).map(([k, v]) => (
            <div key={k} className="vi-expanded-row">
              <span className="vi-expanded-key">{k}</span>
              <span className="vi-expanded-sep">:</span>
              <span className={`vi-expanded-value ${getTypeClass(v)}`}>{formatValue(v)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
});

/* ── Helpers ──────────────────────────────────────────────────── */

function formatValue(val) {
  if (val === null) return 'null';
  if (val === undefined) return 'undefined';
  if (typeof val === 'string') return `"${val.length > 40 ? val.slice(0, 40) + '…' : val}"`;
  if (typeof val === 'boolean') return val ? 'true' : 'false';
  if (typeof val === 'number') return String(val);
  if (Array.isArray(val)) return `[${val.length} items]`;
  if (typeof val === 'object') {
    const keys = Object.keys(val);
    if (keys.length <= 3) {
      return `{ ${keys.map(k => `${k}: ${shortValue(val[k])}`).join(', ')} }`;
    }
    return `{ ${keys.length} keys }`;
  }
  if (typeof val === 'function') return 'ƒ()';
  return String(val);
}

function shortValue(val) {
  if (val === null) return 'null';
  if (val === undefined) return 'undef';
  if (typeof val === 'string') return `"${val.length > 12 ? val.slice(0, 12) + '…' : val}"`;
  if (typeof val === 'number') return String(val);
  if (typeof val === 'boolean') return String(val);
  if (Array.isArray(val)) return `[${val.length}]`;
  if (typeof val === 'object') return `{…}`;
  return '…';
}

function getTypeClass(val) {
  if (val === null || val === undefined) return 'vi-type-null';
  if (typeof val === 'string') return 'vi-type-string';
  if (typeof val === 'number') return 'vi-type-number';
  if (typeof val === 'boolean') return 'vi-type-bool';
  if (Array.isArray(val)) return 'vi-type-array';
  if (typeof val === 'object') return 'vi-type-object';
  return '';
}

function safeStringify(val) {
  try { return JSON.stringify(val); }
  catch { return String(val); }
}

function BugIcon(props) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24" height="24"
      viewBox="0 0 24 24"
      fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      {...props}
    >
      <path d="m8 2 1.88 1.88"/>
      <path d="M14.12 3.88 16 2"/>
      <path d="M9 7.13v-1a3.003 3.003 0 1 1 6 0v1"/>
      <path d="M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6"/>
      <path d="M12 20v-9"/>
      <path d="M6.53 9C4.6 8.8 3 7.1 3 5"/>
      <path d="M6 13H2"/>
      <path d="M3 21c0-2.1 1.7-3.9 3.8-4"/>
      <path d="M20.97 5c0 2.1-1.6 3.8-3.5 4"/>
      <path d="M22 13h-4"/>
      <path d="M17.2 17c2.1.1 3.8 1.9 3.8 4"/>
    </svg>
  );
}
