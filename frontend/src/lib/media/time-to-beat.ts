// Pure helpers for the "how long to beat" block (components/shared/
// TimeToBeatBlock): which pills to show, how their hours read, and how far
// the user's own playtime is into the main story.
import type { TimeToBeat } from '../tauri/time-to-beat';

export type TimeToBeatKind = 'main' | 'extra' | 'completionist';

export interface TimeToBeatPill {
  kind: TimeToBeatKind;
  seconds: number;
}

/** The lengths the source actually has, in Main → Completionist order. */
export function timeToBeatPills(ttb: TimeToBeat): TimeToBeatPill[] {
  const pills: TimeToBeatPill[] = [];
  if (ttb.mainSeconds && ttb.mainSeconds > 0) pills.push({ kind: 'main', seconds: ttb.mainSeconds });
  if (ttb.extraSeconds && ttb.extraSeconds > 0) pills.push({ kind: 'extra', seconds: ttb.extraSeconds });
  if (ttb.completionistSeconds && ttb.completionistSeconds > 0) pills.push({ kind: 'completionist', seconds: ttb.completionistSeconds });
  return pills;
}

export type VndbLengthKey = 'length_very_short' | 'length_short' | 'length_medium' | 'length_long' | 'length_very_long';

const VNDB_LENGTH_KEYS: readonly VndbLengthKey[] = [
  'length_very_short', // < 2 h
  'length_short',      // 2–10 h
  'length_medium',     // 10–30 h
  'length_long',       // 30–50 h
  'length_very_long',  // > 50 h
];

/** VNDB's 1–5 length estimate → its i18n key (time_to_beat.*). */
export function vndbLengthKey(bucket: number | null | undefined): VndbLengthKey | null {
  if (bucket === null || bucket === undefined || !Number.isInteger(bucket)) return null;
  return VNDB_LENGTH_KEYS[bucket - 1] ?? null;
}

export function hasTimeToBeatData(ttb: TimeToBeat | null | undefined): ttb is TimeToBeat {
  return !!ttb && (timeToBeatPills(ttb).length > 0 || vndbLengthKey(ttb.lengthBucket) !== null);
}

/** Hours as a lengths table reads them: halves below 10 h ("7.5"), whole
 *  hours above ("32"), never below half an hour. */
export function roundBeatHours(minutes: number): number {
  const hours = Math.max(0, minutes) / 60;
  if (hours < 10) return Math.max(0.5, Math.round(hours * 2) / 2);
  return Math.round(hours);
}

/** `template` is an i18n string with `{hours}` ("{hours} h"). */
export function formatBeatHours(minutes: number, template: string, locale?: string): string {
  const hours = roundBeatHours(minutes);
  const text = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(hours);
  return template.replace('{hours}', text);
}

export interface BeatProgress {
  playedMinutes: number;
  targetMinutes: number;
  /** 0–1, clamped: past the target the bar is simply full. */
  ratio: number;
  done: boolean;
  remainingMinutes: number;
}

/** Playtime against the main-story length; null without either. */
export function beatProgress(playedMinutes: number | null | undefined, mainSeconds: number | null | undefined): BeatProgress | null {
  if (!playedMinutes || !(playedMinutes > 0) || !mainSeconds || !(mainSeconds > 0)) return null;
  const targetMinutes = mainSeconds / 60;
  return {
    playedMinutes,
    targetMinutes,
    ratio: Math.min(1, playedMinutes / targetMinutes),
    done: playedMinutes >= targetMinutes,
    remainingMinutes: Math.max(0, targetMinutes - playedMinutes),
  };
}

/** Sort key for "Shortest to beat": the main story, else the extras run,
 *  else completionist; undefined (sorted last) when nothing is known. */
export function shortestBeatSeconds(ttb: TimeToBeat | undefined): number | undefined {
  if (!ttb) return undefined;
  return timeToBeatPills(ttb)[0]?.seconds;
}
