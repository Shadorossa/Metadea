// The public /user page renders the owner's own profile sections with
// injected data + readOnly (UserProfileView). This pins that parity: with
// the same fixture, the owner render (readOnly=false) and the public render
// (readOnly=true) produce the same section order and the same classes,
// except for an explicit list of edit-only controls.
import { createElement, type ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it } from 'vitest';
import type { CatalogSummary, CharacterEntry, DayJourney, LibraryEntry, ListInfo } from '../../lib/tauri';

// preferences.ts reads localStorage at render time; node has none.
beforeAll(() => {
  const store = new Map<string, string>();
  (globalThis as { localStorage?: Storage }).localStorage = {
    getItem: key => store.get(key) ?? null,
    setItem: (key, value) => { store.set(key, String(value)); },
    removeItem: key => { store.delete(key); },
    clear: () => store.clear(),
    key: i => [...store.keys()][i] ?? null,
    get length() { return store.size; },
  };
});

function entry(external_id: string, status: string, rating: number | null, notes: string | null = null): LibraryEntry {
  return {
    id: external_id, user_id: '', external_id, type: external_id.split(':')[0], status, rating, rating_2: null,
    progress: 3, progress_2: 0, minutes_spent: 0, is_favorite: 0, is_platinum: 0, tags: null, notes,
    added_at: '2026-01-10', updated_at: '2026-02-01', selected_platform: null, selected_version: null,
    started_at: '2026-01-10', finished_at: status === 'completed' ? '2026-02-01' : null,
  } as LibraryEntry;
}

const items: LibraryEntry[] = [
  entry('anime:1', 'completed', 9, 'Loved it'),
  entry('anime:2', 'watching', null),
  entry('game:1', 'completed', 7),
  entry('manga:1', 'planning', null),
  entry('movie:1', 'dropped', 4, 'Not for me'),
];

const catalogMap = new Map<string, CatalogSummary>(items.map(i => [i.external_id, {
  external_id: i.external_id, type: i.type, title_main: `Title ${i.external_id}`, cover_url: null,
  format: null, total_count: 12, status: 'FINISHED', genres: ['Drama'],
} as unknown as CatalogSummary]));

const characterMap = new Map<string, CharacterEntry>([
  ['character:1', { external_id: 'character:1', name: 'Alice', image_url: null } as unknown as CharacterEntry],
]);

const journey: DayJourney[] = [
  { date: '2026-02-01', events: [{ externalId: 'anime:1', type: 'complete', mediaType: 'anime', timestamp: '2026-02-01T10:00:00Z' }] },
];

const favorites = { multimedia: ['anime:1', 'game:1'], character: ['character:1'], anime: ['anime:1'], game: ['game:1'] };
const monthlyHistory = { '2026-02': ['anime:1'], '2026-01': ['game:1'] };
const lists: ListInfo[] = [
  { key: 'l1', name: 'Best of', description: 'Top picks', is_fav: false, is_private: false, item_count: 2, preview_ids: ['anime:1', 'game:1'] },
];

// Controls that only exist for the owner (skipped with their whole
// subtree). Anything else that differs is a parity regression.
const EDIT_ONLY_CLASSES = new Set([
  'fav-reorder-btn', // Favorites: reorder toggle
  'fav-card-icons', // Favorites: crown / remove / edit-image on each card
  'lists-create-btn', // Lists: "New list"
]);

const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);

/** Every element's classes in document order, minus edit-only subtrees. */
function classSequence(html: string): string[] {
  const out: string[] = [];
  let skipDepth = 0;
  for (const [, closing, tag, attrs, selfClosing] of html.matchAll(/<(\/?)([a-zA-Z][\w-]*)([^>]*?)(\/?)>/g)) {
    const isVoid = selfClosing === '/' || VOID_TAGS.has(tag.toLowerCase());
    if (closing) {
      if (skipDepth > 0) skipDepth--;
      continue;
    }
    if (skipDepth > 0) {
      if (!isVoid) skipDepth++;
      continue;
    }
    const classes = (/class="([^"]*)"/.exec(attrs)?.[1] ?? '').split(/\s+/).filter(Boolean);
    if (classes.some(c => EDIT_ONLY_CLASSES.has(c))) {
      if (!isVoid) skipDepth = 1;
      continue;
    }
    if (classes.length > 0) out.push(classes.join('.'));
  }
  return out;
}

const ROOT_CLASS: Record<string, string> = {
  overview: 'hof-wrapper', library: 'library-layout', favorites: 'fav-layout',
  stats: 'stats-layout', reviews: 'reviews-layout', lists: 'lists-page-layout',
};

async function load() {
  const [{ OverviewSection }, { LibrarySection }, { FavoritesSection }, { StatsSection }, { ReviewsSection }, { ListsSection }] = await Promise.all([
    import('./OverviewSection'),
    import('./LibrarySection'),
    import('./FavoritesSection'),
    import('./StatsSection'),
    import('./ReviewsSection'),
    import('./ListsSection'),
  ]);
  // Every tab body, in /profile's tab order, as one read-only-parameterised render.
  const tabs: Array<[string, (readOnly: boolean) => [ComponentType<never>, Record<string, unknown>]]> = [
    ['overview', readOnly => [OverviewSection as ComponentType<never>, {
      readOnly,
      data: { items, catalogMap, monthlyHistory, system: '5-star', favorites, characterMap, journey, sagaRelations: [] },
    }]],
    ['library', readOnly => [LibrarySection as ComponentType<never>, {
      readOnly, overrideItems: items, overrideCatalogMap: catalogMap, overrideSagaRelations: [], overrideSagaNames: {},
    }]],
    ['favorites', readOnly => [FavoritesSection as ComponentType<never>, {
      readOnly, overrideItems: items, overrideCatalogMap: catalogMap, overrideCharacterMap: characterMap, overrideFavData: favorites,
    }]],
    ['stats', readOnly => [StatsSection as ComponentType<never>, {
      readOnly, overrideItems: items, overrideCatalogMap: catalogMap, overrideJourney: journey, overrideRelations: [],
    }]],
    ['reviews', () => [ReviewsSection as ComponentType<never>, { overrideItems: items, overrideCatalogMap: catalogMap }]],
    ['lists', readOnly => [ListsSection as ComponentType<never>, {
      readOnly, overrideLists: lists, overrideCatalogMap: catalogMap, overrideFetchItems: async () => [],
    }]],
  ];
  const render = (readOnly: boolean) => tabs.map(([tab, build]) => {
    const [Component, props] = build(readOnly);
    return [tab, renderToStaticMarkup(createElement(Component, props as never))] as const;
  });
  return { own: render(false), pub: render(true) };
}

// The first test pays the cold import of every profile section module,
// which can pass vitest's 5 s default in a full, parallel run.
describe('profile sections: own vs public parity', { timeout: 30_000 }, () => {
  it('renders every tab with the same section order and classes', async () => {
    const { own, pub } = await load();
    for (let i = 0; i < own.length; i++) {
      const [tab, ownHtml] = own[i];
      const [, pubHtml] = pub[i];
      expect(ownHtml, `${tab} renders its real layout`).toContain(`class="${ROOT_CLASS[tab]}`);
      expect(classSequence(pubHtml), tab).toEqual(classSequence(ownHtml));
    }
  });

  it('keeps the overview composition: Hall of Fame, stats row, monthly history, recent activity', async () => {
    const { own, pub } = await load();
    const overview = (html: string) => {
      const order = ['hof-wrapper', 'profile-stats-bar', 'profile-bottom-grid', 'monthly-history', 'activity'];
      return order.map(cls => html.indexOf(`class="${cls}`)).map(i => (i >= 0 ? 'present' : 'missing'));
    };
    const ownHtml = own[0][1];
    const pubHtml = pub[0][1];
    expect(overview(pubHtml)).toEqual(overview(ownHtml));
    const labels = (html: string) => [...html.matchAll(/class="profile-section-label">([^<]*)</g)].map(m => m[1]);
    expect(labels(pubHtml)).toEqual(labels(ownHtml));
    expect(labels(ownHtml).length).toBe(2);
    expect(ownHtml.match(/class="profile-stat"/g)).toHaveLength(7);
    const hof = ownHtml.indexOf('hof-wrapper');
    const stats = ownHtml.indexOf('profile-stats-bar');
    const bottom = ownHtml.indexOf('profile-bottom-grid');
    expect(hof).toBeLessThan(stats);
    expect(stats).toBeLessThan(bottom);
  });

  it('hides owner-only controls in read-only mode', async () => {
    const { own, pub } = await load();
    const ownFav = own.find(([t]) => t === 'favorites')![1];
    const pubFav = pub.find(([t]) => t === 'favorites')![1];
    expect(ownFav).toContain('fav-reorder-btn');
    expect(pubFav).not.toContain('fav-reorder-btn');
  });
});
