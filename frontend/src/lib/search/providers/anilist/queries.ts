// Every GraphQL document sent to AniList, in one place. The functions that
// send them live in detail.ts (single-entity fetches) and search.ts
// (paginated Page queries).

// ── Media detail ──────────────────────────────────────────────────────────────

// The MyAnimeList id of an AniList anime — what AniSkip keys its skip
// times on (lib/player/mal-id.ts). Fetched on its own, once per work.
export const MAL_ID_QUERY = `
  query MediaMalId($id: Int!) {
    Media(id: $id) { id idMal }
  }
`;

// The reverse lookup, batched: the AniList works behind a set of MAL ids
// of one type, with the fields lib/anilist/import.ts needs to create their
// catalog rows. Used by the MyAnimeList import (lib/mal/import.ts).
export const MEDIA_BY_MAL_IDS_PER_PAGE = 50;
export const MEDIA_BY_MAL_IDS_QUERY = `
  query MediaByMalIds($idMal: [Int], $type: MediaType) {
    Page(page: 1, perPage: ${MEDIA_BY_MAL_IDS_PER_PAGE}) {
      media(idMal_in: $idMal, type: $type) {
        id idMal type format
        title { romaji english native }
        coverImage { large }
        genres status
        studios { edges { isMain node { id name } } }
      }
    }
  }
`;

export const DETAIL_QUERY = `
  query Media($id: Int!) {
    Media(id: $id) {
      id
      siteUrl
      title { romaji english native }
      bannerImage
      coverImage { extraLarge large color }
      description(asHtml: true)
      format status episodes chapters volumes duration countryOfOrigin
      nextAiringEpisode { episode }
      averageScore popularity favourites genres
      season seasonYear
      startDate { year month day }
      endDate   { year month day }
      source
      studios { edges { isMain node { id name siteUrl } } }
      characters(sort: [ROLE, RELEVANCE], page: 1, perPage: 50) {
        pageInfo { hasNextPage total }
        edges { role node { id name { full } image { large medium } } }
      }
      relations {
        edges {
          relationType
          node { id type format title { romaji } coverImage { extraLarge large medium } startDate { year month day } }
        }
      }
      staff(perPage: 50) {
        edges {
          role
          node {
            id
            name { full }
            image { large medium }
          }
        }
      }
      streamingEpisodes { title thumbnail }
    }
  }
`;

// perPage must match DETAIL_QUERY's own characters(perPage) above — this
// walks whatever pages that first page's pageInfo says are left, at the
// same page size it was paginated at.
export const CHARACTERS_PER_PAGE = 50;

export const CHARACTERS_QUERY = `
  query MediaCharacters($id: Int!, $page: Int!) {
    Media(id: $id) {
      characters(sort: [ROLE, RELEVANCE], page: $page, perPage: ${CHARACTERS_PER_PAGE}) {
        pageInfo { hasNextPage }
        edges { role node { id name { full } image { large medium } } }
      }
    }
  }
`;

// Deliberately just this one field — episode-list.ts used to call the full
// fetchAniListDetail() a second time (title/banner/description/studios/
// characters incl. its own pagination walk/relations/staff, all discarded)
// purely to read streamingEpisodes, doubling every request the main detail
// fetch already made. This is the one thing that fetch actually needs.
export const STREAMING_EPISODES_QUERY = `
  query MediaStreamingEpisodes($id: Int!) {
    Media(id: $id) {
      streamingEpisodes { title thumbnail }
    }
  }
`;

// ── Media search / browse ─────────────────────────────────────────────────────

export const SEARCH_QUERY = `
  query Search($searchQuery: String!, $type: MediaType!, $page: Int, $isAdult: Boolean) {
    Page(page: $page, perPage: 50) {
      pageInfo { hasNextPage }
      media(search: $searchQuery, type: $type, isAdult: $isAdult, sort: SEARCH_MATCH) {
        id format title { romaji native } coverImage { large }
        startDate { year month day } averageScore genres
      }
    }
  }
`;

export const SEARCH_QUERY_WITH_FORMAT = `
  query Search($searchQuery: String!, $type: MediaType!, $page: Int, $format: MediaFormat!, $isAdult: Boolean) {
    Page(page: $page, perPage: 50) {
      pageInfo { hasNextPage }
      media(search: $searchQuery, type: $type, format: $format, isAdult: $isAdult, sort: SEARCH_MATCH) {
        id format title { romaji native } coverImage { large }
        startDate { year month day } averageScore genres
      }
    }
  }
`;

// Anime-only variants adding each result's own relations — the sole purpose
// is letting toSearchPage detect "this result has an ANIME PREQUEL, so it's
// a later season" when isUnifySeasonsEnabled() is on (see hasAnimePrequel).
// Never used for manga/lnovel search, which has no such concept.
const RELATIONS_FIELD = 'relations { edges { relationType node { id type } } }';

export const SEARCH_QUERY_ANIME = `
  query Search($searchQuery: String!, $type: MediaType!, $page: Int, $isAdult: Boolean) {
    Page(page: $page, perPage: 50) {
      pageInfo { hasNextPage }
      media(search: $searchQuery, type: $type, isAdult: $isAdult, sort: SEARCH_MATCH) {
        id format title { romaji native } coverImage { large }
        startDate { year month day } averageScore genres
        ${RELATIONS_FIELD}
      }
    }
  }
`;

export const SEARCH_QUERY_WITH_FORMAT_ANIME = `
  query Search($searchQuery: String!, $type: MediaType!, $page: Int, $format: MediaFormat!, $isAdult: Boolean) {
    Page(page: $page, perPage: 50) {
      pageInfo { hasNextPage }
      media(search: $searchQuery, type: $type, format: $format, isAdult: $isAdult, sort: SEARCH_MATCH) {
        id format title { romaji native } coverImage { large }
        startDate { year month day } averageScore genres
        ${RELATIONS_FIELD}
      }
    }
  }
`;

// No `search` term — an empty search box still shows something (the top
// 100 by rating) instead of a blank tab until you type. startDate_greater/
// startDate_lesser/genre_in are all nullable — a caller with no active
// filter just omits those variables (JSON.stringify drops undefined keys),
// so this same query serves both plain browsing and filtered browsing.
export const TOP_RATED_QUERY = `
  query TopRated($type: MediaType!, $page: Int, $isAdult: Boolean, $startDate_greater: FuzzyDateInt, $startDate_lesser: FuzzyDateInt, $genre_in: [String]) {
    Page(page: $page, perPage: 50) {
      pageInfo { hasNextPage }
      media(type: $type, isAdult: $isAdult, sort: SCORE_DESC, startDate_greater: $startDate_greater, startDate_lesser: $startDate_lesser, genre_in: $genre_in) {
        id format title { romaji native } coverImage { large }
        startDate { year month day } averageScore genres
      }
    }
  }
`;

export const TOP_RATED_QUERY_WITH_FORMAT = `
  query TopRated($type: MediaType!, $page: Int, $format: MediaFormat!, $isAdult: Boolean, $startDate_greater: FuzzyDateInt, $startDate_lesser: FuzzyDateInt, $genre_in: [String]) {
    Page(page: $page, perPage: 50) {
      pageInfo { hasNextPage }
      media(type: $type, format: $format, isAdult: $isAdult, sort: SCORE_DESC, startDate_greater: $startDate_greater, startDate_lesser: $startDate_lesser, genre_in: $genre_in) {
        id format title { romaji native } coverImage { large }
        startDate { year month day } averageScore genres
      }
    }
  }
`;

// Same relations-carrying idea as SEARCH_QUERY_ANIME above, for the no-query
// "top rated" browse tab.
export const TOP_RATED_QUERY_ANIME = `
  query TopRated($type: MediaType!, $page: Int, $isAdult: Boolean, $startDate_greater: FuzzyDateInt, $startDate_lesser: FuzzyDateInt, $genre_in: [String]) {
    Page(page: $page, perPage: 50) {
      pageInfo { hasNextPage }
      media(type: $type, isAdult: $isAdult, sort: SCORE_DESC, startDate_greater: $startDate_greater, startDate_lesser: $startDate_lesser, genre_in: $genre_in) {
        id format title { romaji native } coverImage { large }
        startDate { year month day } averageScore genres
        ${RELATIONS_FIELD}
      }
    }
  }
`;

export const TOP_RATED_QUERY_WITH_FORMAT_ANIME = `
  query TopRated($type: MediaType!, $page: Int, $format: MediaFormat!, $isAdult: Boolean, $startDate_greater: FuzzyDateInt, $startDate_lesser: FuzzyDateInt, $genre_in: [String]) {
    Page(page: $page, perPage: 50) {
      pageInfo { hasNextPage }
      media(type: $type, format: $format, isAdult: $isAdult, sort: SCORE_DESC, startDate_greater: $startDate_greater, startDate_lesser: $startDate_lesser, genre_in: $genre_in) {
        id format title { romaji native } coverImage { large }
        startDate { year month day } averageScore genres
        ${RELATIONS_FIELD}
      }
    }
  }
`;

// ── Characters / staff ────────────────────────────────────────────────────────

export const SEARCH_CHARACTERS_QUERY = `
  query SearchCharacters($searchQuery: String!, $page: Int) {
    Page(page: $page, perPage: 50) {
      pageInfo { hasNextPage }
      characters(search: $searchQuery, sort: SEARCH_MATCH) {
        id
        name { full native alternative }
        image { large }
      }
    }
  }
`;

export const SEARCH_STAFF_QUERY = `
  query SearchStaff($searchQuery: String!, $page: Int) {
    Page(page: $page, perPage: 25) {
      pageInfo { hasNextPage }
      staff(search: $searchQuery, sort: SEARCH_MATCH) {
        id
        name { full native }
        image { large }
      }
    }
  }
`;

export const CHARACTER_MEDIA_PER_PAGE = 50;

export const DETAIL_CHARACTER_QUERY = `
  query GetCharacterDetail($id: Int, $mediaPage: Int) {
    Character(id: $id) {
      id
      name {
        full
        native
        alternative
        alternativeSpoiler
      }
      image {
        large
      }
      description(asHtml: true)
      gender
      dateOfBirth {
        year
        month
        day
      }
      age
      bloodType
      media(page: $mediaPage, perPage: ${CHARACTER_MEDIA_PER_PAGE}, sort: START_DATE_DESC) {
        pageInfo {
          hasNextPage
          total
        }
        edges {
          characterRole
          voiceActors {
            id
            name {
              full
              native
              userPreferred
            }
            languageV2
            image {
              large
              medium
            }
            siteUrl
          }
          node {
            id
            title {
              userPreferred
            }
            coverImage {
              large
            }
            type
            format
            startDate { year month day }
          }
        }
      }
    }
  }
`;

export const DETAIL_STAFF_QUERY = `
  query Staff($id: Int!) {
    Staff(id: $id) {
      name { full native alternative }
      image { large }
      description(asHtml: true)
      staffMedia(sort: [START_DATE_DESC]) {
        edges {
          staffRole
          node {
            id type format title { romaji english } coverImage { medium }
          }
        }
      }
    }
  }
`;
