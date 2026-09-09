// A character created directly in Metadea instead of picked from a live
// provider (AniList/Comic Vine/TMDB) search — e.g. an obscure/original
// character no provider has ever cataloged. Uses the same
// "character:<providerCode>:<rawId>" shape character.astro's own id parsing
// already expects for every other provider (a/co/ms), with "cs" as the
// provider code. The raw id is a plain random integer, no fixed digit
// count forced onto it — real AniList character ids started at 1 and have
// grown from there, so they range anywhere from 1 digit to 6+ depending on
// how old the character is; a custom id looks just as plausible varying the
// same way instead of always printing exactly 6 digits. providerCode !== 'a'
// is what actually makes character.astro/CharacterPrEditorModal skip any
// live-fetch attempt for it, regardless of what the raw id itself looks
// like, so an exact collision (already vanishingly unlikely) wouldn't even
// resolve to the wrong data.
export function generateCustomCharacterId(): string {
  return `character:cs:${Math.floor(Math.random() * 999999) + 1}`;
}
