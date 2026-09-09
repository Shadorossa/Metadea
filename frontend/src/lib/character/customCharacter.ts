// A character created directly in Metadea instead of picked from a live
// provider (AniList/Comic Vine/TMDB) search — e.g. an obscure/original
// character no provider has ever cataloged. Uses the same
// "character:<providerCode>:<rawId>" shape character.astro's own id parsing
// already expects for every other provider (a/co/ms), with "cs" as the
// provider code. The raw id is a plain millisecond timestamp — short and
// numeric like every real provider's own id (a UUID looked jarring next to
// "character:a:12345"), still unique enough for a single local user
// creating these one button-click at a time. providerCode !== 'a' already
// makes character.astro/CharacterPrEditorModal skip any live-fetch attempt
// for it, regardless of what the raw id itself looks like.
export function generateCustomCharacterId(): string {
  return `character:cs:${Date.now()}`;
}
