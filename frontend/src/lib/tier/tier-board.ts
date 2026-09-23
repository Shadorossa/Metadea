// Pure placement logic for the tier editor: a board is its rows (label,
// colour, ordered item ids) plus the unranked pool. Every operation returns
// a new board (or the same object when nothing changed, so the editor can
// skip an undo step), and keeps the one invariant the save relies on: an id
// lives in exactly one container.
import type { TierDef, TierItemSave, TierListItemFull } from '../tauri/tier-lists';
import { nextRowColor, newRowId, TIER_LABEL_MAX_LENGTH } from './tier-palette';

export const POOL_ID = 'pool';

export interface TierRow extends TierDef {
  items: string[];
}

export interface TierBoard {
  rows: TierRow[];
  pool: string[];
}

export interface TierItemMeta {
  title: string | null;
  cover: string | null;
  type: string | null;
}

export function emptyBoard(rows: readonly TierDef[]): TierBoard {
  return { rows: rows.map(r => ({ ...r, items: [] })), pool: [] };
}

export function containerIds(board: TierBoard): string[] {
  return [...board.rows.map(r => r.id), POOL_ID];
}

export function containerItems(board: TierBoard, containerId: string): string[] {
  if (containerId === POOL_ID) return board.pool;
  return board.rows.find(r => r.id === containerId)?.items ?? [];
}

export function findContainer(board: TierBoard, itemId: string): string | null {
  if (board.pool.includes(itemId)) return POOL_ID;
  return board.rows.find(r => r.items.includes(itemId))?.id ?? null;
}

/** Every id on the board, rows top to bottom, then the pool. */
export function boardItemIds(board: TierBoard): string[] {
  return [...board.rows.flatMap(r => r.items), ...board.pool];
}

/** `ids` that are on the board, in board order (a multi-selection moves as
 *  one block in the order the user sees it, not the order it was clicked). */
export function orderedSelection(board: TierBoard, ids: Iterable<string>): string[] {
  const wanted = new Set(ids);
  return boardItemIds(board).filter(id => wanted.has(id));
}

function hasContainer(board: TierBoard, containerId: string): boolean {
  return containerId === POOL_ID || board.rows.some(r => r.id === containerId);
}

function withContainer(board: TierBoard, containerId: string, items: string[]): TierBoard {
  if (containerId === POOL_ID) return { ...board, pool: items };
  return { ...board, rows: board.rows.map(r => (r.id === containerId ? { ...r, items } : r)) };
}

function withoutItems(board: TierBoard, remove: ReadonlySet<string>): TierBoard {
  const strip = (items: string[]) => (items.some(id => remove.has(id)) ? items.filter(id => !remove.has(id)) : items);
  return { rows: board.rows.map(r => { const items = strip(r.items); return items === r.items ? r : { ...r, items }; }), pool: strip(board.pool) };
}

function sameOrder(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}

/**
 * Moves `ids` (as one block, in board order) into `to`, before `beforeId`
 * — or at the end when `beforeId` is null, not in `to`, or itself moving.
 */
export function moveItems(board: TierBoard, ids: Iterable<string>, to: string, beforeId: string | null = null): TierBoard {
  const moving = orderedSelection(board, ids);
  if (moving.length === 0 || !hasContainer(board, to)) return board;
  const movingSet = new Set(moving);
  const stripped = withoutItems(board, movingSet);
  const target = containerItems(stripped, to);
  const anchor = beforeId !== null && !movingSet.has(beforeId) ? target.indexOf(beforeId) : -1;
  const index = anchor < 0 ? target.length : anchor;
  const next = [...target.slice(0, index), ...moving, ...target.slice(index)];
  if (sameOrder(next, containerItems(board, to)) && moving.every(id => findContainer(board, id) === to)) return board;
  return withContainer(stripped, to, next);
}

/**
 * The item a drop should land before. `overId` is the tile under the
 * pointer (null/container id = append); `placeAfter` puts the block after
 * it. Items that are themselves moving are skipped, so dropping a
 * selection onto one of its own members still resolves.
 */
export function resolveDropAnchor(targetItems: readonly string[], moving: ReadonlySet<string>, overId: string | null, placeAfter: boolean): string | null {
  if (overId === null) return null;
  const overIndex = targetItems.indexOf(overId);
  if (overIndex < 0) return null;
  for (let i = overIndex + (placeAfter ? 1 : 0); i < targetItems.length; i++) {
    if (!moving.has(targetItems[i])) return targetItems[i];
  }
  return null;
}

export function sendToPool(board: TierBoard, ids: Iterable<string>): TierBoard {
  return moveItems(board, ids, POOL_ID);
}

/** Appends ids to the pool, skipping any already on the board (or repeated
 *  in `ids`). `added` is what actually went in. */
export function addToPool(board: TierBoard, ids: Iterable<string>): { board: TierBoard; added: string[] } {
  const present = new Set(boardItemIds(board));
  const added: string[] = [];
  for (const id of ids) {
    if (!id || present.has(id)) continue;
    present.add(id);
    added.push(id);
  }
  return added.length ? { board: { ...board, pool: [...board.pool, ...added] }, added } : { board, added };
}

export function removeItems(board: TierBoard, ids: Iterable<string>): TierBoard {
  const remove = new Set(ids);
  if (!boardItemIds(board).some(id => remove.has(id))) return board;
  return withoutItems(board, remove);
}

// ── Rows ────────────────────────────────────────────────────────────────

/** Inserts a new row at `index` (default: last); returns the board and the
 *  new row's id. */
export function addRow(board: TierBoard, index = board.rows.length, patch: Partial<TierDef> = {}): { board: TierBoard; rowId: string } {
  const at = Math.max(0, Math.min(index, board.rows.length));
  const rowId = newRowId(board.rows.map(r => r.id));
  const row: TierRow = {
    id: rowId,
    label: patch.label ?? '',
    color: patch.color ?? nextRowColor(board.rows[at - 1]?.color),
    items: [],
  };
  return { board: { ...board, rows: [...board.rows.slice(0, at), row, ...board.rows.slice(at)] }, rowId };
}

/** Deletes a row; its items go back to the end of the pool. */
export function removeRow(board: TierBoard, rowId: string): TierBoard {
  const row = board.rows.find(r => r.id === rowId);
  if (!row) return board;
  return { rows: board.rows.filter(r => r.id !== rowId), pool: [...board.pool, ...row.items] };
}

export function moveRow(board: TierBoard, rowId: string, toIndex: number): TierBoard {
  const from = board.rows.findIndex(r => r.id === rowId);
  const to = Math.max(0, Math.min(toIndex, board.rows.length - 1));
  if (from < 0 || from === to) return board;
  const rows = [...board.rows];
  const [row] = rows.splice(from, 1);
  rows.splice(to, 0, row);
  return { ...board, rows };
}

export function updateRow(board: TierBoard, rowId: string, patch: Partial<Pick<TierDef, 'label' | 'color'>>): TierBoard {
  const row = board.rows.find(r => r.id === rowId);
  if (!row) return board;
  const label = patch.label !== undefined ? patch.label.slice(0, TIER_LABEL_MAX_LENGTH) : row.label;
  const color = patch.color ?? row.color;
  if (label === row.label && color === row.color) return board;
  return { ...board, rows: board.rows.map(r => (r.id === rowId ? { ...r, label, color } : r)) };
}

/** Removes the row's items from the tier list altogether. */
export function clearRow(board: TierBoard, rowId: string): TierBoard {
  return removeItems(board, board.rows.find(r => r.id === rowId)?.items ?? []);
}

/** Sends the row's items back to the pool, keeping them in the list. */
export function rowToPool(board: TierBoard, rowId: string): TierBoard {
  return sendToPool(board, board.rows.find(r => r.id === rowId)?.items ?? []);
}

/** Every ranked item back to the pool (TierMaker's "reset"). */
export function resetBoard(board: TierBoard): TierBoard {
  return sendToPool(board, board.rows.flatMap(r => r.items));
}

// ── Persistence ─────────────────────────────────────────────────────────

export function boardFromDetail(tiers: readonly TierDef[], items: readonly TierListItemFull[]): TierBoard {
  const board = emptyBoard(tiers);
  const byKey = new Map<string, TierListItemFull[]>();
  for (const item of items) {
    const key = hasContainer(board, item.tier_key) ? item.tier_key : POOL_ID;
    byKey.set(key, [...(byKey.get(key) ?? []), item]);
  }
  const ordered = (key: string) => (byKey.get(key) ?? []).sort((a, b) => a.position - b.position).map(i => i.external_id);
  return {
    rows: board.rows.map(r => ({ ...r, items: ordered(r.id) })),
    pool: [...new Set(ordered(POOL_ID))],
  };
}

export function boardToTierDefs(board: TierBoard): TierDef[] {
  return board.rows.map(({ id, label, color }) => ({ id, label, color }));
}

export function boardToSaveItems(board: TierBoard, meta: ReadonlyMap<string, TierItemMeta>): TierItemSave[] {
  const toSave = (key: string, ids: string[]) => ids.map((id, position) => {
    const m = meta.get(id);
    return { external_id: id, tier_key: key, position, title: m?.title ?? null, cover_url: m?.cover ?? null, media_type: m?.type ?? null };
  });
  return [...board.rows.flatMap(r => toSave(r.id, r.items)), ...toSave(POOL_ID, board.pool)];
}
