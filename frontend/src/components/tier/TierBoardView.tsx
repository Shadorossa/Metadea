import { useCallback, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import {
  DndContext, DragOverlay, KeyboardSensor, PointerSensor, TouchSensor, closestCenter, pointerWithin,
  useSensor, useSensors, type Announcements, type CollisionDetection, type DragEndEvent, type DragOverEvent, type DragStartEvent,
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import {
  POOL_ID, addRow, boardItemIds, clearRow, containerItems, findContainer, moveItems, moveRow, orderedSelection,
  removeItems, removeRow, resolveDropAnchor, rowToPool, sendToPool, updateRow, type TierBoard, type TierItemMeta,
} from '../../lib/tier/tier-board';
import { THUMB_ASPECT, THUMB_WIDTH, type TierSettings } from '../../lib/tier/tier-settings';
import type { Translations } from '../../i18n/types';
import { TierTile, TierTileFace } from './TierTile';
import { CONTAINER_PREFIX, TierDropZone, TierRowView } from './TierRowView';
import type { TierRowAction } from './TierRowMenu';

// The board: every row and the item bank share one DndContext, so a cover
// (or the whole selection) can be dragged anywhere. Pointer, touch
// (press-and-hold) and keyboard (Space to pick up, arrows, Space/Enter to
// drop) all go through dnd-kit; board-level keys give the non-drag path:
// 1–9 → that row, 0 → item bank, Delete → remove, Escape → deselect.

export type BoardUpdate = (update: (board: TierBoard) => TierBoard, coalesceKey?: string) => void;

interface Props {
  board: TierBoard;
  meta: ReadonlyMap<string, TierItemMeta>;
  ratingLabels: ReadonlyMap<string, string>;
  settings: TierSettings;
  selection: ReadonlySet<string>;
  onSelectionChange: (next: Set<string>) => void;
  onBoard: BoardUpdate;
  t: Translations['tier'];
}

// Pointer drags target the tile under the pointer (else its row); the
// keyboard has no pointer and falls through to the nearest centre.
const collision: CollisionDetection = args => {
  const hits = pointerWithin(args);
  if (hits.length) {
    const tiles = hits.filter(hit => !String(hit.id).startsWith(CONTAINER_PREFIX));
    return tiles.length ? tiles : hits;
  }
  return closestCenter(args);
};

function focusTile(id: string) {
  requestAnimationFrame(() => {
    document.querySelector<HTMLElement>(`[data-tile-id="${CSS.escape(id)}"]`)?.focus();
  });
}

export function TierBoardView({ board, meta, ratingLabels, settings, selection, onSelectionChange, onBoard, t }: Props) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
      // Enter is kept for selecting; it still drops.
      keyboardCodes: { start: ['Space'], cancel: ['Escape'], end: ['Space', 'Enter'] },
    }),
  );
  const [activeId, setActiveId] = useState<string | null>(null);
  const [carried, setCarried] = useState<string[]>([]);
  const [overContainer, setOverContainer] = useState<string | null>(null);
  const lastDragEnd = useRef(0);
  const anchorId = useRef<string | null>(null);

  const untitled = t.untitled_item;
  const titleOf = useCallback((id: string) => meta.get(id)?.title || untitled, [meta, untitled]);
  const containerLabel = useCallback((containerId: string) => {
    if (containerId === POOL_ID) return t.pool_title;
    const index = board.rows.findIndex(r => r.id === containerId);
    return board.rows[index]?.label || String(index + 1);
  }, [board.rows, t.pool_title]);

  const carriedSet = useMemo(() => new Set(carried), [carried]);

  // ── Selection ─────────────────────────────────────────────────────────
  const handleSelect = useCallback((id: string, event: MouseEvent | KeyboardEvent) => {
    if (Date.now() - lastDragEnd.current < 150) return; // the click that ends a drag
    const next = new Set(selection);
    if (event.shiftKey && anchorId.current) {
      const order = boardItemIds(board);
      const [a, b] = [order.indexOf(anchorId.current), order.indexOf(id)].sort((x, y) => x - y);
      if (a >= 0) order.slice(a, b + 1).forEach(item => next.add(item));
    } else if (event.ctrlKey || event.metaKey || event.type === 'keydown') {
      if (next.has(id)) next.delete(id); else next.add(id);
      anchorId.current = id;
    } else {
      const only = selection.size === 1 && selection.has(id);
      next.clear();
      if (!only) next.add(id);
      anchorId.current = id;
    }
    onSelectionChange(next);
  }, [board, selection, onSelectionChange]);

  const handleSendToPool = useCallback((id: string) => {
    const ids = selection.has(id) ? [...selection] : [id];
    onBoard(b => sendToPool(b, ids));
    onSelectionChange(new Set());
  }, [selection, onBoard, onSelectionChange]);

  // ── Keyboard (non-drag) ──────────────────────────────────────────────
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (activeId) return;
    const target = event.target as HTMLElement;
    const tileId = target.closest<HTMLElement>('[data-tile-id]')?.dataset.tileId;
    if (!tileId) return;
    const ids = selection.size > 0 ? [...selection] : [tileId];
    if (event.key === 'Enter') {
      event.preventDefault();
      handleSelect(tileId, event);
    } else if (/^[0-9]$/.test(event.key) && !event.ctrlKey && !event.metaKey && !event.altKey) {
      const n = Number(event.key);
      const to = n === 0 ? POOL_ID : board.rows[n - 1]?.id;
      if (!to) return;
      event.preventDefault();
      onBoard(b => moveItems(b, ids, to));
      focusTile(tileId);
    } else if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      onBoard(b => removeItems(b, ids));
      onSelectionChange(new Set());
    } else if (event.key === 'Escape' && selection.size > 0) {
      event.preventDefault();
      onSelectionChange(new Set());
    }
  };

  // ── Drag and drop ────────────────────────────────────────────────────
  const onDragStart = ({ active }: DragStartEvent) => {
    const id = String(active.id);
    setActiveId(id);
    setCarried(selection.has(id) ? orderedSelection(board, selection) : [id]);
  };

  const onDragOver = ({ over }: DragOverEvent) => {
    setOverContainer((over?.data.current?.containerId as string | undefined) ?? null);
  };

  const resetDrag = () => {
    setActiveId(null);
    setCarried([]);
    setOverContainer(null);
    lastDragEnd.current = Date.now();
  };

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    const moving = carried.length ? carried : [String(active.id)];
    resetDrag();
    if (!over) return;
    const to = over.data.current?.containerId as string | undefined;
    if (!to) return;
    const overId = String(over.id);
    const overTile = overId.startsWith(CONTAINER_PREFIX) ? null : overId;
    const targetItems = containerItems(board, to);
    const from = findContainer(board, String(active.id));
    let placeAfter = false;
    if (overTile) {
      if (from === to && moving.length === 1) {
        // Same-row sort: dnd-kit's own arrayMove semantics.
        placeAfter = targetItems.indexOf(String(active.id)) < targetItems.indexOf(overTile);
      } else {
        const dragged = active.rect.current.translated;
        placeAfter = !!dragged && dragged.left + dragged.width / 2 > over.rect.left + over.rect.width / 2;
      }
    }
    const anchor = resolveDropAnchor(targetItems, new Set(moving), overTile, placeAfter);
    onBoard(b => moveItems(b, moving, to, anchor));
    if (moving.length > 1) onSelectionChange(new Set());
  };

  const announcements: Announcements = {
    onDragStart: ({ active }) => {
      const id = String(active.id);
      const count = selection.has(id) ? selection.size : 1;
      return t.dnd_picked.replace('{item}', count > 1 ? t.dnd_several.replace('{count}', String(count)) : titleOf(id));
    },
    onDragOver: ({ active, over }) => over
      ? t.dnd_over.replace('{item}', titleOf(String(active.id))).replace('{target}', containerLabel(String(over.data.current?.containerId ?? '')))
      : undefined,
    onDragEnd: ({ active, over }) => over
      ? t.dnd_dropped.replace('{item}', titleOf(String(active.id))).replace('{target}', containerLabel(String(over.data.current?.containerId ?? '')))
      : t.dnd_cancelled.replace('{item}', titleOf(String(active.id))),
    onDragCancel: ({ active }) => t.dnd_cancelled.replace('{item}', titleOf(String(active.id))),
  };

  // ── Rows ─────────────────────────────────────────────────────────────
  const onRowAction = (rowId: string, action: TierRowAction) => {
    const index = board.rows.findIndex(r => r.id === rowId);
    switch (action) {
      case 'add_above': onBoard(b => addRow(b, index).board); break;
      case 'add_below': onBoard(b => addRow(b, index + 1).board); break;
      case 'move_up': onBoard(b => moveRow(b, rowId, index - 1)); break;
      case 'move_down': onBoard(b => moveRow(b, rowId, index + 1)); break;
      case 'to_pool': onBoard(b => rowToPool(b, rowId)); break;
      case 'clear': if (confirm(t.row_clear_confirm)) onBoard(b => clearRow(b, rowId)); break;
      case 'delete': onBoard(b => removeRow(b, rowId)); break;
    }
  };

  const tileWidth = THUMB_WIDTH[settings.thumbSize];
  const style = { '--tier-tile-w': `${tileWidth}px`, '--tier-tile-h': `${Math.round(tileWidth * THUMB_ASPECT)}px` } as CSSProperties;

  const renderTiles = (containerId: string, ids: string[]) => ids.map(id => (
    <TierTile
      key={id}
      id={id}
      containerId={containerId}
      meta={meta.get(id)}
      ratingLabel={ratingLabels.get(id) ?? null}
      untitled={untitled}
      selected={selection.has(id)}
      carried={activeId !== null && activeId !== id && carriedSet.has(id)}
      thumbSize={settings.thumbSize}
      showTitle={settings.showTitles}
      onSelect={handleSelect}
      onSendToPool={handleSendToPool}
    />
  ));

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collision}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onDragCancel={resetDrag}
      accessibility={{ announcements, screenReaderInstructions: { draggable: t.dnd_instructions } }}
    >
      <div className={`tier-board tier-board--${settings.thumbSize}`} style={style} onKeyDown={onKeyDown}>
        <div className="tier-rows">
          {board.rows.map((row, index) => (
            <TierRowView
              key={row.id}
              row={row}
              index={index}
              rowCount={board.rows.length}
              isDropTarget={overContainer === row.id}
              t={t}
              onLabel={(rowId, label) => onBoard(b => updateRow(b, rowId, { label }))}
              onColor={(rowId, color) => onBoard(b => updateRow(b, rowId, { color }), `color:${rowId}`)}
              onAction={onRowAction}
            >
              {renderTiles(row.id, row.items)}
            </TierRowView>
          ))}
        </div>
        <button type="button" className="tier-add-row" onClick={() => onBoard(b => addRow(b).board)}>
          + {t.add_row}
        </button>

        <section className={`tier-pool${overContainer === POOL_ID ? ' tier-pool--target' : ''}`} aria-label={t.pool_title}>
          <header className="tier-pool-header">
            <h2 className="tier-pool-title">{t.pool_title}</h2>
            <span className="tier-pool-count">{t.pool_count.replace('{count}', String(board.pool.length))}</span>
          </header>
          <TierDropZone containerId={POOL_ID} items={board.pool} className="tier-pool-items" label={t.pool_title}>
            {board.pool.length === 0 && <p className="tier-pool-empty">{t.pool_empty}</p>}
            {renderTiles(POOL_ID, board.pool)}
          </TierDropZone>
        </section>
      </div>

      {typeof document !== 'undefined' && createPortal(
        <DragOverlay dropAnimation={null}>
          {activeId && (
            <div className="tier-tile tier-tile--overlay" style={style}>
              <TierTileFace id={activeId} meta={meta.get(activeId)} thumbSize={settings.thumbSize} showTitle={settings.showTitles} untitled={untitled} />
              {carried.length > 1 && <span className="tier-tile-count">{carried.length}</span>}
            </div>
          )}
        </DragOverlay>,
        document.body,
      )}
    </DndContext>
  );
}
