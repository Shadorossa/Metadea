import { describe, expect, it } from 'vitest';
import {
  AUTO_LINK_CONFIDENCE,
  bestFillerMatch,
  fillerTitleScore,
  normalizeFillerTitle,
  planChainFillerLinks,
  searchFillerIndex,
  stripSeasonWords,
  verifyPlannedLink,
  type FillerChainEntry,
} from './filler-match';

const INDEX = [
  { slug: 'attack-titan', title: 'Attack on Titan' },
  { slug: 'black-clover', title: 'Black Clover' },
  { slug: 'bleach', title: 'Bleach' },
  { slug: 'boruto-naruto-next-generations', title: 'Boruto: Naruto Next Generations' },
  { slug: 'detective-conan', title: 'Detective Conan' },
  { slug: 'dragon-ball', title: 'Dragon Ball' },
  { slug: 'dragon-ball-z', title: 'Dragon Ball Z' },
  { slug: 'dragon-ball-z-kai', title: 'Dragon Ball Z Kai' },
  { slug: 'dragon-ball-super', title: 'Dragon Ball Super' },
  { slug: 'fairy-tail', title: 'Fairy Tail' },
  { slug: 'fairy-tail-100-years-quest', title: 'Fairy Tail: 100 Years Quest' },
  { slug: 'hunter-x-hunter-2011', title: 'Hunter x Hunter (2011)' },
  { slug: 'naruto', title: 'Naruto' },
  { slug: 'naruto-shippuden', title: 'Naruto Shippuden' },
  { slug: 'one-piece', title: 'One Piece' },
];

const auto = (titles: string[]) => {
  const match = bestFillerMatch(titles, INDEX);
  return match && match.confidence >= AUTO_LINK_CONFIDENCE ? match.slug : null;
};

describe('title normalisation', () => {
  it('folds case, punctuation, diacritics and romaji long vowels', () => {
    expect(normalizeFillerTitle('NARUTO: Shippuuden')).toBe('naruto shippuden');
    expect(normalizeFillerTitle('Naruto Shippûden')).toBe('naruto shippuden');
    expect(normalizeFillerTitle('Hunter × Hunter (2011)')).toBe('hunter x hunter 2011');
    expect(normalizeFillerTitle("JoJo's Bizarre Adventure")).toBe('jojos bizarre adventure');
    expect(normalizeFillerTitle('The Seven Deadly Sins')).toBe('seven deadly sins');
  });

  it('strips season, part, year and final-season words', () => {
    expect(stripSeasonWords('attack on titan season 3 part 2')).toBe('attack on titan');
    expect(stripSeasonWords('shingeki no kyojin the final season')).toBe('shingeki no kyojin');
    expect(stripSeasonWords('fairy tail 2014')).toBe('fairy tail');
    expect(stripSeasonWords('fairy tail final series')).toBe('fairy tail');
    expect(stripSeasonWords('sword art online ii')).toBe('sword art online');
    expect(stripSeasonWords('dragon ball z')).toBe('dragon ball z');
    expect(stripSeasonWords('mob psycho 100')).toBe('mob psycho 100');
  });
});

describe('matching real AniList titles', () => {
  it('auto-links the long-running shows', () => {
    expect(auto(['NARUTO', 'Naruto', 'ナルト'])).toBe('naruto');
    expect(auto(['NARUTO: Shippuuden', 'Naruto Shippuden'])).toBe('naruto-shippuden');
    expect(auto(['BLEACH', 'Bleach'])).toBe('bleach');
    expect(auto(['ONE PIECE'])).toBe('one-piece');
    expect(auto(['FAIRY TAIL'])).toBe('fairy-tail');
    expect(auto(['FAIRY TAIL (2014)'])).toBe('fairy-tail');
    expect(auto(['FAIRY TAIL: Final Series', 'Fairy Tail: Final Season'])).toBe('fairy-tail');
    expect(auto(['Shingeki no Kyojin', 'Attack on Titan'])).toBe('attack-titan');
    expect(auto(['Shingeki no Kyojin Season 2'])).toBe('attack-titan');
    expect(auto(['BORUTO: NARUTO NEXT GENERATIONS'])).toBe('boruto-naruto-next-generations');
    expect(auto(['Black Clover', 'ブラッククローバー'])).toBe('black-clover');
    expect(auto(['Meitantei Conan', 'Case Closed'])).toBe('detective-conan');
    expect(auto(['Dragon Ball Z', 'ドラゴンボールZ'])).toBe('dragon-ball-z');
    expect(auto(['HUNTER×HUNTER (2011)', 'Hunter x Hunter (2011)'])).toBe('hunter-x-hunter-2011');
  });

  it('never auto-links a neighbouring title in the franchise', () => {
    expect(auto(['Dragon Ball Z Kai: The Final Chapters'])).not.toBe('dragon-ball-z');
    expect(auto(['Dragon Ball GT'])).toBeNull();
    expect(auto(['BLEACH: Sennen Kessen-hen', 'BLEACH: Thousand-Year Blood War'])).toBeNull();
    expect(auto(['Boruto: Naruto the Movie'])).not.toBe('naruto');
    expect(fillerTitleScore('Naruto', 'Naruto Shippuden')).toBeLessThan(AUTO_LINK_CONFIDENCE);
    expect(fillerTitleScore('Dragon Ball Z', 'Dragon Ball Z Kai')).toBeLessThan(AUTO_LINK_CONFIDENCE);
    expect(fillerTitleScore('Fairy Tail: 100 Years Quest', 'Fairy Tail')).toBeLessThan(AUTO_LINK_CONFIDENCE);
  });

  it('ranks the manual search by prefix, substring and similarity', () => {
    expect(searchFillerIndex('naruto', INDEX).map(show => show.slug).slice(0, 3)).toEqual(['naruto', 'naruto-shippuden', 'boruto-naruto-next-generations']);
    expect(searchFillerIndex('dragon ball z', INDEX)[0].slug).toBe('dragon-ball-z');
    expect(searchFillerIndex('', INDEX, 2)).toHaveLength(2);
    expect(searchFillerIndex('zzzz', INDEX)).toEqual([]);
  });
});

const entry = (externalId: string, titles: string[], totalCount: number, format = 'TV'): FillerChainEntry => ({ externalId, titles, totalCount, format });

describe('chain offsets', () => {
  it('Fairy Tail seasons continue one absolute run; movies are skipped', () => {
    const chain = [
      entry('anime:6702', ['FAIRY TAIL', 'Fairy Tail'], 175),
      entry('anime:9999', ['FAIRY TAIL Movie 1: Houou no Miko'], 1, 'MOVIE'),
      entry('anime:20626', ['FAIRY TAIL (2014)', 'Fairy Tail (2014)'], 102),
      entry('anime:99749', ['FAIRY TAIL: Final Series', 'Fairy Tail: Final Season'], 51),
    ];
    const plans = planChainFillerLinks(chain, INDEX);
    expect(plans.map(p => [p.externalId, p.slug, p.episodeOffset])).toEqual([
      ['anime:6702', 'fairy-tail', 0],
      ['anime:20626', 'fairy-tail', 175],
      ['anime:99749', 'fairy-tail', 277],
    ]);
    expect(plans.every(plan => verifyPlannedLink(plan, chain.find(e => e.externalId === plan.externalId)?.totalCount ?? 0, 328, false))).toBe(true);
  });

  it('Naruto → Shippuden → Boruto are three shows, each from 0', () => {
    const plans = planChainFillerLinks([
      entry('anime:20', ['NARUTO', 'Naruto'], 220),
      entry('anime:1735', ['NARUTO: Shippuuden', 'Naruto Shippuden'], 500),
      entry('anime:97938', ['BORUTO: NARUTO NEXT GENERATIONS'], 293),
    ], INDEX);
    expect(plans.map(p => [p.slug, p.episodeOffset])).toEqual([
      ['naruto', 0],
      ['naruto-shippuden', 0],
      ['boruto-naruto-next-generations', 0],
    ]);
  });

  it('Attack on Titan seasons and parts accumulate', () => {
    const plans = planChainFillerLinks([
      entry('anime:16498', ['Shingeki no Kyojin', 'Attack on Titan'], 25),
      entry('anime:20958', ['Shingeki no Kyojin Season 2', 'Attack on Titan Season 2'], 12),
      entry('anime:99147', ['Shingeki no Kyojin Season 3', 'Attack on Titan Season 3'], 12),
      entry('anime:104578', ['Shingeki no Kyojin Season 3 Part 2', 'Attack on Titan Season 3 Part 2'], 10),
      entry('anime:110277', ['Shingeki no Kyojin: The Final Season', 'Attack on Titan Final Season'], 16),
    ], INDEX);
    expect(plans.map(p => p.episodeOffset)).toEqual([0, 25, 37, 49, 59]);
    expect(new Set(plans.map(p => p.slug))).toEqual(new Set(['attack-titan']));
  });

  it('Bleach TYBW continues Bleach but fails verification when the show ends at 366', () => {
    const chain = [
      entry('anime:269', ['BLEACH', 'Bleach'], 366),
      entry('anime:116674', ['BLEACH: Sennen Kessen-hen', 'BLEACH: Thousand-Year Blood War'], 13),
    ];
    const plans = planChainFillerLinks(chain, INDEX);
    expect(plans.map(p => [p.externalId, p.episodeOffset])).toEqual([['anime:269', 0], ['anime:116674', 366]]);
    expect(plans[1].confidence).toBeLessThanOrEqual(AUTO_LINK_CONFIDENCE);
    expect(verifyPlannedLink(plans[0], 366, 366, false)).toBe(true);
    expect(verifyPlannedLink(plans[1], 13, 366, false)).toBe(false);
    // Were AnimeFillerList to append TYBW as 367+, the same link would hold.
    expect(verifyPlannedLink(plans[1], 13, 379, false)).toBe(true);
  });

  it('an unmatched entry breaks the continuation chain', () => {
    const plans = planChainFillerLinks([
      entry('anime:813', ['Dragon Ball Z'], 291),
      entry('anime:1', ['Some Unrelated Sequel'], 12),
    ], INDEX);
    expect(plans.map(p => p.externalId)).toEqual(['anime:813']);
  });

  it('verification tolerates airing entries and rejects offsets past the end', () => {
    expect(verifyPlannedLink({ episodeOffset: 0 }, 1200, 1100, true)).toBe(true);
    expect(verifyPlannedLink({ episodeOffset: 0 }, 1200, 1100, false)).toBe(false);
    expect(verifyPlannedLink({ episodeOffset: 1100 }, 10, 1100, true)).toBe(false);
    expect(verifyPlannedLink({ episodeOffset: 0 }, 0, 50, false)).toBe(true);
    expect(verifyPlannedLink({ episodeOffset: 0 }, 12, 0, false)).toBe(false);
  });
});

describe('continuation guard', () => {
  it('an OVA sharing the franchise name does not shift later seasons', () => {
    const plans = planChainFillerLinks([
      entry('anime:6702', ['FAIRY TAIL'], 175),
      entry('anime:1', ['FAIRY TAIL OVA'], 9, 'OVA'),
      entry('anime:20626', ['FAIRY TAIL (2014)'], 102),
    ], INDEX);
    expect(plans.map(p => [p.externalId, p.episodeOffset])).toEqual([['anime:6702', 0], ['anime:20626', 175]]);
  });
});
