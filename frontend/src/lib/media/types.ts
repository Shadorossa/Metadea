import type { IN_PROGRESS_STATUSES } from '../constants/media';

// Interfaz normalizada que consume buildMediaHtml, independiente del proveedor

export interface MediaStat {
  label: string;
  value: string;
}

export interface MediaCharacter {
  id?: string;
  name: string;
  image?: string;
  role?: string;
}

export interface MediaRelation {
  typeLabel: string;
  /** Machine-readable relation kind (SEQUEL, PREQUEL, ADAPTATION, RECOMMENDATION, Remaster, ...) —
   *  distinct from typeLabel, which is already translated for display and must never be
   *  reparsed to recover the underlying type. */
  relationType?: string;
  title: string;
  cover?: string;
  url?: string;
  /** The related media's own external_id (e.g. "anime:123") — set directly by
   *  the mapper that produced this relation, so consumers never need to
   *  extract it by parsing `url`. */
  relatedExternalId?: string;
}

export interface MediaAuthor {
  external_id: string;
  name: string;
  image?: string;
  role?: string;
  url?: string;
}

export interface MediaPageData {
  externalId: string;          // "anime:918", "book:OL12345W"
  type: string;                // "anime" | "manga" | "lnovel" | "book"
  titleMain: string;
  titleNative?: string;
  titleEnglish?: string;
  cover?: string;
  bannerImage?: string;
  bannerColor: string;         // CSS gradient para el placeholder del banner
  statusLabel?: string;
  statusClass?: string;        // clase CSS del badge de estado
  genreDots?: string;          // "Action · Comedy · Drama" (core genres)
  genreTagDots?: string;       // secondary tags (themes, non-core)
  metaLines: string[];         // líneas del panel derecho (estudio, formato, etc.)
  dateBadge?: string;          // overlay sobre el banner con fechas
  developerBadge?: string;     // overlay sobre el banner con el desarrollador (juegos)
  // links a tiendas (juegos) — undefined: no aplica/no comprobado; null: se
  // comprobó el juego y sus ports y no hay ninguno; array: los enlaces encontrados
  storeLinks?: { platform: string; url: string }[] | null;
  description?: string;
  stats: MediaStat[];
  characters: MediaCharacter[];
  relations: MediaRelation[];
  parentGame?: { title: string; externalId: string; cover?: string }; // base game this edition/expansion belongs to
  progressStatus: typeof IN_PROGRESS_STATUSES[number];
  progressLabel: string;       // label i18n del botón de progreso en el tray
  // Catalog metadata
  format?: string;             // GAME, REMAKE, REMASTER, EXPANSION...
  source?: string;             // igdb, anilist, openlibrary, tmdb, comicvine
  sourceUrl?: string;          // this work's own page on that provider's website
  releaseYear?: number;
  releaseMonth?: number;
  releaseDay?: number;
  platforms?: string[];
  scoreGlobal?: number;
  timeLength?: number;
  status?: string;
  totalCount?: number;
  totalCount_2?: number;
  companies?: string[];        // developer/publisher (games), animation studio (anime), production company (movies/series) — persisted to media_catalog.companies_cache_csv
  authors?: MediaAuthor[];     // author objects (books, anime creators) — persisted to media_author table
  hasSaga?: boolean;           // AniList entry has a direct PREQUEL/SEQUEL relation — shows the SagaViewer button
}
