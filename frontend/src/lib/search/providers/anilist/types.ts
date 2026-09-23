import type { AniListFuzzyDate } from './json-guards';

// ── Detail types ──────────────────────────────────────────────────────────────

interface AniListCharacter {
  id: number;
  name: { full: string };
  image: { large: string | null; medium: string | null };
}

export interface AniListCharacterEdge {
  role: string;
  node: AniListCharacter;
}

interface AniListStudio {
  id: number;
  name: string;
  siteUrl: string | null;
}

interface AniListStudioEdge {
  // True for the actual (main) animation studio; false for every other
  // company involved (production committee members — shown on AniList's own
  // site as "Producers"). AniList has no separate query for producers at
  // all — both are the same `studios` connection, told apart only by this flag.
  isMain: boolean;
  node: AniListStudio;
}

interface AniListRelationEdge {
  relationType: string;
  node: {
    id: number;
    type: string;
    format: string | null;
    title: { romaji: string | null };
    coverImage: { extraLarge: string | null; large: string | null; medium: string | null };
    startDate: { year: number | null; month: number | null; day: number | null } | null;
  };
}

export interface AniListStaffEdge {
  role: string;
  node: {
    id: number;
    name: { full: string };
    image: { large: string | null; medium: string | null } | null;
  };
}

export interface AniListMediaDetail {
  id: number;
  siteUrl: string | null;
  title: { romaji: string | null; english: string | null; native: string | null };
  bannerImage: string | null;
  coverImage: { extraLarge: string | null; large: string | null; color: string | null } | null;
  description: string | null;
  format: string | null;
  status: string | null;
  episodes: number | null;
  chapters: number | null;
  volumes: number | null;
  duration: number | null;
  countryOfOrigin: string | null;
  // Only present while status is RELEASING — AniList doesn't know the final
  // episode count yet, but this tells us how many have aired so far
  // (nextAiringEpisode.episode - 1), which is what a RELEASING anime's own
  // total_count should track until it finishes airing.
  nextAiringEpisode: { episode: number } | null;
  averageScore: number | null;
  popularity: number | null;
  favourites: number | null;
  genres: string[];
  season: string | null;
  seasonYear: number | null;
  startDate: { year: number | null; month: number | null; day: number | null } | null;
  endDate: { year: number | null; month: number | null; day: number | null } | null;
  source: string | null;
  studios: { edges: AniListStudioEdge[] };
  characters: { pageInfo: { hasNextPage: boolean; total: number | null }; edges: AniListCharacterEdge[] };
  relations: { edges: AniListRelationEdge[] };
  staff: { edges: AniListStaffEdge[] };
  // AniList's own aggregation of episode listings from a handful of
  // streaming platforms — the closest thing it has to per-episode data (no
  // official episode name/still-image API of its own the way TMDB has for
  // TV). Not guaranteed complete or present at all for less popular titles.
  streamingEpisodes: { title: string | null; thumbnail: string | null }[];
}

export interface AniListStreamingEpisode { title: string | null; thumbnail: string | null }

// ── Search row types ──────────────────────────────────────────────────────────

// The narrowed row shape every search mapper works from — only the fields
// actually read, each already validated by parseAniListMedia.
export interface AniListMedia {
  id: number;
  format: string | null;
  title: { romaji: string | null; native: string | null };
  coverImage: { large: string | null } | null;
  startDate: AniListFuzzyDate | null;
  averageScore: number | null;
  genres: string[];
  // Only present on the *_ANIME query variants (see RELATIONS_FIELD in
  // queries.ts) — used solely to detect "this result is a later season" for
  // isUnifySeasonsEnabled(), never for manga/lnovel search.
  relations?: { edges: Array<{ relationType: string | null; node: { type: string | null } }> };
}

// Only the envelope is typed; the rows inside Page stay `unknown` until a
// parse*Row guard has looked at each one.
export interface AniListSearchData { Page?: unknown }

export interface AniListCharacterSearch {
  id: number;
  name: { full: string; native: string | null; alternative: string[] | null };
  image: { large: string | null } | null;
}

export interface AniListStaffSearchResult {
  id: number;
  name: string;
  nameNative: string | null;
  image: string | null;
}

export interface AniListStaffSearchRow {
  id: number;
  name: { full: string; native: string | null };
  image: { large: string | null } | null;
}

// ── Character / staff detail types ────────────────────────────────────────────

export interface AniListCharacterDetail {
  id: number;
  name: {
    full: string;
    native: string | null;
    alternative: string[];
    alternativeSpoiler: string[];
  };
  image: {
    large: string | null;
  } | null;
  description: string | null;
  gender: string | null;
  dateOfBirth: {
    year: number | null;
    month: number | null;
    day: number | null;
  } | null;
  age: string | null;
  bloodType: string | null;
  media: {
    edges: Array<{
      // Character's role in that specific work (MAIN/SUPPORTING/BACKGROUND).
      // Not to be confused with Media.relations' `relationType` (a different
      // connection, for media-to-media relations) — Character.media's own
      // field is `characterRole`; querying `relationType` here just returns
      // null for every edge.
      characterRole: string;
      voiceActors?: Array<{
        id: number;
        name: { full: string; native: string | null; userPreferred: string };
        languageV2: string | null;
        image: { large: string | null; medium: string | null } | null;
        siteUrl: string | null;
      }>;
      node: {
        id: number;
        title: {
          userPreferred: string;
        };
        coverImage: {
          large: string;
        };
        type: string;
        // ANIME/MANGA only — a light novel is type MANGA with format NOVEL,
        // AniList has no separate LNOVEL type. Use mapExternalFormatToType
        // (mapper-utils.ts), not `type` alone, wherever this needs to become
        // this app's own manga/lnovel-distinguishing external_id.
        format: string | null;
        startDate: { year: number | null; month: number | null; day: number | null } | null;
      };
    }>;
  };
}

type AniListCharacterMediaEdge = AniListCharacterDetail['media']['edges'][number];

export interface AniListCharacterDetailPage extends Omit<AniListCharacterDetail, 'media'> {
  media: {
    pageInfo: { hasNextPage: boolean; total: number | null };
    edges: AniListCharacterMediaEdge[];
  };
}

export interface AniListStaffDetail {
  name: { full: string; native: string | null; alternative: string[] };
  image: { large: string | null } | null;
  description: string | null;
  staffMedia: {
    edges: {
      staffRole: string;
      node: {
        id: number;
        type: string;
        format: string | null;
        title: { romaji: string | null; english: string | null };
        coverImage: { medium: string | null } | null;
      };
    }[];
  };
}
