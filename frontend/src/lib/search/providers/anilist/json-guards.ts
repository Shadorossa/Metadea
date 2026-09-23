// ── Untrusted-JSON guards ─────────────────────────────────────────────────────
// The typed response shapes in types.ts are a compile-time promise only — the
// JSON AniList actually sends can be anything. Each search mapper narrows its
// row ONCE through a parse*Row guard (mappers.ts) and is written assertion-free
// from there; a row that fails the guard is skipped rather than allowed to
// throw mid-page.

export type UnknownRecord = Record<string, unknown>;

export function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null;
}

export function rowsOf(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function optionalString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

export function optionalNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

export interface AniListFuzzyDate { year: number | null; month: number | null; day: number | null }

export function fuzzyDate(value: unknown): AniListFuzzyDate | null {
  if (!isRecord(value)) return null;
  return { year: optionalNumber(value.year), month: optionalNumber(value.month), day: optionalNumber(value.day) };
}

// Page.pageInfo.hasNextPage, read defensively — anything but a literal true
// (missing pageInfo, a null, a string) means "no more pages".
export function hasNextPageOf(page: UnknownRecord): boolean {
  return isRecord(page.pageInfo) && page.pageInfo.hasNextPage === true;
}
