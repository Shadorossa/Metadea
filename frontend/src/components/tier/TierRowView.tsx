import { useCallback, useRef, useState, type ReactNode } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, rectSortingStrategy } from '@dnd-kit/sortable';
import { labelTextColor } from '../../lib/tier/tier-palette';
import type { TierRow } from '../../lib/tier/tier-board';
import { TierRowMenu, type TierRowAction } from './TierRowMenu';
import type { Translations } from '../../i18n/types';

export const CONTAINER_PREFIX = 'container:';

/** Drop zone (row or pool) around a sortable list of tiles. */
export function TierDropZone({ containerId, items, className, label, children }: {
  containerId: string;
  items: string[];
  className: string;
  label: string;
  children: ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: CONTAINER_PREFIX + containerId, data: { containerId } });
  return (
    <SortableContext id={containerId} items={items} strategy={rectSortingStrategy}>
      <div ref={setNodeRef} className={`${className}${isOver ? ' tier-drop--over' : ''}`} role="group" aria-label={label}>
        {children}
      </div>
    </SortableContext>
  );
}

interface Props {
  row: TierRow;
  index: number;
  rowCount: number;
  isDropTarget: boolean;
  t: Translations['tier'];
  onLabel: (rowId: string, label: string) => void;
  onColor: (rowId: string, color: string) => void;
  onAction: (rowId: string, action: TierRowAction) => void;
  children: ReactNode;
}

export function TierRowView({ row, index, rowCount, isDropTarget, t, onLabel, onColor, onAction, children }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(row.label);
  const [menuOpen, setMenuOpen] = useState(false);
  const gearRef = useRef<HTMLButtonElement>(null);
  const labelButtonRef = useRef<HTMLButtonElement>(null);

  const startEdit = () => { setDraft(row.label); setEditing(true); };
  const commit = () => {
    setEditing(false);
    if (draft !== row.label) onLabel(row.id, draft);
    requestAnimationFrame(() => labelButtonRef.current?.focus());
  };
  const closeMenu = useCallback(() => {
    setMenuOpen(false);
    gearRef.current?.focus();
  }, []);

  const textColor = labelTextColor(row.color);
  const rowLabel = row.label || String(index + 1);

  return (
    <div className={`tier-row${isDropTarget ? ' tier-row--target' : ''}`}>
      <div className="tier-row-label" style={{ background: row.color, color: textColor }}>
        {editing ? (
          <textarea
            className="tier-row-label-input"
            value={draft}
            maxLength={32}
            rows={2}
            aria-label={t.row_label_aria.replace('{n}', String(index + 1))}
            autoFocus
            onFocus={event => event.currentTarget.select()}
            onChange={event => setDraft(event.target.value.replace(/\n/g, ' '))}
            onBlur={commit}
            onKeyDown={event => {
              if (event.key === 'Enter') { event.preventDefault(); commit(); }
              if (event.key === 'Escape') { event.preventDefault(); setDraft(row.label); setEditing(false); }
            }}
          />
        ) : (
          <button
            ref={labelButtonRef}
            type="button"
            className="tier-row-label-text"
            aria-label={`${t.row_label_aria.replace('{n}', String(index + 1))}: ${row.label}`}
            onClick={startEdit}
          >
            {row.label}
          </button>
        )}
      </div>

      <TierDropZone
        containerId={row.id}
        items={row.items}
        className="tier-row-items"
        label={t.row_items_aria.replace('{label}', rowLabel).replace('{count}', String(row.items.length))}
      >
        {children}
      </TierDropZone>

      <div className="tier-row-controls">
        <button
          ref={gearRef}
          type="button"
          className="tier-row-control"
          aria-label={t.row_settings}
          title={t.row_settings}
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen(open => !open)}
        >
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" />
          </svg>
        </button>
        <button type="button" className="tier-row-control" aria-label={t.row_move_up} title={t.row_move_up} disabled={index === 0} onClick={() => onAction(row.id, 'move_up')}>
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true"><polyline points="6 15 12 9 18 15" /></svg>
        </button>
        <button type="button" className="tier-row-control" aria-label={t.row_move_down} title={t.row_move_down} disabled={index === rowCount - 1} onClick={() => onAction(row.id, 'move_down')}>
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true"><polyline points="6 9 12 15 18 9" /></svg>
        </button>
        {menuOpen && (
          <TierRowMenu
            color={row.color}
            isFirst={index === 0}
            isLast={index === rowCount - 1}
            hasItems={row.items.length > 0}
            t={t}
            onColor={color => onColor(row.id, color)}
            onAction={action => onAction(row.id, action)}
            onClose={closeMenu}
          />
        )}
      </div>
    </div>
  );
}
