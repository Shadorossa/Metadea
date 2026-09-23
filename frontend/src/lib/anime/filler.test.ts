import { describe, expect, it } from 'vitest';
import {
  absoluteFromCanonProgress,
  completionEpisode,
  countFillerBetween,
  effectiveEpisodeTotal,
  effectiveProgress,
  entryFillerCount,
  entryHasFiller,
  fillerKindOf,
  isEffectivelyComplete,
  lastCanonEpisode,
  nextCanonEpisode,
  seasonEpisodeToAbsolute,
  skipFillerFromWatchedWithFiller,
  sumEffectiveSeasons,
  toFillerInfo,
  type FillerInfo,
} from './filler';

function range(from: number, to: number): number[] {
  return Array.from({ length: to - from + 1 }, (_, i) => from + i);
}

function info(opts: { offset?: number; last: number; filler: number[]; mixed?: number[]; animeCanon?: number[] }): FillerInfo {
  const result = toFillerInfo({
    link: { externalId: 'anime:1', slug: 'show', episodeOffset: opts.offset ?? 0, confidence: 1, manual: false },
    show: {
      slug: 'show', title: 'Show', fetchedAt: 1, isAiring: false, lastEpisode: opts.last,
      filler: opts.filler, mixed: opts.mixed ?? [], animeCanon: opts.animeCanon ?? [],
    },
  });
  if (!result) throw new Error('fixture');
  return result;
}

// AnimeFillerList's Naruto: 220 episodes, the long filler tail 136–220 with
// one canon episode (142) inside it.
const NARUTO = info({
  last: 220,
  filler: [26, 97, ...range(101, 106), ...range(136, 141), ...range(143, 220)],
  mixed: [7, 9, 14, 19, 45, 68, 71, 96, 100],
  animeCanon: [5, 13],
});

// Bleach-shaped: 366 episodes, 163 of them filler → 203 canon.
const BLEACH = info({
  last: 366,
  filler: [...range(33, 54), ...range(64, 109), ...range(128, 137), ...range(168, 189), ...range(227, 266), 287, 298, 299, 303, 304, 305, ...range(311, 315), ...range(355, 366)],
});

// Fairy Tail as AnimeFillerList numbers it (1–328); the Fairy Tail (2014)
// entry starts at absolute 176.
const FAIRY_TAIL_ALL = { last: 328, filler: [9, 19, 20, ...range(69, 75), ...range(125, 150), ...range(203, 226)] };
const FAIRY_TAIL_2014 = info({ ...FAIRY_TAIL_ALL, offset: 175 });

const skipped = (progress: number) => ({ skip_filler: 1, progress });
const watched = (progress: number) => ({ skip_filler: 0, progress });

describe('toFillerInfo', () => {
  it('needs fetched show data', () => {
    expect(toFillerInfo({ link: { externalId: 'a', slug: 's', episodeOffset: 0, confidence: 1, manual: true }, show: null })).toBeNull();
  });
});

describe('episode categories', () => {
  it('maps the entry number through the offset and defaults to manga canon', () => {
    expect(fillerKindOf(NARUTO, 26)).toBe('filler');
    expect(fillerKindOf(NARUTO, 7)).toBe('mixed');
    expect(fillerKindOf(NARUTO, 5)).toBe('anime_canon');
    expect(fillerKindOf(NARUTO, 1)).toBe('manga_canon');
    expect(fillerKindOf(NARUTO, 221)).toBeNull();
    expect(fillerKindOf(NARUTO, 0)).toBeNull();
    expect(fillerKindOf(NARUTO, 1.5)).toBeNull();
    expect(fillerKindOf(null, 26)).toBeNull();
    // Fairy Tail (2014) episode 28 is Fairy Tail's absolute 203.
    expect(fillerKindOf(FAIRY_TAIL_2014, 28)).toBe('filler');
    expect(fillerKindOf(FAIRY_TAIL_2014, 27)).toBe('manga_canon');
  });

  it('counts filler inside the entry range only', () => {
    expect(entryFillerCount(NARUTO, 220)).toBe(92);
    expect(entryFillerCount(BLEACH, 366)).toBe(163);
    expect(entryFillerCount(FAIRY_TAIL_2014, 102)).toBe(24);
    expect(countFillerBetween(NARUTO, 1, 100)).toBe(2);
    expect(countFillerBetween(NARUTO, 30, 20)).toBe(0);
    // Unknown total → what AnimeFillerList lists past the offset.
    expect(entryFillerCount(FAIRY_TAIL_2014, null)).toBe(24);
    expect(entryHasFiller(info({ last: 12, filler: [] }), 12)).toBe(false);
  });
});

describe('effective totals and progress', () => {
  it('drops filler from the total only when skipped', () => {
    expect(effectiveEpisodeTotal(skipped(0), BLEACH, 366)).toBe(203);
    expect(effectiveEpisodeTotal(watched(0), BLEACH, 366)).toBe(366);
    expect(effectiveEpisodeTotal(skipped(0), null, 366)).toBe(366);
    expect(effectiveEpisodeTotal(skipped(0), BLEACH, null)).toBeNull();
    expect(effectiveEpisodeTotal(skipped(0), FAIRY_TAIL_2014, 102)).toBe(78);
    // Mixed counts as canon.
    expect(effectiveEpisodeTotal(skipped(0), NARUTO, 220)).toBe(128);
  });

  it('shows canon episodes at or below the stored absolute progress', () => {
    expect(effectiveProgress(skipped(100), NARUTO, 220)).toBe(98);
    expect(effectiveProgress(skipped(142), NARUTO, 220)).toBe(128);
    expect(effectiveProgress(watched(100), NARUTO, 220)).toBe(100);
    expect(effectiveProgress(skipped(60), BLEACH, 366)).toBe(60 - 22);
    expect(effectiveProgress(skipped(30), FAIRY_TAIL_2014, 102)).toBe(27);
    expect(effectiveProgress(undefined, NARUTO, 220)).toBe(0);
  });

  it('completes at the last canon or mixed episode when skipped', () => {
    expect(lastCanonEpisode(NARUTO, 220)).toBe(142);
    expect(completionEpisode(skipped(0), NARUTO, 220)).toBe(142);
    expect(completionEpisode(watched(0), NARUTO, 220)).toBe(220);
    expect(completionEpisode(skipped(0), NARUTO, null)).toBeNull();
    expect(isEffectivelyComplete(skipped(142), NARUTO, 220)).toBe(true);
    expect(isEffectivelyComplete(skipped(141), NARUTO, 220)).toBe(false);
    expect(isEffectivelyComplete(watched(142), NARUTO, 220)).toBe(false);
    expect(isEffectivelyComplete(skipped(354), BLEACH, 366)).toBe(true);
    expect(isEffectivelyComplete(skipped(353), BLEACH, 366)).toBe(false);
    // Nothing but filler: the total itself.
    expect(completionEpisode(skipped(0), info({ last: 3, filler: [1, 2, 3] }), 3)).toBe(3);
  });
});

describe('nextCanonEpisode', () => {
  it('jumps a filler run and reports how many were skipped', () => {
    expect(nextCanonEpisode(135, NARUTO, 220)).toEqual({ episode: 142, skipped: 6 });
    expect(nextCanonEpisode(100, NARUTO, 220)).toEqual({ episode: 107, skipped: 6 });
    expect(nextCanonEpisode(25, NARUTO, 220)).toEqual({ episode: 27, skipped: 1 });
    expect(nextCanonEpisode(27, FAIRY_TAIL_2014, 102)).toEqual({ episode: 52, skipped: 24 });
  });

  it('is the next episode when it is canon or mixed, or without data', () => {
    expect(nextCanonEpisode(6, NARUTO, 220)).toEqual({ episode: 7, skipped: 0 });
    expect(nextCanonEpisode(10, null, 12)).toEqual({ episode: 11, skipped: 0 });
    expect(nextCanonEpisode(12, null, 12)).toEqual({ episode: null, skipped: 0 });
  });

  it('returns no episode when only filler remains', () => {
    expect(nextCanonEpisode(142, NARUTO, 220)).toEqual({ episode: null, skipped: 78 });
    // Without a total, past the known list counts as canon.
    expect(nextCanonEpisode(142, NARUTO)).toEqual({ episode: 221, skipped: 78 });
  });
});

describe('seasonEpisodeToAbsolute', () => {
  const seasons = [
    { season_number: 0, episode_count: 5 },
    { season_number: 1, episode_count: 25 },
    { season_number: 2, episode_count: 12 },
    { season_number: 3, episode_count: 22 },
  ];
  it('adds up the earlier seasons', () => {
    expect(seasonEpisodeToAbsolute(seasons, 1, 1)).toBe(1);
    expect(seasonEpisodeToAbsolute(seasons, 2, 1)).toBe(26);
    expect(seasonEpisodeToAbsolute(seasons, 3, 10)).toBe(47);
    expect(seasonEpisodeToAbsolute(seasons, 0, 3)).toBeNull();
  });
});

// 12 episodes: filler 4–6 and 11, episode 7 mixed → 8 canon/mixed
// (1, 2, 3, 7, 8, 9, 10, 12).
const SMALL = info({ last: 12, filler: [4, 5, 6, 11], mixed: [7] });

describe('absoluteFromCanonProgress', () => {
  it('maps the n-th canon/mixed episode across filler gaps', () => {
    expect(absoluteFromCanonProgress(0, SMALL, 12)).toBe(0);
    expect(absoluteFromCanonProgress(3, SMALL, 12)).toBe(3);
    expect(absoluteFromCanonProgress(4, SMALL, 12)).toBe(7);
    expect(absoluteFromCanonProgress(7, SMALL, 12)).toBe(10);
    expect(absoluteFromCanonProgress(8, SMALL, 12)).toBe(12);
  });

  it('round-trips with effectiveProgress', () => {
    for (let n = 0; n <= 8; n++) {
      expect(effectiveProgress(skipped(absoluteFromCanonProgress(n, SMALL, 12)), SMALL, 12)).toBe(n);
    }
    for (let n = 0; n <= 203; n += 7) {
      expect(effectiveProgress(skipped(absoluteFromCanonProgress(n, BLEACH, 366)), BLEACH, 366)).toBe(n);
    }
  });

  it('clamps past the canon count to the last canon episode or the total', () => {
    expect(absoluteFromCanonProgress(9, SMALL, 12)).toBe(12);
    expect(absoluteFromCanonProgress(203, BLEACH, 366)).toBe(354);
    expect(absoluteFromCanonProgress(500, BLEACH, 366)).toBe(354);
    expect(absoluteFromCanonProgress(-3, SMALL, 12)).toBe(0);
  });

  it('counts episodes past the listed data as canon', () => {
    expect(absoluteFromCanonProgress(9, SMALL, 20)).toBe(13);
    expect(absoluteFromCanonProgress(100, SMALL, 20)).toBe(20);
    expect(absoluteFromCanonProgress(10, SMALL, null)).toBe(14);
  });

  it('goes through the entry offset', () => {
    // Fairy Tail (2014): entry 28–51 are absolute 203–226 (filler).
    expect(absoluteFromCanonProgress(27, FAIRY_TAIL_2014, 102)).toBe(27);
    expect(absoluteFromCanonProgress(28, FAIRY_TAIL_2014, 102)).toBe(52);
  });

  it('is the count itself without data', () => {
    expect(absoluteFromCanonProgress(5, null, 12)).toBe(5);
    expect(absoluteFromCanonProgress(20, undefined, 12)).toBe(12);
    expect(absoluteFromCanonProgress(20, null, null)).toBe(20);
  });
});

describe('"Watched with filler" checkbox', () => {
  it('maps unchecked to skip_filler = 1', () => {
    expect(skipFillerFromWatchedWithFiller(true)).toBe(0);
    expect(skipFillerFromWatchedWithFiller(false)).toBe(1);
    expect(effectiveEpisodeTotal({ skip_filler: skipFillerFromWatchedWithFiller(false) }, SMALL, 12)).toBe(8);
    expect(effectiveEpisodeTotal({ skip_filler: skipFillerFromWatchedWithFiller(true) }, SMALL, 12)).toBe(12);
  });
});

describe('sumEffectiveSeasons', () => {
  it('sums each season with its own skip flag and filler data', () => {
    expect(sumEffectiveSeasons([
      { entry: skipped(10), info: SMALL, total: 12 },
      { entry: watched(5), info: SMALL, total: 12 },
      { entry: null, info: undefined, total: 24 },
      { entry: skipped(3), info: undefined, total: null },
    ])).toEqual({ total: 8 + 12 + 24, progress: 7 + 5 + 0 + 3 });
  });

  it('is zero for no seasons', () => {
    expect(sumEffectiveSeasons([])).toEqual({ total: 0, progress: 0 });
  });
});
