// Viewport-clamped position for a fixed-position popover (tooltip/hint)
// anchored under a trigger element, re-measured on resize/scroll while open.
// Plain getBoundingClientRect math on purpose — the popover renders outside
// the modal (whose overflow:hidden would clip it), so it needs viewport
// coordinates, centred on the anchor, kept 12px inside the viewport, and
// flipped above the anchor when it wouldn't fit below.
import { useEffect, useState, type RefObject } from 'react';

export interface PopoverPosition {
  top: number;
  left: number;
}

export interface AnchoredPopoverSize {
  width: number;
  height: number;
}

export function useAnchoredPopover(anchorRef: RefObject<HTMLElement | null>, size: AnchoredPopoverSize) {
  const { width: maxWidth, height } = size;
  const [position, setPosition] = useState<PopoverPosition | null>(null);
  const isOpen = position !== null;

  const measure = (anchor: HTMLElement): PopoverPosition => {
    const rect = anchor.getBoundingClientRect();
    const width = Math.min(maxWidth, window.innerWidth - 24);
    const left = Math.max(12, Math.min(rect.left + rect.width / 2 - width / 2, window.innerWidth - width - 12));
    const belowTop = rect.bottom + 8;
    const top = belowTop + height > window.innerHeight ? Math.max(12, rect.top - height) : belowTop;
    return { top, left };
  };

  const open = () => {
    const anchor = anchorRef.current;
    if (!anchor || typeof window === 'undefined') return;
    setPosition(measure(anchor));
  };

  const close = () => setPosition(null);

  useEffect(() => {
    if (!isOpen) return;
    const reposition = () => {
      const anchor = anchorRef.current;
      if (!anchor) return;
      const { top, left } = measure(anchor);
      setPosition(previous => previous?.top === top && previous.left === left ? previous : { top, left });
    };
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    return () => {
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  return { position, isOpen, open, close };
}
