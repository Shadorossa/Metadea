// "On this day" on Home: library works whose first finish (finished_at)
// fell on today's month/day in some earlier year. Pure — the banner
// (components/home/FinishAnniversaryBanner.tsx) feeds it the cached
// library/catalog bundle Home already loads.
//
// finished_at is the first run's finish: save_library_entry freezes it
// while a reconsumption is in progress, so a rewatch never moves the
// anniversary.

export interface AnniversaryLibraryEntry {
  external_id: string;
  type: string;
  finished_at: string | null;
}

export interface AnniversaryCatalogRow {
  external_id: string;
  title_main: string | null;
  cover_url: string | null;
}

export interface FinishAnniversaryItem {
  externalId: string;
  type: string;
  title: string;
  coverUrl: string | null;
  year: number;
  yearsAgo: number;
}

export interface FinishAnniversaryGroup {
  year: number;
  yearsAgo: number;
  items: FinishAnniversaryItem[];
}

export interface CalendarDate {
  year: number;
  month: number; // 1-12
  day: number;
}

const DATE_ONLY_RE = /^(\d{4})-(\d{1,2})-(\d{1,2})$/;
const DIGITS_RE = /^\d+$/;
// Below this a numeric timestamp is read as Unix seconds, above as millis
// (1e11 s is the year 5138; 1e11 ms is 1973).
const SECONDS_THRESHOLD = 1e11;

function isValidCalendarDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1) return false;
  return day <= daysInMonth(year, month);
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

function isLeapYear(year: number): boolean {
  return daysInMonth(year, 2) === 29;
}

function fromLocalDate(date: Date): CalendarDate | null {
  if (Number.isNaN(date.getTime())) return null;
  return { year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate() };
}

/** The local calendar day a stored finished_at refers to, or null when it
 *  is empty or unparseable. A plain `YYYY-MM-DD` (what the editor and the
 *  player write) is taken as-is — never shifted through UTC; timestamps
 *  and full ISO datetimes are converted to local time. */
export function parseFinishedAt(value: string | null | undefined): CalendarDate | null {
  const raw = value?.trim();
  if (!raw) return null;

  const dateOnly = DATE_ONLY_RE.exec(raw);
  if (dateOnly) {
    const [year, month, day] = dateOnly.slice(1).map(Number);
    return isValidCalendarDate(year, month, day) ? { year, month, day } : null;
  }

  if (DIGITS_RE.test(raw)) {
    const n = Number(raw);
    if (!Number.isSafeInteger(n) || n === 0) return null;
    return fromLocalDate(new Date(n < SECONDS_THRESHOLD ? n * 1000 : n));
  }

  // Full ISO / "YYYY-MM-DD HH:mm:ss" (SQLite datetime) — Date.parse reads a
  // zone-less value as local time and a Z/offset one as that instant.
  const normalized = /^\d{4}-\d{2}-\d{2} \d/.test(raw) ? raw.replace(' ', 'T') : raw;
  if (!/^\d{4}-\d{2}-\d{2}T/.test(normalized)) return null;
  return fromLocalDate(new Date(normalized));
}

/** Whether a finish on `finish` is an anniversary on `today` — same month
 *  and day, or Feb 29 finishes on Feb 28 of a non-leap year. */
export function isAnniversaryOf(finish: CalendarDate, today: CalendarDate): boolean {
  if (finish.month === today.month && finish.day === today.day) return true;
  return finish.month === 2 && finish.day === 29
    && today.month === 2 && today.day === 28
    && !isLeapYear(today.year);
}

/** Every past-year finish anniversary for `today`, grouped by year —
 *  oldest first (most years ago), titles alphabetical within a year. */
export function findFinishAnniversaries(
  items: readonly AnniversaryLibraryEntry[],
  catalog: readonly AnniversaryCatalogRow[],
  now: Date,
): FinishAnniversaryGroup[] {
  const today = fromLocalDate(now);
  if (!today) return [];
  const catalogById = new Map(catalog.map(row => [row.external_id, row]));
  const seen = new Set<string>();
  const byYear = new Map<number, FinishAnniversaryItem[]>();

  for (const entry of items) {
    if (seen.has(entry.external_id)) continue;
    const finish = parseFinishedAt(entry.finished_at);
    if (!finish || finish.year >= today.year || !isAnniversaryOf(finish, today)) continue;
    seen.add(entry.external_id);
    const row = catalogById.get(entry.external_id);
    const item: FinishAnniversaryItem = {
      externalId: entry.external_id,
      type: entry.type,
      title: row?.title_main?.trim() || entry.external_id,
      coverUrl: row?.cover_url || null,
      year: finish.year,
      yearsAgo: today.year - finish.year,
    };
    const list = byYear.get(finish.year) ?? [];
    list.push(item);
    byYear.set(finish.year, list);
  }

  return [...byYear.entries()]
    .sort(([a], [b]) => a - b)
    .map(([year, list]) => ({
      year,
      yearsAgo: today.year - year,
      items: list.sort((a, b) => a.title.localeCompare(b.title) || a.externalId.localeCompare(b.externalId)),
    }));
}

