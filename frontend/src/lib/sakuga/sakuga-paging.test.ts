import { describe, expect, it } from 'vitest';
import type { SakugaPost, SakugaPostPage } from '../tauri/sakuga';
import {
  EMPTY_SAKUGA_PAGER,
  applySakugaPage,
  humanizeSakugaTag,
  isSakugaEndReached,
  isSakugaStaffRole,
  mergeSakugaPosts,
  nextSakugaPageRequest,
  orderSakugaRows,
  sakugaPostSeries,
  sakugaRowColumns,
  sakugaRowPage,
  sakugaRowPageCount,
  sakugaSeriesChips,
  sakugaSeriesTitles,
} from './sakuga-paging';

function post(id: number, score = 0): SakugaPost {
  return {
    id, score, tags: '', rating: 's', source: '', fileUrl: `https://x/${id}.mp4`, fileExt: 'mp4',
    previewUrl: '', width: 0, height: 0, fileSize: 0, createdAt: 0,
  };
}

function page(ids: number[], total: number, pageNo: number, limit: number, rawCount = ids.length): SakugaPostPage {
  return { posts: ids.map(id => post(id)), total, page: pageNo, limit, rawCount };
}

describe('nextSakugaPageRequest', () => {
  it('starts small, then continues with pages of 24 that line up with what is loaded', () => {
    expect(nextSakugaPageRequest(0)).toEqual({ page: 1, limit: 12 });
    expect(nextSakugaPageRequest(12)).toEqual({ page: 2, limit: 12 });
    expect(nextSakugaPageRequest(24)).toEqual({ page: 2, limit: 24 });
    expect(nextSakugaPageRequest(48)).toEqual({ page: 3, limit: 24 });
    expect(nextSakugaPageRequest(36)).toEqual({ page: 4, limit: 12 });
  });

  it('never skips or repeats a row: each request starts at the loaded count', () => {
    let fetched = 0;
    for (let i = 0; i < 6; i++) {
      const request = nextSakugaPageRequest(fetched)!;
      expect((request.page - 1) * request.limit).toBe(fetched);
      fetched += request.limit;
    }
  });

  it('has nothing after a short page', () => {
    expect(nextSakugaPageRequest(17)).toBeNull();
  });

  it('can page a creator grid 24 at a time from the start', () => {
    expect(nextSakugaPageRequest(0, 24, 24)).toEqual({ page: 1, limit: 24 });
    expect(nextSakugaPageRequest(24, 24, 24)).toEqual({ page: 2, limit: 24 });
  });
});

describe('end of list', () => {
  it('ends when the total is reached or a page comes back short', () => {
    expect(isSakugaEndReached(12, 30, { rawCount: 12, limit: 12 })).toBe(false);
    expect(isSakugaEndReached(30, 30, { rawCount: 6, limit: 24 })).toBe(true);
    expect(isSakugaEndReached(20, 50, { rawCount: 8, limit: 12 })).toBe(true);
    expect(isSakugaEndReached(0, 0, { rawCount: 0, limit: 12 })).toBe(true);
  });

  it('walks a 40-clip list to the end in three requests', () => {
    let state = EMPTY_SAKUGA_PAGER;
    const ids = Array.from({ length: 40 }, (_, i) => i + 1);
    const requests: string[] = [];
    while (!state.done) {
      const request = nextSakugaPageRequest(state.fetched)!;
      requests.push(`${request.page}x${request.limit}`);
      const start = (request.page - 1) * request.limit;
      state = applySakugaPage(state, page(ids.slice(start, start + request.limit), 40, request.page, request.limit));
    }
    expect(requests).toEqual(['1x12', '2x12', '2x24']);
    expect(state.posts.map(p => p.id)).toEqual(ids);
    expect(state.total).toBe(40);
  });

  it('counts rows the rating filter removed, so the next offset stays right', () => {
    const state = applySakugaPage(EMPTY_SAKUGA_PAGER, page([1, 2], 30, 1, 12, 12));
    expect(state.fetched).toBe(12);
    expect(state.done).toBe(false);
    expect(nextSakugaPageRequest(state.fetched)).toEqual({ page: 2, limit: 12 });
  });

  it('stops quietly when a fetch fails', () => {
    const state = applySakugaPage({ ...EMPTY_SAKUGA_PAGER, posts: [post(1)], fetched: 12, total: 50 }, null);
    expect(state.done).toBe(true);
    expect(state.posts).toHaveLength(1);
  });

  it('drops posts already listed when votes shift between pages', () => {
    expect(mergeSakugaPosts([post(1), post(2)], [post(2), post(3)]).map(p => p.id)).toEqual([1, 2, 3]);
  });
});

describe('one-row pages', () => {
  it('fits as many work-card-sized clips as the width allows', () => {
    // Full content width: about 6 at 1920, 4 at 1400.
    expect(sakugaRowColumns(1150)).toBe(6);
    expect(sakugaRowColumns(754)).toBe(4);
    expect(sakugaRowColumns(331)).toBe(1);
    expect(sakugaRowColumns(332)).toBe(2);
    expect(sakugaRowColumns(160)).toBe(1);
    expect(sakugaRowColumns(0)).toBe(1);
  });

  it('keeps the first visible clip on screen when the column count changes', () => {
    // Page 3 of 6 per page starts at clip 12; with 7 per page that is page 2.
    expect(sakugaRowPage(12, 6)).toBe(3);
    expect(sakugaRowPage(12, 7)).toBe(2);
    expect(sakugaRowPage(0, 7)).toBe(1);
  });

  it('counts pages from the total, one page when unknown', () => {
    expect(sakugaRowPageCount(17, 6)).toBe(3);
    expect(sakugaRowPageCount(18, 6)).toBe(3);
    expect(sakugaRowPageCount(null, 6)).toBe(1);
    expect(sakugaRowPageCount(0, 6)).toBe(1);
  });
});

describe('orderSakugaRows', () => {
  it('sorts loaded rows by their best clip, keeps waiting rows after, drops empty ones', () => {
    const rows = [
      { key: 'a', order: 0, status: 'ready' as const, bestScore: 120 },
      { key: 'b', order: 1, status: 'pending' as const, bestScore: null },
      { key: 'c', order: 2, status: 'ready' as const, bestScore: 900 },
      { key: 'd', order: 3, status: 'empty' as const, bestScore: null },
      { key: 'e', order: 4, status: 'ready' as const, bestScore: 120 },
      { key: 'f', order: 5, status: 'pending' as const, bestScore: null },
    ];
    expect(orderSakugaRows(rows).map(r => r.key)).toEqual(['c', 'a', 'e', 'b', 'f']);
  });
});

describe('roles, tags and titles', () => {
  it('keeps the animation roles only', () => {
    for (const role of ['Key Animation (eps 1, 5)', 'Action Animation Director', 'Chief Animation Director', 'Animation Director (ep 3)', 'Effects Animation', 'Storyboard (OP)', '2nd Key Animation']) {
      expect(isSakugaStaffRole(role)).toBe(true);
    }
    for (const role of ['Director', 'Music', 'Character Design', 'In-Between Animation', null, undefined]) {
      expect(isSakugaStaffRole(role)).toBe(false);
    }
  });

  it('humanizes tag names', () => {
    expect(humanizeSakugaTag('my_hero_academia_series')).toBe('My Hero Academia');
    expect(humanizeSakugaTag('fullmetal_alchemist_(2003)')).toBe('Fullmetal Alchemist (2003)');
  });

  it('labels a post with its most frequent known series', () => {
    const series = ['bleach_series', 'bleach', 'cowboy_bebop'];
    expect(sakugaPostSeries('animated bleach bleach_series effects', series)).toBe('Bleach');
    expect(sakugaPostSeries('animated cowboy_bebop', series)).toBe('Cowboy Bebop');
    expect(sakugaPostSeries('animated', series)).toBeNull();
    expect(sakugaPostSeries('bleach', [])).toBeNull();
  });

  it('collapses a series into its all-seasons tag', () => {
    const chips = sakugaSeriesChips([
      { name: 'my_hero_academia_series', count: 42 },
      { name: 'my_hero_academia', count: 41 },
      { name: 'cowboy_bebop', count: 30 },
      { name: 'ghost', count: 0 },
    ]);
    expect(chips.map(c => c.name)).toEqual(['my_hero_academia_series', 'cowboy_bebop']);
  });

  it('lists romaji first, each title with and without its season suffix', () => {
    const titles = sakugaSeriesTitles({ titleRomaji: 'Sousou no Frieren 2nd Season', titleEnglish: "Frieren: Beyond Journey's End Season 2", titleMain: 'Sousou no Frieren 2nd Season' });
    expect(titles[0]).toBe('Sousou no Frieren 2nd Season');
    expect(titles).toContain('Sousou no Frieren');
    expect(titles.indexOf('Sousou no Frieren')).toBeLessThan(titles.findIndex(t => t.startsWith('Frieren')));
    expect(new Set(titles.map(t => t.toLowerCase())).size).toBe(titles.length);
  });
});
