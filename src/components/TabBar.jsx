import { useRef } from 'react';
import { EDITOR_PANEL_ID, tabDomId } from './tabIds';

/**
 * Open-file tabs (WAI-ARIA tabs pattern with a roving tabindex):
 * ←/→ previous/next (wraps) · Home/End first/last · Delete closes the focused tab ·
 * middle-click closes. Ctrl+W can't be used — browsers reserve it for closing the browser tab.
 */
export function TabBar({ tabs, activeId, onActivate, onClose }) {
  const refs = useRef(new Map());

  const focusTab = (tab) => {
    if (!tab) return;
    onActivate(tab.id);
    // Focus after React re-renders the tabindex
    requestAnimationFrame(() => refs.current.get(tab.id)?.focus());
  };

  const handleKeyDown = (e, index) => {
    const last = tabs.length - 1;
    switch (e.key) {
      case 'ArrowRight': e.preventDefault(); focusTab(tabs[index === last ? 0 : index + 1]); break;
      case 'ArrowLeft':  e.preventDefault(); focusTab(tabs[index === 0 ? last : index - 1]); break;
      case 'Home':       e.preventDefault(); focusTab(tabs[0]); break;
      case 'End':        e.preventDefault(); focusTab(tabs[last]); break;
      case 'Delete': {
        e.preventDefault();
        const neighbour = tabs[index + 1] || tabs[index - 1];
        onClose(tabs[index].id);
        if (neighbour) requestAnimationFrame(() => refs.current.get(neighbour.id)?.focus());
        break;
      }
      case 'Enter':
      case ' ':
        e.preventDefault();
        onActivate(tabs[index].id);
        break;
    }
  };

  return (
    <div className="tab-bar" role="tablist" aria-label="Open files" aria-orientation="horizontal">
      {tabs.map((tab, index) => {
        const active = tab.id === activeId;
        return (
          <div
            key={tab.id}
            ref={el => { if (el) refs.current.set(tab.id, el); else refs.current.delete(tab.id); }}
            id={tabDomId(tab.id)}
            className={`tab ${active ? 'active' : ''}`}
            role="tab"
            aria-selected={active}
            aria-controls={EDITOR_PANEL_ID}
            aria-keyshortcuts="Delete"
            tabIndex={active ? 0 : -1}
            title={`${tab.path}${tab.dirty ? ' (unsaved)' : ''}`}
            onClick={() => onActivate(tab.id)}
            onMouseDown={e => { if (e.button === 1) e.preventDefault(); }} // no autoscroll on middle-click
            onAuxClick={e => { if (e.button === 1) { e.preventDefault(); onClose(tab.id); } }}
            onKeyDown={e => handleKeyDown(e, index)}
          >
            <span className="tab-name">{tab.name}</span>
            {tab.dirty && <span className="tab-unsaved" aria-label="unsaved changes" />}
            {/* Mouse affordance only: a button inside role="tab" would be nested interactive content.
                Keyboard and screen-reader users close with Delete (announced via aria-keyshortcuts). */}
            <span
              className="tab-close"
              aria-hidden="true"
              onClick={e => { e.stopPropagation(); onClose(tab.id); }}
              title="Close (Delete when the tab is focused, or middle-click)"
            >
              ×
            </span>
          </div>
        );
      })}
    </div>
  );
}
