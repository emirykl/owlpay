// @vitest-environment jsdom

import { cleanup, fireEvent, render } from '@testing-library/react';
import { useRef, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useClickOutside } from './use-click-outside';

function Menu({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useClickOutside(ref, open, onClose);
  return (
    <div>
      <div ref={ref} data-testid="menu"><button>inside</button></div>
      <button data-testid="outside">outside</button>
    </div>
  );
}

afterEach(cleanup);

describe('useClickOutside', () => {
  it('closes when the pointer goes down outside the element', () => {
    const onClose = vi.fn();
    const { getByTestId } = render(<Menu open onClose={onClose} />);

    fireEvent.mouseDown(getByTestId('outside'));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('stays open for a click on the element itself', () => {
    const onClose = vi.fn();
    const { getByTestId } = render(<Menu open onClose={onClose} />);

    fireEvent.mouseDown(getByTestId('menu').querySelector('button')!);

    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes on Escape but ignores other keys', () => {
    const onClose = vi.fn();
    render(<Menu open onClose={onClose} />);

    fireEvent.keyDown(document, { key: 'Enter' });
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('listens for nothing while the element is closed', () => {
    const onClose = vi.fn();
    const { getByTestId } = render(<Menu open={false} onClose={onClose} />);

    fireEvent.mouseDown(getByTestId('outside'));
    fireEvent.keyDown(document, { key: 'Escape' });

    expect(onClose).not.toHaveBeenCalled();
  });

  it('stops listening once the element unmounts', () => {
    const onClose = vi.fn();
    const { unmount } = render(<Menu open onClose={onClose} />);

    unmount();
    fireEvent.keyDown(document, { key: 'Escape' });

    // A listener left behind would keep calling into an unmounted component.
    expect(onClose).not.toHaveBeenCalled();
  });

  it('drops the listeners as soon as the caller closes the element', () => {
    const onClose = vi.fn();
    function Toggle() {
      const [open, setOpen] = useState(true);
      return (
        <div>
          <button data-testid="close" onClick={() => setOpen(false)}>close</button>
          <Menu open={open} onClose={onClose} />
        </div>
      );
    }
    const { getByTestId } = render(<Toggle />);

    fireEvent.click(getByTestId('close'));
    fireEvent.keyDown(document, { key: 'Escape' });

    expect(onClose).not.toHaveBeenCalled();
  });
});
