import type { IN_PROGRESS_STATUSES } from '../constants/media';

// Interfaz normalizada que consume buildMediaHtml, independiente del proveedor

export interface MediaStat {
  label: string;
  value: string;
  /** Optional second label/value pair rendered in the same row, divided by
   *  a vertical rule — e.g. a TV series' "Episodios 65 | Temporadas 5"
   *  instead of two separate stat rows. */
  label2?: string;
  value2?: string;
  /** The provider's own global score (0-10 scale, in `value`) — rendered
   *  centered, label-less, formatted per the user's own configured rating
   *  system (stars/decimal/emoji/...) instead of a plain "X.X / 10" string. */
  isScore?: boolean;
}

export interface MediaCharacter {
  id?: string;
  name: string;
  image?: string;
  role?: string;
}

/** Real-world crew (director, writer, composer, ...) — same card shape as
 *  MediaCharacter but a semantically distinct list, persisted to its own
 *  `media_staff`/`staff_appearances` tables rather than `characters`. */
export type MediaStaffMember = MediaCharacter;

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
  /** Title in its original-language script (e.g. Japanese kanji/kana) — maps
   *  to media_catalog.title_native. */
  titleNative?: string;
  /** Romanized title, when the provider actually distinguishes one from the
   *  main title (currently only AniList/IGDB) — maps to media_catalog.title_romaji.
   *  Not the same as titleEnglish, which is just a display-only alternate
   *  title with no dedicated catalog column. */
  titleRomaji?: string;
  /** Display-only alternate title — maps to media_catalog.title_english so
   *  the catalog-only fast path can show it without waiting on a live fetch
   *  (it used to have no dedicated column at all, so it only ever appeared
   *  once a live/full fetch resolved, flashing in after the rest of the
   *  page). */
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
  staff?: MediaStaffMember[];
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
  releaseEndYear?: number;
  releaseEndMonth?: number;
  releaseEndDay?: number;    // AniList raw.endDate — persisted so the catalog-only fast path can show the "start - end" dateBadge range instead of just the start date
  platforms?: string[];
  scoreGlobal?: number;
  timeLength?: number;
  status?: string;
  totalCount?: number;
  totalCount_2?: number;
  countryOfOrigin?: string;    // ISO-ish country code (AniList/TMDB) — persisted to media_catalog.country_code so the catalog-only fast path can show "País de origen" without a live fetch
  companies?: string[];        // developer/publisher (games), animation studio (anime), production company (movies/series) — persisted to media_catalog.companies_cache_csv
  publishers?: string[];       // games only (IGDB) — publisher subset of `companies`, persisted separately to media_catalog.publishers_csv so the catalog-only fast path can show a publisher-only line without guessing which of `companies` that is
  authors?: MediaAuthor[];     // author objects (books, anime creators) — persisted to media_author table
  hasSaga?: boolean;           // AniList entry has a direct PREQUEL/SEQUEL relation — shows the SagaViewer button
}
