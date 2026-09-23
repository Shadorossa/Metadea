import { describe, expect, it } from 'vitest';
import {
  POOL_ID, addRow, addToPool, boardFromDetail, boardItemIds, boardToSaveItems, boardToTierDefs, clearRow,
  containerIds, emptyBoard, findContainer, moveItems, moveRow, orderedSelection, removeItems, removeRow,
  resetBoard, resolveDropAnchor, rowToPool, sendToPool, updateRow, type TierBoard, type TierItemMeta,
} from './tier-board';
import { DEFAULT_TIER_ROWS, TIER_LABEL_MAX_LENGTH } from './tier-palette';

function board(): TierBoard {
  const b = emptyBoard(DEFAULT_TIER_ROWS.slice(0, 3)); // s, a, b
  return {
    rows: b.rows.map(r => ({ ...r, items: r.id === 's' ? ['x1', 'x2'] : r.id === 'a' ? ['y1'] : [] })),
    pool: ['p1', 'p2', 'p3'],
  };
}

const items = (b: TierBoard, id: string) => (id === POOL_ID ? b.pool : b.rows.find(r => r.id === id)!.items);

describe('moveItems', () => {
  it('moves an item from the pool to the end of a row', () => {
    const next = moveItems(board(), ['p2'], 'a');
    expect(items(next, 'a')).toEqual(['y1', 'p2']);
    expect(next.pool).toEqual(['p1', 'p3']);
  });

  it('inserts before an anchor item', () => {
    const next = moveItems(board(), ['p1'], 's', 'x2');
    expect(items(next, 's')).toEqual(['x1', 'p1', 'x2']);
  });

  it('reorders within a row', () => {
    const next = moveItems(board(), ['x2'], 's', 'x1');
    expect(items(next, 's')).toEqual(['x2', 'x1']);
  });

  it('moves between rows', () => {
    const next = moveItems(board(), ['x1'], 'b');
    expect(items(next, 's')).toEqual(['x2']);
    expect(items(next, 'b')).toEqual(['x1']);
    expect(findContainer(next, 'x1')).toBe('b');
  });

  it('moves a multi-selection as one block in board order', () => {
    const next = moveItems(board(), ['p3', 'x1', 'y1'], 'b');
    expect(items(next, 'b')).toEqual(['x1', 'y1', 'p3']);
    expect(boardItemIds(next).sort()).toEqual(boardItemIds(board()).sort());
  });

  it('falls back to append when the anchor is itself moving', () => {
    const next = moveItems(board(), ['x1', 'x2'], 's', 'x2');
    expect(items(next, 's')).toEqual(['x1', 'x2']);
  });

  it('returns the same board for a no-op or an unknown target', () => {
    const b = board();
    expect(moveItems(b, ['x2'], 's')).toBe(b);
    expect(moveItems(b, ['p1'], 'nope')).toBe(b);
    expect(moveItems(b, ['ghost'], 's')).toBe(b);
  });

  it('sends items to the pool (double-click)', () => {
    const next = sendToPool(board(), ['x1']);
    expect(next.pool).toEqual(['p1', 'p2', 'p3', 'x1']);
  });
});

describe('resolveDropAnchor', () => {
  const target = ['a', 'b', 'c', 'd'];
  it('lands before or after the item under the pointer', () => {
    expect(resolveDropAnchor(target, new Set(['z']), 'b', false)).toBe('b');
    expect(resolveDropAnchor(target, new Set(['z']), 'b', true)).toBe('c');
    expect(resolveDropAnchor(target, new Set(['z']), 'd', true)).toBeNull();
  });
  it('skips moving items and handles containers', () => {
    expect(resolveDropAnchor(target, new Set(['b', 'c']), 'b', false)).toBe('d');
    expect(resolveDropAnchor(target, new Set(), null, false)).toBeNull();
    expect(resolveDropAnchor(target, new Set(), 'row-id', false)).toBeNull();
  });
});

describe('pool', () => {
  it('dedupes against the board and within the input', () => {
    const { board: next, added } = addToPool(board(), ['x1', 'n1', 'n1', 'p2', 'n2', '']);
    expect(added).toEqual(['n1', 'n2']);
    expect(next.pool).toEqual(['p1', 'p2', 'p3', 'n1', 'n2']);
  });
  it('keeps the same board when nothing is new', () => {
    const b = board();
    expect(addToPool(b, ['x1']).board).toBe(b);
  });
  it('removes items anywhere', () => {
    const next = removeItems(board(), ['x1', 'p3']);
    expect(boardItemIds(next)).toEqual(['x2', 'y1', 'p1', 'p2']);
    const b = board();
    expect(removeItems(b, ['ghost'])).toBe(b);
  });
  it('orders a selection by board position', () => {
    expect(orderedSelection(board(), new Set(['p1', 'y1', 'ghost']))).toEqual(['y1', 'p1']);
  });
});

describe('rows', () => {
  it('adds a row with the next palette colour and a unique id', () => {
    const { board: next, rowId } = addRow(board(), 1);
    expect(next.rows.map(r => r.id)).toEqual(['s', rowId, 'a', 'b']);
    expect(next.rows[1].color).toBe('#ffbf7f');
    expect(containerIds(next)).toContain(POOL_ID);
  });

  it('removes a row and returns its items to the pool', () => {
    const next = removeRow(board(), 's');
    expect(next.rows.map(r => r.id)).toEqual(['a', 'b']);
    expect(next.pool).toEqual(['p1', 'p2', 'p3', 'x1', 'x2']);
    const b = board();
    expect(removeRow(b, 'nope')).toBe(b);
  });

  it('reorders rows with clamping', () => {
    expect(moveRow(board(), 's', 5).rows.map(r => r.id)).toEqual(['a', 'b', 's']);
    expect(moveRow(board(), 'b', -3).rows.map(r => r.id)).toEqual(['b', 's', 'a']);
    const b = board();
    expect(moveRow(b, 's', 0)).toBe(b);
  });

  it('edits label and colour, clamping the label length', () => {
    const next = updateRow(board(), 'a', { label: 'x'.repeat(100), color: '#123456' });
    expect(next.rows[1].label).toHaveLength(TIER_LABEL_MAX_LENGTH);
    expect(next.rows[1].color).toBe('#123456');
    const b = board();
    expect(updateRow(b, 'a', { label: 'A' })).toBe(b);
  });

  it('clears a row (items leave the list) or sends it to the pool', () => {
    expect(boardItemIds(clearRow(board(), 's'))).toEqual(['y1', 'p1', 'p2', 'p3']);
    expect(rowToPool(board(), 's').pool).toEqual(['p1', 'p2', 'p3', 'x1', 'x2']);
    expect(resetBoard(board()).rows.every(r => r.items.length === 0)).toBe(true);
  });
});

describe('persistence', () => {
  it('rebuilds a board from saved placements, sending orphans to the pool', () => {
    const b = boardFromDetail(DEFAULT_TIER_ROWS.slice(0, 2), [
      { external_id: 'a2', tier_key: 's', position: 1, title_main: null, cover_url: null, media_type: null },
      { external_id: 'a1', tier_key: 's', position: 0, title_main: null, cover_url: null, media_type: null },
      { external_id: 'o1', tier_key: 'deleted-row', position: 0, title_main: null, cover_url: null, media_type: null },
      { external_id: 'p1', tier_key: 'pool', position: 0, title_main: null, cover_url: null, media_type: null },
    ]);
    expect(b.rows[0].items).toEqual(['a1', 'a2']);
    expect(b.pool.sort()).toEqual(['o1', 'p1']);
  });

  it('serialises rows then pool with dense positions and meta snapshots', () => {
    const meta = new Map<string, TierItemMeta>([['x1', { title: 'X one', cover: 'c.jpg', type: 'anime' }]]);
    const saved = boardToSaveItems(board(), meta);
    expect(saved.map(s => [s.external_id, s.tier_key, s.position])).toEqual([
      ['x1', 's', 0], ['x2', 's', 1], ['y1', 'a', 0], ['p1', 'pool', 0], ['p2', 'pool', 1], ['p3', 'pool', 2],
    ]);
    expect(saved[0]).toMatchObject({ title: 'X one', cover_url: 'c.jpg', media_type: 'anime' });
    expect(saved[1].title).toBeNull();
    expect(boardToTierDefs(board())[0]).toEqual({ id: 's', label: 'S', color: '#ff7f7f' });
  });
});
