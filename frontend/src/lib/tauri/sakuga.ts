import { tauriTry } from './bridge';

// ── Sakuga clips (src-tauri/src/sakuga) ─────────────────────────────────────
// Sakugabooru, rate-limited and cached in SQLite on the Rust side. Every
// call is a read whose absence the UI represents (the tab or section just
// doesn't appear), so failures degrade to "nothing".

export interface SakugaTag {
  name: string;
  count: number;
}

export interface SakugaPost {
  id: number;
  /** Space-separated tag names. */
  tags: string;
  /** Community upvotes. */
  score: number;
  /** s (safe) | q (questionable) | e (explicit). */
  rating: string;
  /** Free text, e.g. "#06 (BD) (Action AD: Toru Iwazawa)". */
  source: string;
  fileUrl: string;
  fileExt: string;
  previewUrl: string;
  width: number;
  height: number;
  fileSize: number;
  createdAt: number;
}

export interface SakugaPostPage {
  posts: SakugaPost[];
  /** Every post matching the query, across all pages. */
  total: number;
  page: number;
  limit: number;
  /** Posts on this page before the rating filter. */
  rawCount: number;
}

/** A staff member's artist tag, confirmed against Sakugabooru (cached). */
export function resolveSakugaArtist(staffId: string, names: string[]): Promise<SakugaTag | null> {
  return tauriTry<SakugaTag | null>('sakuga_resolve_artist', null, { staffId, names });
}

/** An anime's series tag; `titles` in order of preference. */
export function resolveSakugaSeries(externalId: string, titles: string[]): Promise<SakugaTag | null> {
  return tauriTry<SakugaTag | null>('sakuga_resolve_series', null, { externalId, titles });
}

/** Staff id → artist tag for the already-resolved ones. Never fetches. */
export function getCachedSakugaArtists(staffIds: string[]): Promise<Record<string, string>> {
  return tauriTry<Record<string, string>>('sakuga_cached_artists', {}, { staffIds });
}

/** One page of posts with all of `tags`, most voted first. */
export function getSakugaPosts(tags: string[], page: number, limit: number, includeAdult: boolean): Promise<SakugaPostPage | null> {
  return tauriTry<SakugaPostPage | null>('sakuga_posts', null, { tags, page, limit, includeAdult });
}

/** Series tags an artist's posts carry, most frequent first. */
export function getSakugaRelatedSeries(artistTag: string): Promise<SakugaTag[]> {
  return tauriTry<SakugaTag[]>('sakuga_related_series', [], { artistTag });
}
