import { describe, expect, it } from 'vitest';
import { tierShareData } from './tier-share';
import type { TierBoard, TierItemMeta } from './tier-board';

const board: TierBoard = {
  rows: [
    { id: 's', label: 'S', color: '#ff7f7f', items: ['a', 'b'] },
    { id: 'x', label: 'Meh', color: '#3b3b3b', items: [] },
  ],
  pool: ['p1', 'p2', 'p3'],
};

const meta = new Map<string, TierItemMeta>([
  ['a', { title: 'Alpha', cover: 'https://img/a.jpg', type: 'anime' }],
  ['b', { title: null, cover: null, type: null }],
]);

describe('tierShareData', () => {
  it('maps rows in order with their colours, label text colour and the pool count', () => {
    const data = tierShareData(board, meta, { title: 'Best', description: 'Desc' });
    expect(data).toMatchObject({ title: 'Best', description: 'Desc', unplacedCount: 3 });
    expect(data.tiers.map(t => [t.label, t.color, t.textColor])).toEqual([
      ['S', '#ff7f7f', '#111111'],
      ['Meh', '#3b3b3b', '#f7f7f7'],
    ]);
    expect(data.tiers[1].items).toEqual([]);
  });

  it('falls back to the id for untitled items and null for missing covers', () => {
    const [tier] = tierShareData(board, meta, { title: '', description: '' }).tiers;
    expect(tier.items).toEqual([
      { title: 'Alpha', coverUrl: 'https://img/a.jpg', externalId: 'a' },
      { title: 'b', coverUrl: null, externalId: 'b' },
    ]);
  });

  it('runs covers through the resolver, only when there is one', () => {
    const seen: string[] = [];
    const resolveCover = (id: string, cover: string) => { seen.push(id); return `asset://${cover}`; };
    const [tier] = tierShareData(board, meta, { title: 'T', description: '', resolveCover }).tiers;
    expect(tier.items[0].coverUrl).toBe('asset://https://img/a.jpg');
    expect(tier.items[1].coverUrl).toBeNull();
    expect(seen).toEqual(['a']);
  });
});
