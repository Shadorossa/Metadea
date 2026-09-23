import { describe, it, expect } from 'vitest';
import { en } from '../../i18n/en';
import { es } from '../../i18n/es';
import {
  computeCreatorCompletion,
  creatorCompletionDetails,
  creatorCompletionHeadline,
  isCreatorCompletionVisible,
  workLibraryState,
  workProgressRatio,
  type CreatorWorkRef,
} from './creator-completion';

const lib = (entries: Record<string, string | null>) =>
  new Map(Object.entries(entries).map(([id, status]) => [id, { status }]));

const game = (n: number, extra: Partial<CreatorWorkRef> = {}): CreatorWorkRef => ({ externalId: `game:${n}`, type: 'game', ...extra });

describe('workLibraryState', () => {
  it('buckets every library status', () => {
    expect(workLibraryState(undefined)).toBe('missing');
    expect(workLibraryState({ status: null })).toBe('missing');
    expect(workLibraryState({ status: 'completed' })).toBe('completed');
    for (const s of ['watching', 'reading', 'playing', 'paused']) expect(workLibraryState({ status: s })).toBe('in_progress');
    expect(workLibraryState({ status: 'planning' })).toBe('planned');
    expect(workLibraryState({ status: 'dropped' })).toBe('dropped');
    expect(workLibraryState({ status: 'something-new' })).toBe('missing');
  });
});

describe('computeCreatorCompletion', () => {
  it('counts completed / in progress / planned over released works', () => {
    const works = [game(1), game(2), game(3), game(4), game(5), game(6)];
    const r = computeCreatorCompletion(works, lib({ 'game:1': 'completed', 'game:2': 'completed', 'game:3': 'playing', 'game:4': 'planning' }));
    expect(r).toMatchObject({ completed: 2, inProgress: 1, planned: 1, dropped: 0, total: 6, percent: 33, singleType: 'game' });
  });

  it('leaves unreleased works out unless the user already engaged with them', () => {
    const works = [game(1), game(2, { unreleased: true }), game(3, { unreleased: true })];
    const r = computeCreatorCompletion(works, lib({ 'game:1': 'completed', 'game:3': 'completed' }));
    expect(r.total).toBe(2);
    expect(r.completed).toBe(2);
    expect(r.unreleasedExcluded).toBe(1);
    expect(r.percent).toBe(100);
  });

  it('reads the release state from catalog rows when the provider gave none', () => {
    const catalogById = new Map([['anime:9', { status: 'NOT_YET_RELEASED' }]]);
    const works = [{ externalId: 'anime:1', type: 'anime' }, { externalId: 'anime:9', type: 'anime' }];
    const r = computeCreatorCompletion(works, lib({ 'anime:1': 'completed' }), { catalogById });
    expect(r.total).toBe(1);
    expect(r.unreleasedExcluded).toBe(1);
  });

  it('excludes DLC and bundles unless included', () => {
    const works = [game(1), game(2, { isExtra: true })];
    const library = lib({ 'game:1': 'completed', 'game:2': 'completed' });
    expect(computeCreatorCompletion(works, library)).toMatchObject({ total: 1, extrasExcluded: 1, percent: 100 });
    expect(computeCreatorCompletion(works, library, { includeExtras: true })).toMatchObject({ total: 2, completed: 2, extrasExcluded: 0 });
  });

  it('deduplicates repeated ids and reports mixed types', () => {
    const works = [game(1), game(1), { externalId: 'vnovel:2', type: 'vnovel' }];
    const r = computeCreatorCompletion(works, lib({ 'game:1': 'completed' }));
    expect(r.total).toBe(2);
    expect(r.singleType).toBeNull();
    expect(r.percent).toBe(50);
  });

  it('handles an empty list', () => {
    const r = computeCreatorCompletion([], lib({}));
    expect(r).toMatchObject({ total: 0, percent: 0, singleType: null });
    expect(isCreatorCompletionVisible(r)).toBe(false);
  });

  it('is hidden when the user has none of the works', () => {
    expect(isCreatorCompletionVisible(computeCreatorCompletion([game(1), game(2)], lib({})))).toBe(false);
    expect(isCreatorCompletionVisible(computeCreatorCompletion([game(1), game(2)], lib({ 'game:2': 'planning' })))).toBe(true);
    expect(isCreatorCompletionVisible(computeCreatorCompletion([game(1)], lib({ 'game:1': 'dropped' })))).toBe(true);
  });
});

describe('creatorCompletionHeadline', () => {
  it('uses the type-aware verb for a single-type company', () => {
    const r = computeCreatorCompletion([1, 2, 3, 4, 5, 6].map(n => game(n)), lib({
      'game:1': 'completed', 'game:2': 'completed', 'game:3': 'completed', 'game:4': 'completed', 'game:5': 'completed',
    }));
    expect(creatorCompletionHeadline(r, 'company', 'FromSoftware', en.creator_completion)).toBe("You've played 5 of 6 FromSoftware games");
    expect(creatorCompletionHeadline(r, 'company', 'FromSoftware', es.creator_completion)).toBe('Has jugado 5 de 6 juegos de FromSoftware');
  });

  it('says "works by" for an author with mixed types', () => {
    const works: CreatorWorkRef[] = [
      ...[1, 2, 3, 4, 5, 6, 7, 8].map(n => ({ externalId: `manga:${n}`, type: 'manga' })),
      { externalId: 'anime:1', type: 'anime' },
      { externalId: 'anime:2', type: 'anime' },
    ];
    const done = Object.fromEntries(['manga:1', 'manga:2', 'manga:3', 'manga:4', 'manga:5', 'manga:6', 'anime:1'].map(id => [id, 'completed']));
    const r = computeCreatorCompletion(works, lib(done));
    expect(r.percent).toBe(70);
    expect(creatorCompletionHeadline(r, 'author', 'Naoki Urasawa', en.creator_completion)).toBe("You've completed 7 of 10 works by Naoki Urasawa");
  });

  it('has a typed headline for every media type in both families', () => {
    for (const type of ['anime', 'manga', 'lnovel', 'game', 'vnovel', 'movie', 'series', 'book', 'comic']) {
      const r = computeCreatorCompletion([{ externalId: `${type}:1`, type }], lib({ [`${type}:1`]: 'completed' }));
      for (const kind of ['author', 'company'] as const) {
        const text = creatorCompletionHeadline(r, kind, 'X', en.creator_completion);
        expect(text).toContain('1 of 1');
        expect(text).not.toMatch(/\{\w+\}/);
      }
    }
    const film = computeCreatorCompletion([{ externalId: 'movie:1', type: 'movie' }], lib({ 'movie:1': 'completed' }));
    expect(creatorCompletionHeadline(film, 'company', 'Ghibli', en.creator_completion)).toBe("You've watched 1 of 1 Ghibli films");
  });

  it('falls back to the mixed headline for an unknown type', () => {
    const r = computeCreatorCompletion([{ externalId: 'event:1', type: 'event' }], lib({ 'event:1': 'completed' }));
    expect(creatorCompletionHeadline(r, 'company', 'X', en.creator_completion)).toBe("You've completed 1 of 1 X works");
  });
});

describe('creatorCompletionDetails', () => {
  it('lists the breakdown and what was left out', () => {
    const r = computeCreatorCompletion(
      [game(1), game(2), game(3, { unreleased: true }), game(4, { isExtra: true })],
      lib({ 'game:1': 'completed', 'game:2': 'playing' }),
    );
    expect(creatorCompletionDetails(r, en.creator_completion)).toEqual([
      '1 completed · 1 in progress · 0 planned',
      '1 unreleased (not counted)',
      '1 DLC or bundles (not counted)',
    ]);
  });
});

describe('workProgressRatio', () => {
  it('is null without a known length and clamped otherwise', () => {
    expect(workProgressRatio(undefined, 12)).toBeNull();
    expect(workProgressRatio({ progress: 3 }, null)).toBeNull();
    expect(workProgressRatio({ progress: 3 }, 0)).toBeNull();
    expect(workProgressRatio({ progress: 3 }, 12)).toBe(0.25);
    expect(workProgressRatio({ progress: 30 }, 12)).toBe(1);
    expect(workProgressRatio({ progress: -2 }, 12)).toBe(0);
  });
});
