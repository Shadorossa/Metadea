// Public surface of the AniList provider — the same exports the former
// single-file providers/anilist.ts had, so `.../providers/anilist` imports
// keep working unchanged. Split by concern:
//   queries.ts     every GraphQL document
//   types.ts       response shapes (detail + search rows)
//   json-guards.ts untrusted-JSON narrowing helpers
//   mappers.ts     row guards, filters → variables, rows → SearchResult
//   client.ts      graphqlPost wrapper, auth options, paginated edge walking
//   detail.ts      single-entity fetches (media, character, staff)
//   search.ts      paginated search / browse APIs
export type {
  AniListCharacterEdge,
  AniListStaffEdge,
  AniListMediaDetail,
  AniListStaffSearchResult,
  AniListCharacterDetail,
  AniListStaffDetail,
} from './types';
export {
  fetchAniListDetail,
  fetchAniListRemainingCharacters,
  fetchAniListStreamingEpisodes,
  fetchAniListCharacterDetail,
  fetchAniListStaffDetail,
  fetchAniListMalId,
  fetchAniListMediaByMalIds,
} from './detail';
export {
  ANILIST_GENRES,
  searchAniList,
  topRatedAniList,
  searchAniListCharacters,
  searchAniListStaff,
  findAniListStaffExactMatch,
} from './search';
