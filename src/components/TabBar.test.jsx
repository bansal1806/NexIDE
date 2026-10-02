// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { TabBar } from './TabBar';

const tabs = [
  { id: 1, name: 'a.js', path: 'a.js', dirty: false },
  { id: 2, name: 'b.py', path: 'src/b.py', dirty: true },
  { id: 3, name: 'c.ts', path: 'c.ts', dirty: false },
];

function setup(activeId = 2) {
  const onActivate = vi.fn();
  const onClose = vi.fn();
  render(<TabBar tabs={tabs} activeId={activeId} onActivate={onActivate} onClose={onClose} />);
  return { onActivate, onClose, tabEls: screen.getAllByRole('tab') };
}

afterEach(cleanup);

describe('TabBar', () => {
  it('follows the WAI-ARIA tabs pattern with a roving tabindex', () => {
    const { tabEls } = setup(2);
    expect(screen.getByRole('tablist', { name: 'Open files' })).toBeTruthy();
    expect(tabEls.map(t => t.getAttribute('aria-selected'))).toEqual(['false', 'true', 'false']);
    expect(tabEls.map(t => t.tabIndex)).toEqual([-1, 0, -1]);
    expect(tabEls[1].getAttribute('aria-controls')).toBe('editor-tabpanel');
    expect(tabEls[1].title).toMatch(/unsaved/);
  });

  it('moves with arrows (wrapping), Home and End', () => {
    const { onActivate, tabEls } = setup(2);
    fireEvent.keyDown(tabEls[1], { key: 'ArrowRight' });
    fireEvent.keyDown(tabEls[1], { key: 'ArrowLeft' });
    fireEvent.keyDown(tabEls[2], { key: 'ArrowRight' }); // wraps to first
    fireEvent.keyDown(tabEls[0], { key: 'ArrowLeft' });  // wraps to last
    fireEvent.keyDown(tabEls[1], { key: 'Home' });
    fireEvent.keyDown(tabEls[1], { key: 'End' });
    expect(onActivate.mock.calls.map(c => c[0])).toEqual([3, 1, 1, 3, 1, 3]);
  });

  it('closes with Delete, the × affordance, or middle-click — without activating', () => {
    const { onActivate, onClose, tabEls } = setup(2);
    fireEvent.keyDown(tabEls[0], { key: 'Delete' });
    fireEvent.click(tabEls[2].querySelector('.tab-close'));
    fireEvent(tabEls[1], new MouseEvent('auxclick', { bubbles: true, button: 1 }));
    expect(onClose.mock.calls.map(c => c[0])).toEqual([1, 3, 2]);
    expect(onActivate).not.toHaveBeenCalled();
  });

  it('has no interactive content nested in tabs; Delete is announced as the shortcut', () => {
    const { tabEls } = setup(1);
    for (const tab of tabEls) {
      expect(tab.querySelector('button, a, input, [tabindex]:not([tabindex="-1"])')).toBeNull();
      expect(tab.querySelector('.tab-close').getAttribute('aria-hidden')).toBe('true');
      expect(tab.getAttribute('aria-keyshortcuts')).toBe('Delete');
    }
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });
});
