// Parsing of the character page's `?id=` query parameter.

export interface CharacterPageId {
  providerCode: string;
  rawId: string;
  externalId: string;
}

// idParam arrives in one of two shapes depending on the caller: already
// stripped of the "character:" prefix (search results/favorites strip it
// before building this URL) or still carrying it (MediaPage.tsx's own
// cast grid passes its card's id straight through) — tolerate both
// instead of assuming one. What's left is "<providerCode>:<rawId>",
// e.g. "a:12345" (AniList), "co:678" (Comic Vine), "ms:5256c8a2..." (TMDB).
function stripCharacterPrefix(idParam: string): string {
  return idParam.startsWith('character:') ? idParam.slice('character:'.length) : idParam;
}

export function parseCharacterPageId(idParam: string): CharacterPageId | null {
  const bareId = stripCharacterPrefix(idParam);
  let providerCode = '';
  let rawId = '';
  const sepIndex = bareId.indexOf(':');
  if (sepIndex === -1) {
    if (/^\d+$/.test(bareId)) {
      providerCode = 'a';
      rawId = bareId;
    }
  } else {
    providerCode = bareId.slice(0, sepIndex);
    rawId = bareId.slice(sepIndex + 1);
  }
  if (!providerCode || !rawId) return null;
  return { providerCode, rawId, externalId: `character:${providerCode}:${rawId}` };
}

/** Whether a `metadea:character-saved` event's externalId refers to the page's own character. */
export function characterSavedMatchesPage(idParam: string, savedExternalId: string | undefined): boolean {
  if (!savedExternalId) return false;
  const bareId = stripCharacterPrefix(idParam);
  return savedExternalId === idParam || savedExternalId === `character:${bareId}`;
}
