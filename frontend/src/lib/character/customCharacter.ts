// A character created directly in Metadea instead of picked from a live
// provider (AniList/Comic Vine/TMDB) search — e.g. an obscure/original
// character no provider has ever cataloged. Uses the same
// "character:<providerCode>:<rawId>" shape character.astro's own id parsing
// already expects for every other provider (a/co/ms), with "cs" as the
// provider code. The raw id is a random 6-digit number — same digit count
// as a typical real provider id (e.g. "character:a:48937"), not the 13
// digits a millisecond timestamp (or the full length of a UUID) would
// print. ~900k possible values is plenty for a single local user manually
// clicking "+ Crear personaje" — providerCode !== 'a' is what actually makes
// character.astro/CharacterPrEditorModal skip any live-fetch attempt for it,
// regardless of what the raw id itself looks like, so an exact collision
// (astronomically unlikely already) wouldn't even resolve to the wrong data.
export function generateCustomCharacterId(): string {
  return `character:cs:${Math.floor(100000 + Math.random() * 900000)}`;
}
