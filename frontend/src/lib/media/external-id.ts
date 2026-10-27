// What an `external_id` (`anime:123`, `manga:issue-45`, …) says about the
// work by its prefix alone. Mirrors media_catalog.rs's infer_type_from_id /
// infer_source_from_id; both sides are tested against
// src-tauri/src/fixtures/external-id-sources.json.

/** The id's prefix as its media type; a colon-less id counts as anime. */
export function typeOfExternalId(externalId: string): string {
  const colon = externalId.indexOf(':');
  return colon === -1 ? 'anime' : externalId.slice(0, colon);
}

/** The provider a stub row for this id comes from, or null when none. */
export function sourceOfExternalId(externalId: string): string | null {
  const colon = externalId.indexOf(':');
  // Comic Vine issue sub-entries keep their parent's type prefix
  // (`manga:issue-123`) but always come from Comic Vine.
  if (colon !== -1 && externalId.startsWith('issue-', colon + 1)) return 'comicvine';
  switch (typeOfExternalId(externalId)) {
    case 'anime': case 'manga': case 'lnovel': return 'anilist';
    case 'movie': case 'series': return 'tmdb';
    case 'game': case 'vnovel': return 'igdb';
    case 'book': return 'openlibrary';
    case 'comic': return 'comicvine';
    default: return null;
  }
}
