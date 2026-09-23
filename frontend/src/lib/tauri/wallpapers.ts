import { tauriCmd } from './bridge';

// ── Wallpapers (src-tauri/src/wallpapers.rs) ────────────────────────────────

export interface WallpaperRow {
  external_id: string;
  /** null: no landscape wallpaper (or not resolvable right now). */
  url: string | null;
  /** `backdrop` (TMDB) | `artwork` / `screenshot` (IGDB) | `banner` (AniList). */
  kind: string | null;
}

/** Batch resolve, up to 200 ids (cached on the Rust side: hits 30 days,
 *  "none" 7). Only movie/series/game/vnovel/anime/manga ids can resolve.
 *  Never rejects for a provider failure — those ids come back `url: null`. */
export async function resolveWallpapers(externalIds: string[]): Promise<WallpaperRow[]> {
  return tauriCmd<WallpaperRow[]>('resolve_wallpapers', [], { externalIds });
}
