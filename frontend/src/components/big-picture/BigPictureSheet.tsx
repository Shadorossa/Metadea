import { useEffect, useRef, useState, type ReactNode } from 'react';
import { moveFocus } from '../../lib/big-picture/focus-grid';
import { useInputLayer } from './input-layers';

export interface SheetEntry {
  id: string;
  label: string;
  /** Right-aligned current value (On/Off, 60 %). */
  value?: ReactNode;
  disabled?: boolean;
  onSelect?: () => void;
  /** Left/right on this entry (a toggle or a slider). */
  onAdjust?: (direction: -1 | 1) => void;
}

interface BigPictureSheetProps {
  title: string;
  entries: SheetEntry[];
  onClose: () => void;
  className?: string;
}

// A vertical list layer over the browse view — the X options sheet and the
// Start menu. Up/down move (focus-grid, one column), A selects, left/right
// adjust, B closes. Mouse clicks select directly.
export function BigPictureSheet({ title, entries, onClose, className }: BigPictureSheetProps) {
  const [index, setIndex] = useState(0);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const focused = Math.min(index, Math.max(0, entries.length - 1));

  useEffect(() => { itemRefs.current[focused]?.focus({ preventScroll: true }); }, [focused]);

  useInputLayer(action => {
    const entry = entries[focused];
    if (action === 'up' || action === 'down') {
      setIndex(moveFocus(entries.map(() => 1), { row: focused, col: 0 }, action, { wrapVertical: true }).row);
    } else if (action === 'left' || action === 'right') {
      entry?.onAdjust?.(action === 'left' ? -1 : 1);
    } else if (action === 'confirm') {
      if (entry && !entry.disabled) (entry.onSelect ?? (() => entry.onAdjust?.(1)))();
    } else if (action === 'back' || action === 'details' || action === 'menu') {
      onClose();
    }
  });

  return (
    <div className="bp-sheet-backdrop" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`bp-sheet${className ? ` ${className}` : ''}`} role="menu" aria-label={title}>
        <h3 className="bp-sheet-title">{title}</h3>
        {entries.map((entry, i) => (
          <button
            key={entry.id}
            ref={el => { itemRefs.current[i] = el; }}
            type="button"
            role="menuitem"
            className={`bp-sheet-item${i === focused ? ' is-focused' : ''}`}
            disabled={entry.disabled}
            tabIndex={i === focused ? 0 : -1}
            onMouseEnter={() => setIndex(i)}
            onClick={() => { setIndex(i); (entry.onSelect ?? (() => entry.onAdjust?.(1)))(); }}
          >
            <span>{entry.label}</span>
            {entry.value !== undefined && <span className="bp-sheet-value">{entry.value}</span>}
          </button>
        ))}
      </div>
    </div>
  );
}
