import { tauriCmd } from './bridge';

// ── Textless covers (src-tauri/src/textless_covers.rs) ──────────────────────

/** `poster` is a real textless poster; `art` is key art the card crops. */
export type TextlessCoverKind = 'poster' | 'art';

export interface TextlessCoverRow {
  external_id: string;
  /** null: no textless version (or not resolvable right now). */
  url: string | null;
  kind: TextlessCoverKind | null;
}

/** Batch resolve (cached for 30 days on the Rust side, negatives included).
 *  Only `movie:`/`series:` (TMDB) and `game:`/`vnovel:` (IGDB) ids can
 *  resolve; any other id comes back absent. Never rejects for a provider
 *  failure — those ids simply come back with `url: null`. */
export async function resolveTextlessCovers(externalIds: string[]): Promise<TextlessCoverRow[]> {
  return tauriCmd<TextlessCoverRow[]>('resolve_textless_covers', [], { externalIds });
}
