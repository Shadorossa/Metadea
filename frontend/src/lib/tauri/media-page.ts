import { tauriCmd, wrapAssetUrl } from './bridge';
import { getPreferredCover } from '../media/cover-preferences';
import type { MediaCatalogEntry, DbMediaRelation, DbMediaAuthor } from './catalog';
import type { DbMediaCharacter } from './characters';
import type { DbMediaStaffMember } from './staff';
import type { DbMediaCompany } from './companies';
import type { SyncStateEntry } from './sync-state';
import type { LibraryEntry } from './library';
import type { MediaEpisode } from './episodes';
import type { MediaTheme } from './themes';

// ── Media page mount bundle ─────────────────────────────────────────────────
// Everything the media page reads from the local DB the moment it mounts,
// in one round trip (see media_page_bundle.rs). Each part is the exact row
// set its standalone command returns, so lib/media/media-page-read-cache.ts
// can hand it out through the same per-part getters the page already uses.

export interface MediaPageBundle {
  catalog: MediaCatalogEntry | null;
  relations: DbMediaRelation[];
  authors: DbMediaAuthor[];
  /** image_url is already a loadable URL (wrapAssetUrl applied to the
   *  portrait's file path) — display only, never write it back through
   *  saveCharactersSkeleton, which expects a data URL or the stored value. */
  characters: DbMediaCharacter[];
  staff: DbMediaStaffMember[];
  companies: DbMediaCompany[];
  sync_state: SyncStateEntry | null;
  library_entry: LibraryEntry | null;
  episodes: MediaEpisode[];
  themes: MediaTheme[];
}

export async function getMediaPageBundle(externalId: string): Promise<MediaPageBundle | null> {
  const bundle = await tauriCmd<MediaPageBundle | null>('get_media_page_bundle', null, { externalId });
  if (!bundle) return null;
  return {
    ...bundle,
    // Same cover-preference fold getCatalogEntry applies.
    catalog: bundle.catalog ? { ...bundle.catalog, cover_url: getPreferredCover(bundle.catalog.external_id, bundle.catalog.cover_url) } : null,
    characters: bundle.characters.map(character => character.image_url
      ? { ...character, image_url: wrapAssetUrl(character.image_url) }
      : character),
  };
}

// ── Anime PREQUEL/SEQUEL chain ──────────────────────────────────────────────
// Prequels (earliest first), the entry itself, then sequels — the walk
// buildAnimeChain (lib/media/episodes/anime-tmdb-match.ts) used to do one
// relation/catalog read at a time, computed in Rust from the same rows.
// Empty when externalId isn't a visible anime.

export interface AnimeChainRow {
  external_id: string;
  title_main: string | null;
  title_english: string | null;
  title_romaji: string | null;
  title_native: string | null;
  total_count: number | null;
  format: string | null;
  release_year: number | null;
  status: string | null;
}

export async function getAnimeChain(externalId: string): Promise<AnimeChainRow[]> {
  return tauriCmd<AnimeChainRow[]>('get_anime_chain', [], { externalId });
}
