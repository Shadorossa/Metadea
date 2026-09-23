import { describe, expect, it } from 'vitest';
import { en } from '../../i18n/en';
import {
  decadeOf,
  groupTimeline,
  isMasterpiece,
  layoutTimeline,
  MASTERPIECE_SCORE,
  timelineSummary,
  timelineSummaryParts,
  visibleColumns,
} from './career-timeline';

interface Work { id: string; year: number | null; score?: number | null }

const FROMSOFTWARE: Work[] = [
  { id: "King's Field", year: 1994, score: 7.2 },
  { id: 'Armored Core', year: 1997, score: 7.4 },
  { id: "Demon's Souls", year: 2009, score: 8.9 },
  { id: 'Dark Souls', year: 2011, score: 9.1 },
  { id: 'Bloodborne', year: 2015, score: 9.2 },
  { id: 'Dark Souls III', year: 2016, score: 8.8 },
  { id: 'Déraciné', year: 2018, score: 7.0 },
  { id: 'Sekiro', year: 2019, score: 9.0 },
  { id: 'Elden Ring', year: 2022, score: 9.5 },
  { id: 'Armored Core VI', year: 2023, score: null },
  { id: 'Next game', year: null },
  { id: 'Metal Wolf Chaos', year: 2004 },
  { id: 'Otogi', year: 2002 },
  { id: 'Otogi 2', year: 2002 },
];

const yearOf = (w: Work) => w.year;
const scoreOf = (w: Work) => w.score;

describe('isMasterpiece', () => {
  it('uses 8 on the 0–10 scale, inclusive', () => {
    expect(MASTERPIECE_SCORE).toBe(8);
    expect(isMasterpiece(8)).toBe(true);
    expect(isMasterpiece(9.7)).toBe(true);
    expect(isMasterpiece(7.99)).toBe(false);
  });

  it('gives no halo without a score', () => {
    expect(isMasterpiece(null)).toBe(false);
    expect(isMasterpiece(undefined)).toBe(false);
    expect(isMasterpiece(Number.NaN)).toBe(false);
  });
});

describe('groupTimeline', () => {
  const columns = groupTimeline(FROMSOFTWARE, yearOf);

  it('makes one column per year with works, oldest first, keeping order within a year', () => {
    const dated = columns.filter(c => c.year != null);
    expect(dated.map(c => c.year)).toEqual([1994, 1997, 2002, 2004, 2009, 2011, 2015, 2016, 2018, 2019, 2022, 2023]);
    expect(dated.find(c => c.year === 2002)?.works.map(w => w.id)).toEqual(['Otogi', 'Otogi 2']);
  });

  it('marks the first column of every decade', () => {
    expect(columns.filter(c => c.decadeStart && c.year != null).map(c => c.year)).toEqual([1994, 2002, 2011, 2022]);
    expect(columns.find(c => c.year === 1997)?.decade).toBe(1990);
    expect(decadeOf(2009)).toBe(2000);
  });

  it('puts undated works in one bucket at the end', () => {
    const last = columns[columns.length - 1];
    expect(last.key).toBe('unknown');
    expect(last.year).toBeNull();
    expect(last.works.map(w => w.id)).toEqual(['Next game']);
    expect(groupTimeline([{ id: 'a', year: 2000 }], yearOf).some(c => c.key === 'unknown')).toBe(false);
  });

  it('is empty for no works', () => {
    expect(groupTimeline([], yearOf)).toEqual([]);
  });
});

describe('layoutTimeline', () => {
  const options = { slotWidth: 80, maxRows: 3, decadeGap: 30, columnGap: 14 };

  it('stacks up to maxRows and widens a crowded year into lanes', () => {
    const works = [...Array(7)].map((_, i) => ({ id: `w${i}`, year: 2001 }));
    const layout = layoutTimeline(groupTimeline([...works, { id: 'x', year: 2002 }], yearOf), options);
    expect(layout.rows).toBe(3);
    expect(layout.columns[0].lanes).toBe(3);
    expect(layout.columns[0].width).toBe(240);
    expect(layout.columns[1].x).toBe(240 + 14);
  });

  it('adds the decade gap before a new decade and fixes every position up front', () => {
    const layout = layoutTimeline(groupTimeline([{ id: 'a', year: 1999 }, { id: 'b', year: 2000 }], yearOf), options);
    expect(layout.rows).toBe(1);
    expect(layout.columns.map(c => c.x)).toEqual([0, 80 + 14 + 30]);
    expect(layout.totalWidth).toBe(80 + 14 + 30 + 80);
  });

  it('renders only the columns overlapping the window', () => {
    const works = [...Array(50)].map((_, i) => ({ id: `w${i}`, year: 1950 + i }));
    const layout = layoutTimeline(groupTimeline(works, yearOf), options);
    const shown = visibleColumns(layout, 1000, 1600);
    expect(shown.length).toBeGreaterThan(0);
    expect(shown.length).toBeLessThan(50);
    expect(shown.every(c => c.x + c.width >= 1000 && c.x <= 1600)).toBe(true);
  });
});

describe('timelineSummary', () => {
  it('reports the active years, the masterpieces and the peak decade', () => {
    const summary = timelineSummary(FROMSOFTWARE, yearOf, scoreOf);
    expect(summary).toEqual({ firstYear: 1994, lastYear: 2023, masterpieces: 6, peakDecade: 2010 });
    expect(timelineSummaryParts(summary, en.creator_completion)).toEqual([
      'Active 1994–2023',
      '6 masterpieces',
      'peak decade: 2010s',
    ]);
  });

  it('falls back to the busiest decade without masterpieces, earlier on a tie', () => {
    const works: Work[] = [{ id: 'a', year: 1985 }, { id: 'b', year: 1991 }, { id: 'c', year: 1993 }, { id: 'd', year: 2001 }, { id: 'e', year: 2004 }];
    expect(timelineSummary(works, yearOf, scoreOf).peakDecade).toBe(1990);
  });

  it('keeps the parts that apply', () => {
    const single = timelineSummary([{ id: 'a', year: 2020, score: 8 }], yearOf, scoreOf);
    expect(timelineSummaryParts(single, en.creator_completion)).toEqual(['Active in 2020', '1 masterpiece']);
    const undated = timelineSummary([{ id: 'a', year: null, score: 5 }], yearOf, scoreOf);
    expect(undated).toEqual({ firstYear: null, lastYear: null, masterpieces: 0, peakDecade: null });
    expect(timelineSummaryParts(undated, en.creator_completion)).toEqual([]);
  });
});
