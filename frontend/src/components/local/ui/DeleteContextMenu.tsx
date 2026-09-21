import { useEffect, useLayoutEffect, useRef } from 'react';
import {
  useFloating, offset, flip, shift, useDismiss, useRole, useInteractions, FloatingPortal,
} from '@floating-ui/react';

interface DeleteContextMenuProps {
  x: number;
  y: number;
  label: string;
  onDelete: () => void;
  onClose: () => void;
}

// Anchored to the exact point a right-click landed on (a zero-size virtual
// reference), not a real trigger element — flip/shift keep the menu inside
// the viewport when that point is near a screen edge, where the old fixed
// pixel top/left positioning used to let it run off-screen. Also swaps the
// previous global `click` listener for useDismiss (outside press + Escape),
// which is what makes Escape actually close this without a bespoke key
// handler, and autofocuses the one action so it's reachable without a mouse.
export function DeleteContextMenu({ x, y, label, onDelete, onClose }: DeleteContextMenuProps) {
  const { refs, floatingStyles, context } = useFloating({
    open: true,
    onOpenChange: open => { if (!open) onClose(); },
    placement: 'bottom-start',
    strategy: 'fixed',
    middleware: [offset(4), flip(), shift({ padding: 8 })],
  });

  useLayoutEffect(() => {
    refs.setPositionReference({
      getBoundingClientRect: () => ({
        width: 0, height: 0, x, y, top: y, left: x, right: x, bottom: y,
      }),
    });
  }, [refs, x, y]);

  const dismiss = useDismiss(context);
  const role = useRole(context, { role: 'menu' });
  const { getFloatingProps } = useInteractions([dismiss, role]);

  const itemRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { itemRef.current?.focus(); }, []);

  return (
    <FloatingPortal>
      <div
        ref={refs.setFloating}
        style={floatingStyles}
        className="local-context-menu"
        {...getFloatingProps({ onClick: e => e.stopPropagation() })}
      >
        <button
          ref={itemRef}
          type="button"
          role="menuitem"
          className="context-menu-item local-context-menu-item delete"
          onClick={onDelete}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 6 }}>
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
          </svg>
          {label}
        </button>
      </div>
    </FloatingPortal>
  );
}
