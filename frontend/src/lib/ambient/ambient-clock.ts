// The screensaver's clock: time without seconds and a long date, both in the
// app's locale, and how long to sleep until the minute changes.

export interface AmbientClockText {
  time: string;
  date: string;
}

export function formatAmbientClock(now: Date, locale: string): AmbientClockText {
  let timeFormat: Intl.DateTimeFormat;
  let dateFormat: Intl.DateTimeFormat;
  try {
    timeFormat = new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' });
    dateFormat = new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long' });
  } catch {
    timeFormat = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
    dateFormat = new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
  }
  return { time: timeFormat.format(now), date: dateFormat.format(now) };
}

/** Milliseconds until the next minute starts (at least 1). */
export function msUntilNextMinute(now: Date): number {
  return Math.max(1, 60_000 - (now.getSeconds() * 1000 + now.getMilliseconds()));
}
