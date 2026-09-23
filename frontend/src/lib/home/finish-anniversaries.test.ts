import { describe, expect, it } from 'vitest';
import {
  findFinishAnniversaries,
  isAnniversaryOf,
  parseFinishedAt,
  type AnniversaryCatalogRow,
  type AnniversaryLibraryEntry,
} from './finish-anniversaries';

function entry(id: string, finishedAt: string | null, type = 'anime'): AnniversaryLibraryEntry {
  return { external_id: id, type, finished_at: finishedAt };
}

function row(id: string, title: string | null, cover: string | null = null): AnniversaryCatalogRow {
  return { external_id: id, title_main: title, cover_url: cover };
}

// Local noon, so no test depends on the machine's time zone.
const localDay = (y: number, m: number, d: number) => new Date(y, m - 1, d, 12, 0, 0);

describe('parseFinishedAt', () => {
  it('takes a plain YYYY-MM-DD literally', () => {
    expect(parseFinishedAt('2019-09-23')).toEqual({ year: 2019, month: 9, day: 23 });
    expect(parseFinishedAt(' 2019-9-3 ')).toEqual({ year: 2019, month: 9, day: 3 });
  });

  it('rejects empty, sentinel and impossible dates', () => {
    expect(parseFinishedAt(null)).toBeNull();
    expect(parseFinishedAt('')).toBeNull();
    expect(parseFinishedAt('null-null-null')).toBeNull();
    expect(parseFinishedAt('2019-02-30')).toBeNull();
    expect(parseFinishedAt('2019-13-01')).toBeNull();
    expect(parseFinishedAt('0')).toBeNull();
    expect(parseFinishedAt('yesterday')).toBeNull();
  });

  it('accepts Feb 29 only in leap years', () => {
    expect(parseFinishedAt('2020-02-29')).toEqual({ year: 2020, month: 2, day: 29 });
    expect(parseFinishedAt('2021-02-29')).toBeNull();
  });

  it('reads ISO datetimes and SQLite datetimes in local time', () => {
    const local = localDay(2018, 9, 23);
    expect(parseFinishedAt(local.toISOString())).toEqual({ year: 2018, month: 9, day: 23 });
    expect(parseFinishedAt('2018-09-23 12:30:00')).toEqual({ year: 2018, month: 9, day: 23 });
    expect(parseFinishedAt('2018-09-23T08:00:00')).toEqual({ year: 2018, month: 9, day: 23 });
  });

  it('reads numeric timestamps in seconds or milliseconds', () => {
    const local = localDay(2017, 9, 23);
    expect(parseFinishedAt(String(local.getTime()))).toEqual({ year: 2017, month: 9, day: 23 });
    expect(parseFinishedAt(String(Math.floor(local.getTime() / 1000)))).toEqual({ year: 2017, month: 9, day: 23 });
  });
});

describe('isAnniversaryOf', () => {
  it('matches the same month and day', () => {
    expect(isAnniversaryOf({ year: 2010, month: 9, day: 23 }, { year: 2026, month: 9, day: 23 })).toBe(true);
    expect(isAnniversaryOf({ year: 2010, month: 9, day: 22 }, { year: 2026, month: 9, day: 23 })).toBe(false);
  });

  it('shows Feb 29 finishes on Feb 28 of non-leap years only', () => {
    const leapFinish = { year: 2020, month: 2, day: 29 };
    expect(isAnniversaryOf(leapFinish, { year: 2026, month: 2, day: 28 })).toBe(true);
    expect(isAnniversaryOf(leapFinish, { year: 2028, month: 2, day: 28 })).toBe(false);
    expect(isAnniversaryOf(leapFinish, { year: 2028, month: 2, day: 29 })).toBe(true);
    expect(isAnniversaryOf({ year: 2021, month: 2, day: 28 }, { year: 2028, month: 2, day: 29 })).toBe(false);
  });
});

describe('findFinishAnniversaries', () => {
  const today = localDay(2026, 9, 23);

  it('keeps only past years, grouped oldest first and alphabetical within a year', () => {
    const groups = findFinishAnniversaries(
      [
        entry('a', '2024-09-23'),
        entry('b', '2016-09-23', 'game'),
        entry('c', '2024-09-23'),
        entry('this-year', '2026-09-23'),
        entry('other-day', '2020-09-24'),
        entry('no-date', null),
      ],
      [row('a', 'Zeta'), row('b', 'Bravo', 'https://img/b.jpg'), row('c', 'Alpha')],
      today,
    );
    expect(groups.map(g => [g.year, g.yearsAgo])).toEqual([[2016, 10], [2024, 2]]);
    expect(groups[1].items.map(i => i.title)).toEqual(['Alpha', 'Zeta']);
    expect(groups[0].items[0]).toEqual({
      externalId: 'b', type: 'game', title: 'Bravo', coverUrl: 'https://img/b.jpg', year: 2016, yearsAgo: 10,
    });
  });

  it('falls back to the external id when the catalog has no title', () => {
    const [group] = findFinishAnniversaries([entry('anime:a:1', '2020-09-23')], [row('anime:a:1', '  ')], today);
    expect(group.items[0]).toMatchObject({ title: 'anime:a:1', coverUrl: null });
  });

  it('lists a Feb 29 finish on Feb 28 of a non-leap year', () => {
    const groups = findFinishAnniversaries([entry('leap', '2024-02-29')], [], localDay(2027, 2, 28));
    expect(groups).toHaveLength(1);
    expect(groups[0].yearsAgo).toBe(3);
  });

  it('returns nothing when no finish matches', () => {
    expect(findFinishAnniversaries([entry('x', '2020-01-01')], [], today)).toEqual([]);
  });
});
