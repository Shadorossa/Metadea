// Pure helpers for the break reminder and clock alerts: the settings form
// (Settings › Accessibility) and the floating toast's text (screenshot-toast page).
import type { ClockAlert } from '../tauri/game-break-reminder';

/** The hours box (Settings › Accessibility): 0 or empty = off, else 0.5–12. */
export const MIN_INTERVAL_HOURS = 0.5;
export const MAX_INTERVAL_HOURS = 12;
export const MAX_CLOCK_ALERTS = 6;
export const CLOCK_ALERT_PRESET = '23:00';

/** Stored minutes to the hours box: 0 → "0" (off), 120 → "2", 90 → "1.5". */
export function intervalHoursValue(minutes: number): string {
  if (!minutes || minutes <= 0) return '0';
  return String(Math.round((minutes / 60) * 100) / 100);
}

/** The hours box (comma or dot) to minutes: empty or ≤ 0 → 0 (off), else
 *  clamped to 0.5–12 h; null when it is not a number. */
export function parseIntervalHours(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return 0;
  const value = Number.parseFloat(trimmed.replace(',', '.'));
  if (!Number.isFinite(value)) return null;
  if (value <= 0) return 0;
  const hours = Math.min(MAX_INTERVAL_HOURS, Math.max(MIN_INTERVAL_HOURS, value));
  return Math.round(hours * 60);
}

export function parseClockTime(raw: string): string | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(raw.trim());
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h > 23 || m > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Adds a time (kept sorted); unchanged when invalid, duplicated or full. */
export function addClockAlert(alerts: ClockAlert[], raw: string): ClockAlert[] {
  const time = parseClockTime(raw);
  if (!time || alerts.length >= MAX_CLOCK_ALERTS || alerts.some(a => a.time === time)) return alerts;
  return [...alerts, { time, weekdaysOnly: false }].sort((a, b) => a.time.localeCompare(b.time));
}

/** "23:00" in the locale's own clock format ("11:00 PM" in en-US). */
export function formatClockTime(hhmm: string, locale: string): string {
  const time = parseClockTime(hhmm);
  if (!time) return hhmm;
  const [h, m] = time.split(':').map(Number);
  return new Date(2000, 0, 1, h, m).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
}

export function formatUnixClock(unixSeconds: number, locale: string): string {
  return new Date(unixSeconds * 1000).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
}

/** "2 h", "3 h 10 m", "45 m" — a break toast reads better without zero parts. */
export function formatSessionDuration(minutes: number): string {
  const total = Math.max(0, Math.floor(minutes));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m} m`;
  return m === 0 ? `${h} h` : `${h} h ${m} m`;
}

export interface GameBreakToastPayload {
  kind: 'break' | 'clock';
  title: string;
  cover_url: string | null;
  played_minutes: number;
  started_unix: number;
  today_minutes: number | null;
  clock_time: string | null;
}

export interface BreakToastStrings {
  break_toast_title: string;
  clock_toast_title: string;
  break_toast_started: string;
  break_toast_today: string;
}

function fill(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) => vars[key] ?? whole);
}

/** The toast's headline and its "Started at 18:05 · Today: 3 h 40 m" line. */
export function breakToastText(payload: GameBreakToastPayload, t: BreakToastStrings, locale: string): { title: string; meta: string } {
  const duration = formatSessionDuration(payload.played_minutes);
  const title = payload.kind === 'clock' && payload.clock_time
    ? fill(t.clock_toast_title, { time: formatClockTime(payload.clock_time, locale), title: payload.title, duration })
    : fill(t.break_toast_title, { title: payload.title, duration });
  const meta = [fill(t.break_toast_started, { time: formatUnixClock(payload.started_unix, locale) })];
  if (payload.today_minutes && payload.today_minutes > payload.played_minutes) {
    meta.push(fill(t.break_toast_today, { duration: formatSessionDuration(payload.today_minutes) }));
  }
  return { title, meta: meta.join(' · ') };
}
