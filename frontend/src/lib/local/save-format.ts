// Display helpers for the emulator save manager (GameSavesSection): relative
// dates, slot names and the settings' history-size input. Pure, no DOM.
import type { SaveEntry } from '../tauri/saves';

const UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ['year', 365 * 24 * 3600_000],
  ['month', 30 * 24 * 3600_000],
  ['week', 7 * 24 * 3600_000],
  ['day', 24 * 3600_000],
  ['hour', 3600_000],
  ['minute', 60_000],
];

/** "3 hours ago" / "yesterday" in the given locale; "now" under a minute. */
export function formatRelativeTime(timestampMs: number, nowMs: number, locale: string): string {
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  const diff = timestampMs - nowMs;
  for (const [unit, size] of UNITS) {
    if (Math.abs(diff) >= size) return formatter.format(Math.round(diff / size), unit);
  }
  return formatter.format(0, 'second');
}

export function formatAbsoluteTime(timestampMs: number, locale: string): string {
  return new Date(timestampMs).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' });
}

export interface SlotLabels {
  slot: string;
  slot_auto: string;
  slot_resume: string;
}

/** "Slot 3", "Auto", "Resume", or null when the name encodes no slot. */
export function slotLabel(slot: string | null, labels: SlotLabels): string | null {
  if (slot === null || slot === '') return null;
  if (slot === 'auto') return labels.slot_auto;
  if (slot === 'resume') return labels.slot_resume;
  return labels.slot.replace('{slot}', slot);
}

export const HISTORY_KEEP_MIN = 1;
export const HISTORY_KEEP_MAX = 50;
export const HISTORY_KEEP_DEFAULT = 5;

/** The settings field, clamped like the Rust side (1–50, default 5). */
export function parseHistoryKeep(raw: string): number {
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value)) return HISTORY_KEEP_DEFAULT;
  return Math.min(HISTORY_KEEP_MAX, Math.max(HISTORY_KEEP_MIN, value));
}

/** Battery saves first, then states; the game's own before shared cards; newest first. */
export function groupSaves(entries: SaveEntry[]): { battery: SaveEntry[]; states: SaveEntry[] } {
  const byDate = (a: SaveEntry, b: SaveEntry) => Number(a.shared) - Number(b.shared) || b.modifiedMs - a.modifiedMs;
  return {
    battery: entries.filter(entry => entry.kind === 'battery').sort(byDate),
    states: entries.filter(entry => entry.kind === 'state').sort(byDate),
  };
}
