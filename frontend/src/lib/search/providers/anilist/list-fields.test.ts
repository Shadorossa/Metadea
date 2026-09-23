import { describe, it, expect } from 'vitest';
import {
  SEARCH_QUERY, SEARCH_QUERY_WITH_FORMAT, SEARCH_QUERY_ANIME, SEARCH_QUERY_WITH_FORMAT_ANIME,
  TOP_RATED_QUERY, TOP_RATED_QUERY_WITH_FORMAT, TOP_RATED_QUERY_ANIME, TOP_RATED_QUERY_WITH_FORMAT_ANIME,
  SEARCH_CHARACTERS_QUERY, SEARCH_STAFF_QUERY,
} from './queries';

// Every list (Page) query AniList search/browse sends. A result card renders
// title, cover, date, score (+ genres for the filter); detail-only fields
// (description, characters, staff, relations beyond the prequel check,
// streamingEpisodes...) must never creep into these, since each one is
// multiplied by perPage rows on every keystroke.
const LIST_QUERIES = {
  SEARCH_QUERY, SEARCH_QUERY_WITH_FORMAT, SEARCH_QUERY_ANIME, SEARCH_QUERY_WITH_FORMAT_ANIME,
  TOP_RATED_QUERY, TOP_RATED_QUERY_WITH_FORMAT, TOP_RATED_QUERY_ANIME, TOP_RATED_QUERY_WITH_FORMAT_ANIME,
  SEARCH_CHARACTERS_QUERY, SEARCH_STAFF_QUERY,
};

// (`characters(`/`staff(` as NESTED media fields — the root
// Page.characters/Page.staff selections of the two entity searches are
// the entity itself, not a per-row cast list.)
const DETAIL_ONLY_FIELDS = ['description', 'media {', 'streamingEpisodes', 'bannerImage', 'studios', 'siteUrl', 'extraLarge', 'voiceActors', 'staffMedia'];

function selectionOf(query: string): string {
  return query.replace(/\s+/g, ' ').trim();
}

describe('AniList list query field lists', () => {
  it.each(Object.entries(LIST_QUERIES))('%s requests only card fields', (_name, query) => {
    for (const field of DETAIL_ONLY_FIELDS) expect(query).not.toContain(field);
  });

  it('media list queries select exactly the card fields (snapshot)', () => {
    const MEDIA_CARD_FIELDS = 'id format title { romaji native } coverImage { large } startDate { year month day } averageScore genres';
    for (const [name, query] of Object.entries(LIST_QUERIES)) {
      if (name.startsWith('SEARCH_CHARACTERS') || name.startsWith('SEARCH_STAFF')) continue;
      expect(selectionOf(query), name).toContain(MEDIA_CARD_FIELDS);
      expect(query, name).toContain('perPage: 50');
    }
  });

  it('the anime-only variants add nothing but the relation type/id needed for the prequel check', () => {
    const RELATIONS = 'relations { edges { relationType node { id type } } }';
    expect(selectionOf(SEARCH_QUERY_ANIME)).toContain(RELATIONS);
    expect(selectionOf(TOP_RATED_QUERY_ANIME)).toContain(RELATIONS);
    expect(selectionOf(SEARCH_QUERY)).not.toContain('relations');
    expect(selectionOf(TOP_RATED_QUERY)).not.toContain('relations');
  });

  it('character/staff list queries snapshot', () => {
    expect(selectionOf(SEARCH_CHARACTERS_QUERY)).toMatchInlineSnapshot('"query SearchCharacters($searchQuery: String!, $page: Int) { Page(page: $page, perPage: 50) { pageInfo { hasNextPage } characters(search: $searchQuery, sort: SEARCH_MATCH) { id name { full native alternative } image { large } } } }"');
    expect(selectionOf(SEARCH_STAFF_QUERY)).toMatchInlineSnapshot('"query SearchStaff($searchQuery: String!, $page: Int) { Page(page: $page, perPage: 25) { pageInfo { hasNextPage } staff(search: $searchQuery, sort: SEARCH_MATCH) { id name { full native } image { large } } } }"');
  });
});
