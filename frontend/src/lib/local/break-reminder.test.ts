import { describe, it, expect } from 'vitest';
import {
  addClockAlert, breakToastText, formatSessionDuration, intervalHoursValue, parseClockTime, parseIntervalHours,
  type BreakToastStrings,
} from './break-reminder';

const t: BreakToastStrings = {
  break_toast_title: "You've been playing {title} for {duration} — time for a short break?",
  clock_toast_title: "It's {time} — you've been playing {title} for {duration}",
  break_toast_started: 'Started at {time}',
  break_toast_today: 'Today: {duration}',
};

describe('break reminder settings helpers', () => {
  it('maps stored minutes (old presets and custom values) to the hours box', () => {
    expect(intervalHoursValue(0)).toBe('0');
    expect(intervalHoursValue(60)).toBe('1');
    expect(intervalHoursValue(240)).toBe('4');
    expect(intervalHoursValue(90)).toBe('1.5');
    expect(intervalHoursValue(75)).toBe('1.25');
  });

  it('parses the hours box: 0 or empty is off, otherwise 0.5–12', () => {
    expect(parseIntervalHours('')).toBe(0);
    expect(parseIntervalHours('0')).toBe(0);
    expect(parseIntervalHours('-2')).toBe(0);
    expect(parseIntervalHours('1,5')).toBe(90);
    expect(parseIntervalHours('0.1')).toBe(30);
    expect(parseIntervalHours('20')).toBe(720);
    expect(parseIntervalHours('x')).toBeNull();
  });

  it('adds valid, distinct, sorted clock times up to six', () => {
    expect(parseClockTime('7:05')).toBe('07:05');
    expect(parseClockTime('24:00')).toBeNull();
    let alerts = addClockAlert([], '23:00');
    alerts = addClockAlert(alerts, '21:30');
    expect(alerts.map(a => a.time)).toEqual(['21:30', '23:00']);
    expect(addClockAlert(alerts, '23:00')).toBe(alerts);
    const full = ['01:00', '02:00', '03:00', '04:00', '05:00', '06:00'].reduce(addClockAlert, [] as typeof alerts);
    expect(addClockAlert(full, '07:00')).toBe(full);
  });
});

describe('break toast text', () => {
  it('formats durations without zero parts', () => {
    expect(formatSessionDuration(120)).toBe('2 h');
    expect(formatSessionDuration(190)).toBe('3 h 10 m');
    expect(formatSessionDuration(45)).toBe('45 m');
  });

  it('builds the break headline and adds today only when other sessions ran', () => {
    const payload = {
      kind: 'break' as const, title: 'Hades', cover_url: null, played_minutes: 120,
      started_unix: 1_700_000_000, today_minutes: null, clock_time: null,
    };
    const text = breakToastText(payload, t, 'en-GB');
    expect(text.title).toBe("You've been playing Hades for 2 h — time for a short break?");
    expect(text.meta).toMatch(/^Started at \d{2}:\d{2}$/);
    expect(breakToastText({ ...payload, today_minutes: 220 }, t, 'en-GB').meta).toMatch(/ · Today: 3 h 40 m$/);
  });

  it('builds the clock headline with the locale time', () => {
    const text = breakToastText({
      kind: 'clock', title: 'Hades', cover_url: null, played_minutes: 190,
      started_unix: 1_700_000_000, today_minutes: null, clock_time: '23:00',
    }, t, 'en-GB');
    expect(text.title).toBe("It's 23:00 — you've been playing Hades for 3 h 10 m");
  });
});
