import { describe, expect, it } from 'vitest';
import { airingToday, projectToDay } from './airing-today';

// All times local, so the tests hold in any time zone.
const now = new Date(2026, 8, 23, 12, 0);
const unix = (d: Date) => Math.floor(d.getTime() / 1000);
const lookup = (id: string) => (id === 'anime:gone' ? null : { title: `T ${id}`, coverUrl: `https://c/${id}.jpg` });

describe('projectToDay', () => {
  it('matches the next episode when it airs today, whatever the hour', () => {
    expect(projectToDay({ externalId: 'anime:1', airingAt: unix(new Date(2026, 8, 23, 23, 30)), episode: 5 }, now)).toBe(5);
    expect(projectToDay({ externalId: 'anime:1', airingAt: unix(new Date(2026, 8, 23, 0, 5)), episode: 5 }, now)).toBe(5);
  });

  it('projects one week at most', () => {
    expect(projectToDay({ externalId: 'anime:1', airingAt: unix(new Date(2026, 8, 16, 18, 0)), episode: 5 }, now)).toBe(6);
    // Two weeks back: likely on break, not extrapolated.
    expect(projectToDay({ externalId: 'anime:1', airingAt: unix(new Date(2026, 8, 9, 18, 0)), episode: 5 }, now)).toBeNull();
  });

  it('ignores other days', () => {
    expect(projectToDay({ externalId: 'anime:1', airingAt: unix(new Date(2026, 8, 24, 1, 0)), episode: 5 }, now)).toBeNull();
    expect(projectToDay({ externalId: 'anime:1', airingAt: unix(new Date(2026, 8, 30, 12, 0)), episode: 5 }, now)).toBeNull();
  });
});

describe('airingToday', () => {
  const schedule = [
    { externalId: 'anime:late', airingAt: unix(new Date(2026, 8, 23, 22, 0)), episode: 3 },
    { externalId: 'anime:early', airingAt: unix(new Date(2026, 8, 23, 0, 30)), episode: 11 },
    { externalId: 'anime:gone', airingAt: unix(new Date(2026, 8, 23, 9, 0)), episode: 1 },
    { externalId: 'anime:tomorrow', airingAt: unix(new Date(2026, 8, 24, 0, 5)), episode: 1 },
  ];

  it("uses the calendar's cells for today when it has any, with episode numbers when known", () => {
    const rows = airingToday(
      schedule,
      [
        { externalId: 'movie:1', releaseDate: new Date(2026, 8, 23), title: 'B premiere', cover: '' },
        { externalId: 'anime:late', releaseDate: new Date(2026, 8, 23), title: 'A show', cover: 'https://c/late.jpg' },
        { externalId: 'movie:2', releaseDate: new Date(2026, 8, 22), title: 'Yesterday', cover: '' },
      ],
      now,
      lookup,
    );
    expect(rows).toEqual([
      { externalId: 'anime:late', title: 'A show', coverUrl: 'https://c/late.jpg', episode: 3 },
      { externalId: 'movie:1', title: 'B premiere', coverUrl: null, episode: null },
    ]);
  });

  it('falls back to the airing schedule when the calendar has nothing today', () => {
    const rows = airingToday(schedule, [], now, lookup);
    expect(rows.map(r => [r.externalId, r.episode])).toEqual([
      ['anime:early', 11],
      ['anime:late', 3],
    ]);
  });
});
