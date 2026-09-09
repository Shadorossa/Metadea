// A character created directly in Metadea instead of picked from a live
// provider (AniList/Comic Vine/TMDB) search — e.g. an obscure/original
// character no provider has ever cataloged. Uses the same
// "character:<providerCode>:<rawId>" shape character.astro's own id parsing
// already expects for every other provider (a/co/ms), with "custom" as the
// provider code and a crypto.randomUUID() as the id — never collides with a
// real provider's numeric id space, and providerCode !== 'a' already makes
// character.astro/CharacterPrEditorModal skip any live-fetch attempt for it.
export function generateCustomCharacterId(): string {
  return `character:custom:${crypto.randomUUID()}`;
}
