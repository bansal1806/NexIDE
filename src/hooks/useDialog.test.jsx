// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { useRef } from 'react';
import { render, fireEvent, cleanup } from '@testing-library/react';
import { useDialog } from './useDialog';

// jsdom has no layout: treat every element as visible
beforeAll(() => {
  Element.prototype.getClientRects = function () { return [{ width: 1, height: 1 }]; };
});
afterEach(cleanup);

function Dialog({ onClose }) {
  const ref = useRef(null);
  useDialog(ref, { onClose });
  return (
    <div ref={ref} tabIndex={-1} role="dialog" aria-label="Test">
      <button>first</button>
      <input aria-label="middle" />
      <button disabled>disabled</button>
      <button>last</button>
    </div>
  );
}

function Harness({ open, onClose }) {
  return (
    <>
      <button>opener</button>
      {open && <Dialog onClose={onClose} />}
    </>
  );
}

const byText = (container, text) => [...container.querySelectorAll('button, input')]
  .find(el => el.textContent === text || el.getAttribute('aria-label') === text);

describe('useDialog', () => {
  it('moves focus into the dialog and returns it to the opener on close', () => {
    const onClose = vi.fn();
    const { container, rerender } = render(<Harness open={false} onClose={onClose} />);
    byText(container, 'opener').focus();
    rerender(<Harness open={true} onClose={onClose} />);
    expect(document.activeElement.textContent).toBe('first');
    rerender(<Harness open={false} onClose={onClose} />);
    expect(document.activeElement.textContent).toBe('opener');
  });

  it('traps Tab and Shift+Tab inside the dialog (skipping disabled controls)', () => {
    const { container } = render(<Harness open={true} onClose={() => {}} />);
    byText(container, 'last').focus();
    fireEvent.keyDown(document.activeElement, { key: 'Tab' });
    expect(document.activeElement.textContent).toBe('first');
    fireEvent.keyDown(document.activeElement, { key: 'Tab', shiftKey: true });
    expect(document.activeElement.textContent).toBe('last');
  });

  it('pulls stray focus back in on Tab', () => {
    const { container } = render(<Harness open={true} onClose={() => {}} />);
    byText(container, 'opener').focus();
    fireEvent.keyDown(document.activeElement, { key: 'Tab' });
    expect(document.activeElement.textContent).toBe('first');
  });

  it('closes on Escape without letting it reach other handlers', () => {
    const onClose = vi.fn();
    const outer = vi.fn();
    window.addEventListener('keydown', outer);
    render(<Harness open={true} onClose={onClose} />);
    fireEvent.keyDown(document.activeElement, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(outer).not.toHaveBeenCalled();
    window.removeEventListener('keydown', outer);
  });
});
