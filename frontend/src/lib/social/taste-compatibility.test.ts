import { describe, expect, it } from 'vitest';
import type { CatalogSummary, SocialLibraryItem } from '../tauri';
import type { TasteCompatibilityData, TasteRatingPair } from '../tauri/social-profile';
import {
  computeTasteCompatibility, cosineSimilarity, distributionOverlap, engagementWeight, favoriteBonus, hoursByMedium,
  isHighAffinity, libraryOverlap, librarySignals, ratingAgreement, statusAgreement, tasteByType, tasteComponentBars,
  tasteVerdict, HIGH_AFFINITY_SCORE, PROFILE_SHARE_MAX,
  type TasteCatalogRow, type TasteLibraryEntry, type TasteLibrarySignals, type TasteSide,
} from './taste-compatibility';
import { toLibraryEntry } from './social-library-mapping';

function pairs(values: Array<[number, number]>): TasteRatingPair[] {
  return values.map(([own, their], i) => ({ external_id: `anime:${i}`, own, their }));
}

function data(ratingPairs: TasteRatingPair[], overrides: Partial<TasteCompatibilityData> = {}): TasteCompatibilityData {
  const n = ratingPairs.length;
  return {
    own_engaged: n, their_engaged: n, shared_works: n, shared_completed: n, shared_engaged: n,
    both_rated: n,
    mean_abs_diff: n ? ratingPairs.reduce((s, p) => s + Math.abs(p.own - p.their), 0) / n : null,
    rating_pairs: ratingPairs,
    shared_favorites: [], shared_favorites_total: 0,
    ...overrides,
  };
}

function lib(entries: Array<[string, string]>, hours?: Record<string, number>): TasteSide {
  return {
    entries: entries.map(([external_id, status]) => ({ external_id, status })),
    hours: hours ? new Map(Object.entries(hours)) : undefined,
  };
}

function rated(entries: Array<[string, string, number]>, hours?: Record<string, number>): TasteSide {
  return {
    entries: entries.map(([external_id, status, rating]): TasteLibraryEntry => ({ external_id, status, rating })),
    hours: hours ? new Map(Object.entries(hours)) : undefined,
  };
}

// A small catalog: id → comma-separated genres.
const GENRES: Record<string, string> = {
  'anime:1': 'Action,Adventure', 'anime:2': 'Action,Fantasy', 'anime:3': 'Action,Adventure',
  'anime:4': 'Romance,Slice of Life', 'anime:5': 'Romance,Drama', 'anime:6': 'Slice of Life,Drama',
  'game:1': 'Action', 'game:2': 'Puzzle', 'manga:1': 'Romance',
};
const genresOf = (id: string): TasteCatalogRow | undefined => (GENRES[id] ? { genres_csv: GENRES[id] } : undefined);

/** Neutral signals: every library component present, overridable. */
function signals(overrides: Partial<TasteLibrarySignals> = {}): TasteLibrarySignals {
  return {
    statusSimilarity: 1, statusShared: 10, genreSimilarity: 1, hoursSimilarity: 1, hoursEvidence: 100,
    profileSimilarity: 1, nonSharedEvidence: 20, ownTime: [], theirTime: [], sharedGenres: [],
    ...overrides,
  };
}

describe('computeTasteCompatibility', () => {
  it('identical tastes score ~100', () => {
    const same = pairs([[0.9, 0.9], [0.4, 0.4], [0.7, 0.7], [1, 1], [0.6, 0.6], [0.8, 0.8]]);
    expect(computeTasteCompatibility(data(same)).score).toBeGreaterThanOrEqual(98);
    const library = lib([['anime:0', 'completed'], ['anime:1', 'completed'], ['anime:2', 'dropped'], ['anime:3', 'planning'], ['anime:4', 'completed'], ['anime:5', 'completed']]);
    const withSignals = computeTasteCompatibility(data(same), librarySignals(library, library, genresOf));
    expect(withSignals.score).toBeGreaterThanOrEqual(98);
  });

  it('opposite tastes score low', () => {
    const opposite = pairs([[1, 0.1], [0.1, 1], [0.9, 0.2], [0.2, 0.9], [1, 0], [0, 1]]);
    const result = computeTasteCompatibility(data(opposite), librarySignals(
      lib([['anime:0', 'completed'], ['anime:1', 'completed'], ['anime:2', 'completed'], ['anime:3', 'dropped']]),
      lib([['anime:0', 'dropped'], ['anime:4', 'completed'], ['anime:5', 'completed'], ['anime:6', 'completed']]),
      genresOf,
    ));
    expect(result.score).toBeLessThan(30);
    expect(result.disagreements[0]?.external_id).toBe('anime:4');
    expect(result.disagreements.length).toBe(5);
  });

  it('always has a score: zero overlap still yields a genre-based one', () => {
    const noOverlap = data([], { own_engaged: 3, their_engaged: 2, shared_works: 0, shared_completed: 0, shared_engaged: 0 });
    const alike = computeTasteCompatibility(noOverlap, librarySignals(
      lib([['anime:1', 'completed'], ['anime:2', 'completed'], ['game:1', 'playing']]),
      lib([['anime:3', 'completed'], ['game:1b', 'completed']]),
      id => ({ genres_csv: GENRES[id] ?? 'Action' }),
    ));
    const unlike = computeTasteCompatibility(noOverlap, librarySignals(
      lib([['anime:1', 'completed'], ['anime:2', 'completed']]),
      lib([['manga:1', 'completed'], ['game:2', 'completed']]),
      genresOf,
    ));
    expect(alike.score).toBeGreaterThan(50);
    expect(unlike.score).toBeLessThan(15);
    // No evidence at all is still a number, never a "not enough" state.
    expect(computeTasteCompatibility(data([])).score).toBe(0);
  });

  it('leans on status + genre with few ratings and on ratings as the rated overlap grows', () => {
    const all = signals();
    const opposed = (n: number) => pairs(Array.from({ length: n }, (_, i) => (i % 2 ? [1, 0] : [0, 1]) as [number, number]));
    const few = computeTasteCompatibility(data(opposed(2)), all);
    const many = computeTasteCompatibility(data(opposed(60)), all);
    expect(few.weights.rating).toBeLessThan(few.weights.genre + few.weights.status);
    expect(many.weights.rating).toBeGreaterThan(many.weights.genre + many.weights.status);
    expect(few.score).toBeGreaterThan(many.score);
  });

  it('shared favourites add a capped bonus and are excluded from "both loved"', () => {
    const loved = pairs([[1, 1], [0.95, 0.9], [0.5, 0.6], [0.3, 0.2], [0.6, 0.4]]);
    const base = computeTasteCompatibility(data(loved, { own_engaged: 200, their_engaged: 200, shared_engaged: 5 }));
    const withFavs = computeTasteCompatibility(data(loved, {
      own_engaged: 200, their_engaged: 200, shared_engaged: 5,
      shared_favorites: ['anime:0'], shared_favorites_total: 10,
    }));
    expect(withFavs.score - base.score).toBe(8);
    expect(base.bothLoved.map(p => p.external_id)).toEqual(['anime:0', 'anime:1']);
    expect(withFavs.bothLoved.map(p => p.external_id)).toEqual(['anime:1']);
  });
});

describe('librarySignals', () => {
  it('compares statuses on shared works: same agrees, completed vs dropped disagrees', () => {
    expect(statusAgreement('completed', 'completed')).toBe(1);
    expect(statusAgreement('dropped', 'dropped')).toBe(1);
    expect(statusAgreement('planning', 'planning')).toBe(1);
    expect(statusAgreement('completed', 'dropped')).toBe(0);
    expect(statusAgreement('watching', 'completed')).toBeGreaterThan(0.5);
    expect(statusAgreement(null, 'completed')).toBeNull();
    const result = librarySignals(
      lib([['anime:1', 'completed'], ['anime:2', 'dropped'], ['anime:3', 'planning']]),
      lib([['anime:1', 'completed'], ['anime:2', 'completed'], ['anime:4', 'completed']]),
      genresOf,
    );
    expect(result.statusShared).toBe(2);
    expect(result.statusSimilarity).toBe(0.5);
  });

  it('cosine similarity of counts: 1 when proportional, 0 when disjoint, null when empty', () => {
    expect(cosineSimilarity(new Map([['a', 2], ['b', 1]]), new Map([['a', 4], ['b', 2]]))).toBeCloseTo(1);
    expect(cosineSimilarity(new Map([['a', 1]]), new Map([['b', 1]]))).toBe(0);
    expect(cosineSimilarity(new Map(), new Map([['b', 1]]))).toBeNull();
  });
});

describe('ratingAgreement', () => {
  it('strong disagreements pull harder than their plain mean', () => {
    const mixed = pairs([[0.6, 0.6], [0.6, 0.6], [1, 0]]);
    const plainMean = (1 + 1 + 0) / 3;
    expect(ratingAgreement(mixed)!).toBeLessThan((plainMean - 0.5) / 0.5);
  });

  it('agreement on high ratings counts more than agreement on low ones', () => {
    const highAgree = pairs([[0.9, 0.9], [0.5, 0.2]]);
    const lowAgree = pairs([[0.3, 0.3], [0.5, 0.2]]);
    expect(ratingAgreement(highAgree)!).toBeGreaterThan(ratingAgreement(lowAgree)!);
  });

  it('is null with no pairs', () => {
    expect(ratingAgreement([])).toBeNull();
  });
});

describe('libraryOverlap', () => {
  it('has diminishing returns as the shared count grows', () => {
    const gain1 = libraryOverlap(100, 1000, 1000) - libraryOverlap(50, 1000, 1000);
    const gain2 = libraryOverlap(900, 1000, 1000) - libraryOverlap(850, 1000, 1000);
    expect(gain1).toBeGreaterThan(gain2);
  });

  it('does not let big libraries dominate a smaller, proportionally equal overlap', () => {
    const small = libraryOverlap(20, 40, 40);
    const big = libraryOverlap(1000, 2000, 2000);
    expect(Math.abs(big - small)).toBeLessThan(0.15);
  });

  it('is 1 for identical libraries and 0 with nothing shared', () => {
    expect(libraryOverlap(30, 30, 30)).toBe(1);
    expect(libraryOverlap(0, 30, 30)).toBe(0);
  });
});

describe('favoriteBonus', () => {
  it('scales per favourite and caps', () => {
    expect(favoriteBonus(0)).toBe(0);
    expect(favoriteBonus(2)).toBe(4);
    expect(favoriteBonus(50)).toBe(8);
  });
});

describe('tasteComponentBars', () => {
  it('reports every term, in order, and sums to the score', () => {
    const loved = pairs([[1, 1], [0.9, 0.9], [0.8, 0.8], [0.7, 0.7], [0.6, 0.6]]);
    const taste = computeTasteCompatibility(data(loved, {
      own_engaged: 50, their_engaged: 50, shared_engaged: 5, shared_favorites: ['anime:0'], shared_favorites_total: 2,
    }), signals({ statusSimilarity: 0.8, statusShared: 5, genreSimilarity: 0.6, hoursSimilarity: 0.5, profileSimilarity: 0.7 }));
    const bars = tasteComponentBars(taste);
    expect(bars.map(b => b.key)).toEqual(['rating', 'genre', 'hours', 'status', 'overlap', 'profile', 'favorites']);
    expect(bars[0].fraction).toBe(1);
    expect(bars[6]).toMatchObject({ points: 4, maxPoints: 8, fraction: 0.5 });
    const maxBase = bars.slice(0, 6).reduce((acc, b) => acc + b.maxPoints, 0);
    expect(Math.abs(maxBase - 100)).toBeLessThanOrEqual(3);
    const sum = bars.reduce((acc, b) => acc + b.points, 0);
    expect(Math.abs(sum - taste.score)).toBeLessThanOrEqual(2);
  });

  it('gives a component with no evidence no weight', () => {
    const bars = tasteComponentBars(computeTasteCompatibility(data([])));
    const byKey = Object.fromEntries(bars.map(b => [b.key, b]));
    expect(byKey.rating).toMatchObject({ fraction: 0, points: 0, maxPoints: 0 });
    for (const key of ['status', 'genre', 'hours', 'profile']) expect(byKey[key]).toMatchObject({ maxPoints: 0 });
    expect(byKey.overlap.maxPoints).toBe(100);
  });
});

describe('tasteByType', () => {
  it('splits by external_id prefix, drops thin types, most-rated first', () => {
    const split = tasteByType([
      { external_id: 'game:1', own: 1, their: 1 },
      { external_id: 'game:2', own: 0.8, their: 0.8 },
      { external_id: 'game:3', own: 0.6, their: 0.6 },
      { external_id: 'anime:1', own: 1, their: 0 },
      { external_id: 'anime:2', own: 0, their: 1 },
      { external_id: 'anime:3', own: 0.5, their: 0.5 },
      { external_id: 'anime:4', own: 0.5, their: 0.5 },
      { external_id: 'manga:1', own: 1, their: 1 },
      { external_id: 'broken', own: 1, their: 1 },
    ]);
    expect(split.map(t => t.type)).toEqual(['anime', 'game']);
    expect(split[0].bothRated).toBe(4);
    expect(split[1].agreement).toBe(100);
    expect(split[0].agreement).toBeLessThan(split[1].agreement);
  });
});

describe('isHighAffinity', () => {
  it('needs a score at or above the threshold', () => {
    const base = computeTasteCompatibility(data([]));
    expect(isHighAffinity(null)).toBe(false);
    expect(isHighAffinity(base)).toBe(false);
    expect(isHighAffinity({ ...base, score: HIGH_AFFINITY_SCORE })).toBe(true);
    expect(isHighAffinity({ ...base, score: HIGH_AFFINITY_SCORE - 1 })).toBe(false);
  });
});

describe('genres, hours and the rest of the libraries', () => {
  // Two disjoint catalogs with the same genre mix: action/adventure-heavy
  // anime plus some drama.
  const CATALOG: Record<string, TasteCatalogRow> = {};
  const genreOf = (i: number) => (i % 3 === 2 ? 'Drama,Romance' : 'Action,Adventure');
  for (let i = 0; i < 12; i++) {
    CATALOG[`anime:${i}`] = { genres_csv: genreOf(i), format: 'TV', release_year: 2010 + (i % 10) };
    CATALOG[`anime:${100 + i}`] = { genres_csv: genreOf(i), format: 'TV', release_year: 2012 + (i % 8) };
  }
  const catalogOf = (id: string) => CATALOG[id];
  const noOverlap = data([], { own_engaged: 12, their_engaged: 12, shared_works: 0, shared_completed: 0, shared_engaged: 0 });

  it('same genres, different titles: a decent score', () => {
    const own = rated(Array.from({ length: 12 }, (_, i) => [`anime:${i}`, 'completed', 8] as [string, string, number]), { anime: 200, movie: 20 });
    const their = rated(Array.from({ length: 12 }, (_, i) => [`anime:${100 + i}`, 'completed', 7.5] as [string, string, number]), { anime: 150, movie: 25 });
    const result = computeTasteCompatibility(noOverlap, librarySignals(own, their, catalogOf));
    expect(result.genreSimilarity!).toBeGreaterThan(0.95);
    expect(result.score).toBeGreaterThanOrEqual(60);
    expect(result.sharedGenres.map(g => g.genre).slice(0, 2).sort()).toEqual(['Action', 'Adventure']);
  });

  it('same titles, opposite ratings: low', () => {
    const ids = Array.from({ length: 12 }, (_, i) => `anime:${i}`);
    // You love the action ones and pan the romance ones; they do the reverse.
    const ownRating = (i: number) => (i % 3 === 2 ? 1 : 10);
    const theirRating = (i: number) => (i % 3 === 2 ? 10 : 1);
    const own = rated(ids.map((id, i) => [id, 'completed', ownRating(i)] as [string, string, number]), { anime: 100 });
    const their = rated(ids.map((id, i) => [id, 'completed', theirRating(i)] as [string, string, number]), { anime: 100 });
    const ratingPairs = ids.map((external_id, i) => ({ external_id, own: ownRating(i) / 10, their: theirRating(i) / 10 }));
    const result = computeTasteCompatibility(data(ratingPairs), librarySignals(own, their, catalogOf));
    expect(result.ratingAgreement).toBeLessThan(0.1);
    // Engagement weighting: the genres each one loves are the other's least.
    expect(result.genreSimilarity!).toBeLessThan(0.6);
    expect(result.score).toBeLessThan(35);
  });

  it('similar hour splits score higher than a gamer vs an anime-only viewer', () => {
    expect(distributionOverlap(new Map([['anime', 300], ['game', 100]]), new Map([['anime', 150], ['game', 50]]))).toBeCloseTo(1);
    expect(distributionOverlap(new Map([['game', 500]]), new Map([['anime', 400]]))).toBe(0);
    expect(distributionOverlap(new Map(), new Map([['anime', 1]]))).toBeNull();
    const entries: Array<[string, string]> = [['anime:0', 'completed'], ['anime:1', 'completed']];
    const alike = librarySignals(lib(entries, { anime: 300, game: 100 }), lib(entries, { anime: 280, game: 120 }), catalogOf);
    const apart = librarySignals(lib(entries, { game: 500 }), lib(entries, { anime: 400 }), catalogOf);
    expect(alike.hoursSimilarity!).toBeGreaterThan(0.9);
    expect(apart.hoursSimilarity).toBe(0);
    const base = data([], { own_engaged: 2, their_engaged: 2, shared_works: 2, shared_engaged: 2 });
    expect(computeTasteCompatibility(base, alike).score - computeTasteCompatibility(base, apart).score).toBeGreaterThanOrEqual(15);
    expect(alike.ownTime[0]).toMatchObject({ type: 'anime', hours: 300, share: 0.75 });
  });

  it('non-shared works move the score, but never by more than their capped share', () => {
    const overlap = data(pairs([[0.8, 0.8], [0.6, 0.7], [0.9, 0.9]]));
    const low = computeTasteCompatibility(overlap, signals({ profileSimilarity: 0, nonSharedEvidence: 10_000 }));
    const high = computeTasteCompatibility(overlap, signals({ profileSimilarity: 1, nonSharedEvidence: 10_000 }));
    expect(high.weights.profile).toBeLessThanOrEqual(PROFILE_SHARE_MAX);
    expect(high.score - low.score).toBeGreaterThan(5);
    expect(high.score - low.score).toBeLessThanOrEqual(Math.round(100 * PROFILE_SHARE_MAX));
    // With few non-shared works, even less.
    const thin = computeTasteCompatibility(overlap, signals({ profileSimilarity: 0, nonSharedEvidence: 2 }));
    expect(high.score - thin.score).toBeLessThan(high.score - low.score);

    // Through librarySignals: identical shared works; only what each side
    // has on its own differs (formats, decades, how they rate it).
    const shared: Array<[string, string, number]> = [['anime:0', 'completed', 8], ['anime:1', 'completed', 7]];
    const extra = (prefix: number, rating: number) =>
      Array.from({ length: 10 }, (_, i) => [`anime:${prefix + i}`, 'completed', rating] as [string, string, number]);
    const catalog = (id: string): TasteCatalogRow | undefined => {
      const n = Number(id.split(':')[1]);
      if (n >= 500) return { format: 'MOVIE', release_year: 1975 };
      if (n >= 300) return { format: 'TV', release_year: 2019 };
      return { format: 'TV', release_year: 2018 };
    };
    const own = rated([...shared, ...extra(200, 8)]);
    const alike = librarySignals(own, rated([...shared, ...extra(300, 8)]), catalog);
    const unlike = librarySignals(own, rated([...shared, ...extra(500, 2)]), catalog);
    expect(alike.profileSimilarity!).toBeGreaterThan(unlike.profileSimilarity!);
    const d = data(pairs([[0.8, 0.8], [0.7, 0.7]]));
    const diff = computeTasteCompatibility(d, alike).score - computeTasteCompatibility(d, unlike).score;
    expect(diff).toBeGreaterThan(0);
    expect(diff).toBeLessThanOrEqual(Math.round(100 * PROFILE_SHARE_MAX));
  });

  it('weighs genres by engagement: loved and completed beats dropped or panned', () => {
    expect(engagementWeight({ external_id: 'a:1', status: 'completed', rating: 10 }))
      .toBeGreaterThan(engagementWeight({ external_id: 'a:1', status: 'completed', rating: null }));
    expect(engagementWeight({ external_id: 'a:1', status: 'completed', rating: null }))
      .toBeGreaterThan(engagementWeight({ external_id: 'a:1', status: 'completed', rating: 2 }));
    expect(engagementWeight({ external_id: 'a:1', status: 'dropped', rating: null }))
      .toBeLessThan(engagementWeight({ external_id: 'a:1', status: 'planning', rating: null }));
  });
});

describe('hoursByMedium', () => {
  it('uses the Stats tab rules; a synced row gets the editor rule (progress × 60)', () => {
    const catalog = new Map<string, CatalogSummary>([
      ['anime:1', { external_id: 'anime:1', time_length: 24, total_count: 12 } as CatalogSummary],
    ]);
    const synced = (external_id: string, progress: number): SocialLibraryItem => ({
      external_id, progress, status: 'completed', rating: null, started_at: null, finished_at: null,
      notes: null, tags: null, title_main: null, cover_url: null, media_type: null,
    });
    const hours = hoursByMedium([toLibraryEntry(synced('anime:1', 12)), toLibraryEntry(synced('game:1', 40))], catalog);
    expect(hours.get('anime')).toBeCloseTo(4.8);
    expect(hours.get('game')).toBe(40);
    expect(hours.has('manga')).toBe(false);
  });
});

describe('tasteVerdict', () => {
  it('bands the score', () => {
    expect([95, 85, 84, 70, 69, 50, 49, 30, 29, 0].map(tasteVerdict)).toEqual([
      'soulmates', 'soulmates', 'very', 'very', 'complementary', 'complementary', 'different', 'different', 'opposites', 'opposites',
    ]);
  });
});
