import { describe, it, expect } from 'vitest';
import type { MediaEpisode } from '../../tauri';
import {
  applyGlobalRangeToItems, buildDisplayUnits, canGroupUnits, flattenUnits, formatRange, getUnifiedEpisodes,
  getUnitGlobalRange, groupUnits, reorderUnits, resolveEpisodeClickRange, sortBySagaOrder,
  type StoryArcDisplayUnit, type StoryArcEditingItem,
} from './story-arc-units';

const item = (id: string, overrides: Partial<StoryArcEditingItem> = {}): StoryArcEditingItem => ({
  media_external_id: id, title: id.toUpperCase(), cover: null, ep_start: null, ep_end: null, group_id: null, ...overrides,
});

const episode = (episode_number: number, name: string | null = null): MediaEpisode => ({
  episode_number, name, cover_url: null,
} as unknown as MediaEpisode);

const solo = (id: string, overrides: Partial<StoryArcEditingItem> = {}): StoryArcDisplayUnit => ({
  id, isGroup: false, groupId: null, items: [item(id, overrides)],
});

describe('formatRange', () => {
  it('formats closed, open and empty ranges', () => {
    expect(formatRange({ ep_start: 1, ep_end: 5 })).toBe('1-5');
    expect(formatRange({ ep_start: 3, ep_end: null })).toBe('3+');
    expect(formatRange({ ep_start: null, ep_end: 4 })).toBe('');
  });
});

describe('sortBySagaOrder', () => {
  it('orders chain members by the chain and puts outsiders last', () => {
    const out = sortBySagaOrder([item('x'), item('b'), item('a')], ['a', 'b']);
    expect(out.map(i => i.media_external_id)).toEqual(['a', 'b', 'x']);
  });

  it('is the identity for a chain of one', () => {
    const list = [item('b'), item('a')];
    expect(sortBySagaOrder(list, ['a'])).toBe(list);
  });
});

describe('buildDisplayUnits', () => {
  it('folds items that share a group_id into one unit, sorted by the saga', () => {
    const units = buildDisplayUnits([item('b', { group_id: 'g' }), item('x'), item('a', { group_id: 'g' })], ['a', 'b']);
    expect(units.map(u => u.id)).toEqual(['g', 'x']);
    expect(units[0].isGroup).toBe(true);
    expect(units[0].items.map(i => i.media_external_id)).toEqual(['a', 'b']);
    expect(units[1].isGroup).toBe(false);
  });

  it('treats a lone grouped item as a non-group unit that keeps its group id', () => {
    const [unit] = buildDisplayUnits([item('a', { group_id: 'g' })]);
    expect(unit).toMatchObject({ id: 'g', isGroup: false, groupId: 'g' });
  });
});

describe('canGroupUnits', () => {
  it('requires both units fully inside a chain of at least two', () => {
    expect(canGroupUnits(solo('a'), solo('b'), ['a', 'b'])).toBe(true);
    expect(canGroupUnits(solo('a'), solo('x'), ['a', 'b'])).toBe(false);
    expect(canGroupUnits(solo('a'), solo('b'), ['a'])).toBe(false);
    expect(canGroupUnits(undefined, solo('b'), ['a', 'b'])).toBe(false);
  });
});

describe('getUnifiedEpisodes', () => {
  const group: StoryArcDisplayUnit = { id: 'g', isGroup: true, groupId: 'g', items: [item('s1'), item('s2')] };

  it('continues numbering across works and keeps per-season numbers', () => {
    const eps = getUnifiedEpisodes(group, { s1: [episode(2), episode(1, 'Pilot')], s2: [episode(1), episode(2)] });
    expect(eps.map(e => [e.mediaExternalId, e.generalEpNumber, e.seasonEpNumber])).toEqual([
      ['s1', 1, 1], ['s1', 2, 2], ['s2', 3, 1], ['s2', 4, 2],
    ]);
    expect(eps[0].name).toBe('Pilot');
  });

  it('keeps an already-global numbering when it is larger than the offset', () => {
    const eps = getUnifiedEpisodes(group, { s1: [episode(1), episode(2)], s2: [episode(10), episode(11)] });
    expect(eps.map(e => e.generalEpNumber)).toEqual([1, 2, 10, 11]);
  });

  it('drops specials (episode 0) and works without episodes', () => {
    const eps = getUnifiedEpisodes(group, { s1: [episode(0), episode(1)] });
    expect(eps).toHaveLength(1);
    expect(eps[0].mediaExternalId).toBe('s1');
  });
});

describe('getUnitGlobalRange', () => {
  const unit: StoryArcDisplayUnit = {
    id: 'g', isGroup: true, groupId: 'g', items: [item('s1', { ep_start: 2, ep_end: null }), item('s2', { ep_start: null, ep_end: 1 })],
  };
  const eps = getUnifiedEpisodes(unit, { s1: [episode(1), episode(2)], s2: [episode(1), episode(2)] });

  it('resolves per-work starts/ends into global numbers', () => {
    expect(getUnitGlobalRange(unit, eps)).toEqual({ globalStart: 2, globalEnd: 3 });
  });

  it('is empty without episodes', () => {
    expect(getUnitGlobalRange(unit, [])).toEqual({ globalStart: null, globalEnd: null });
  });
});

describe('applyGlobalRangeToItems', () => {
  const unit: StoryArcDisplayUnit = { id: 'g', isGroup: true, groupId: 'g', items: [item('s1'), item('s2')] };
  const eps = getUnifiedEpisodes(unit, { s1: [episode(1), episode(2)], s2: [episode(1), episode(2)] });
  const items = [item('other', { ep_start: 9, ep_end: 9 }), item('s1'), item('s2')];

  it('clamps the range onto each work and clears works outside it', () => {
    const out = applyGlobalRangeToItems(items, unit, eps, 2, 3);
    expect(out[0]).toEqual(items[0]);
    expect(out[1]).toMatchObject({ ep_start: 2, ep_end: 2 });
    expect(out[2]).toMatchObject({ ep_start: 3, ep_end: 3 });
    expect(applyGlobalRangeToItems(items, unit, eps, 1, 1)[2]).toMatchObject({ ep_start: null, ep_end: null });
  });

  it('accepts a reversed range and a start-only range', () => {
    expect(applyGlobalRangeToItems(items, unit, eps, 3, 2)[1]).toMatchObject({ ep_start: 2, ep_end: 2 });
    expect(applyGlobalRangeToItems(items, unit, eps, 4, null)[2]).toMatchObject({ ep_start: 4, ep_end: 4 });
  });

  it('clears the whole unit when both ends are null', () => {
    const out = applyGlobalRangeToItems([item('s1', { ep_start: 1, ep_end: 2 }), item('other', { ep_start: 5, ep_end: 6 })], unit, eps, null, null);
    expect(out[0]).toMatchObject({ ep_start: null, ep_end: null });
    expect(out[1]).toMatchObject({ ep_start: 5, ep_end: 6 });
  });
});

describe('resolveEpisodeClickRange', () => {
  it('plain click sets the start and keeps a later explicit end', () => {
    expect(resolveEpisodeClickRange(3, 2, 8, false)).toEqual({ start: 3, end: 8 });
    expect(resolveEpisodeClickRange(9, 2, 8, false)).toEqual({ start: 9, end: 9 });
    expect(resolveEpisodeClickRange(4, null, null, false)).toEqual({ start: 4, end: 4 });
  });

  it('ctrl click sets the end and pulls the start down when needed', () => {
    expect(resolveEpisodeClickRange(6, 2, 4, true)).toEqual({ start: 2, end: 6 });
    expect(resolveEpisodeClickRange(1, 2, 4, true)).toEqual({ start: 1, end: 1 });
    expect(resolveEpisodeClickRange(5, null, null, true)).toEqual({ start: 5, end: 5 });
  });
});

describe('reorderUnits / groupUnits / flattenUnits', () => {
  const units = [solo('a'), solo('b'), solo('c'), solo('x')];
  const saga = ['a', 'b', 'c'];

  it('reorders without mutating', () => {
    expect(reorderUnits(units, 0, 2).map(u => u.id)).toEqual(['b', 'c', 'a', 'x']);
    expect(units.map(u => u.id)).toEqual(['a', 'b', 'c', 'x']);
  });

  it('merges into the target slot with a fresh id, ordered by the saga', () => {
    const out = groupUnits(units, 2, 0, saga, () => 'new')!;
    expect(out.map(u => u.id)).toEqual(['new', 'b', 'x']);
    expect(out[0]).toMatchObject({ isGroup: true, groupId: 'new' });
    expect(out[0].items.map(i => [i.media_external_id, i.group_id])).toEqual([['a', 'new'], ['c', 'new']]);
    expect(flattenUnits(out).map(i => i.media_external_id)).toEqual(['a', 'c', 'b', 'x']);
  });

  it('accounts for the removed dragged unit when the target sits after it', () => {
    expect(groupUnits(units, 0, 2, saga, () => 'new')!.map(u => u.id)).toEqual(['b', 'new', 'x']);
  });

  it('reuses the target group id, then the dragged one', () => {
    const grouped: StoryArcDisplayUnit = { id: 'g', isGroup: true, groupId: 'g', items: [item('a', { group_id: 'g' }), item('b', { group_id: 'g' })] };
    expect(groupUnits([grouped, solo('c')], 1, 0, saga, () => 'new')![0].groupId).toBe('g');
    expect(groupUnits([grouped, solo('c')], 0, 1, saga, () => 'new')![0].groupId).toBe('g');
  });

  it('refuses pairs outside the chain', () => {
    expect(groupUnits(units, 0, 3, saga, () => 'new')).toBeNull();
    expect(groupUnits(units, 1, 1, saga, () => 'new')).toBeNull();
  });
});
