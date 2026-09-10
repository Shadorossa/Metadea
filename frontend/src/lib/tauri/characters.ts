import { isTauri, invoke, tauriCmd, tauriRun } from './core';

export interface CharacterEntry {
  id:           string;
  external_id:  string;
  name:         string;
  name_native?: string | null;
  aliases_csv?: string | null; // Comma-separated alternative names
  biography?:   string | null;
  image_url?:   string | null;
  reaction?:    string | null;
  gender?:      string | null;
  age?:         string | null; // AniList's own field — free-form ("17", "17-18"), not always numeric
  blood_type?:  string | null;
  dob_year?:    number | null;
  dob_month?:   number | null;
  dob_day?:     number | null;
  created_at:   string;
  updated_at:   string;
}

export interface CharacterAppearance {
  media_external_id: string;
  relation_type?:     string | null;
  character_name?:    string | null;
  /** Only used to seed a media_catalog stub when this appearance's media
   *  isn't cataloged yet — not persisted on the appearance row itself. */
  title?:              string | null;
  cover?:              string | null;
}

// getAllCharacters() is fetched fresh by several profile tabs (Lists,
// Favorites) and modals every time they mount — cache it the same way
// favorite-images.ts caches getAllFavoriteCustomImages(), invalidated by
// this file's own mutators so callers never see stale data.
let cachedCharacters: CharacterEntry[] | null = null;
let charactersCachePromise: Promise<CharacterEntry[]> | null = null;

function invalidateCharactersCache() {
  cachedCharacters = null;
  charactersCachePromise = null;
}

export async function saveCharacter(
  externalId: string,
  name: string,
  imageUrl?: string | null,
  nameNative?: string | null,
  aliasesCsv?: string | null,
  biography?: string | null,
  gender?: string | null,
  age?: string | null,
  bloodType?: string | null,
  dobYear?: number | null,
  dobMonth?: number | null,
  dobDay?: number | null,
): Promise<CharacterEntry> {
  if (!isTauri()) throw new Error('Tauri not available');
  const res = await invoke<CharacterEntry>('save_character', {
    externalId, name, imageUrl, nameNative, aliasesCsv, biography,
    gender, age, bloodType, dobYear, dobMonth, dobDay,
  });
  invalidateCharactersCache();
  return res;
}

export async function getCharacter(externalId: string): Promise<CharacterEntry | null> {
  return tauriCmd<CharacterEntry | null>('get_character', null, { externalId });
}

// Fetch all cached characters (e.g. for profile Favorites/Lists tabs).
// Cached at module level — see invalidateCharactersCache above.
export async function getAllCharacters(forceRefresh = false): Promise<CharacterEntry[]> {
  if (cachedCharacters && !forceRefresh) return cachedCharacters;
  if (charactersCachePromise && !forceRefresh) return charactersCachePromise;

  charactersCachePromise = tauriCmd<CharacterEntry[]>('get_all_characters', []).then(list => {
    cachedCharacters = list;
    charactersCachePromise = null;
    return list;
  }).catch(() => {
    charactersCachePromise = null;
    return cachedCharacters ?? [];
  });

  return charactersCachePromise;
}

export async function searchCharactersDb(query: string): Promise<CharacterEntry[]> {
  return tauriCmd<CharacterEntry[]>('search_characters_db', [], { query });
}

export async function setCharacterReaction(externalId: string, reaction: string | null): Promise<void> {
  await tauriRun('set_character_reaction', { externalId, reaction });
  invalidateCharactersCache();
}

export async function deleteCharacter(externalId: string): Promise<void> {
  await tauriRun('delete_character', { externalId });
  invalidateCharactersCache();
}

// Admin catalog editor's GitHub > Personajes tab — reads straight from the
// downloaded community database.db (same source sync_community_catalog
// merges from), not the local characters table, since GitHub's own set can
// differ from what's synced locally.
export async function getCommunityCharacters(): Promise<CharacterEntry[]> {
  return tauriCmd<CharacterEntry[]>('get_community_characters', []);
}

export async function saveCharacterAppearances(characterExternalId: string, appearances: CharacterAppearance[]): Promise<void> {
  return tauriRun('save_character_appearances', { characterExternalId, appearances });
}

export async function getCharacterAppearances(characterExternalId: string): Promise<CharacterAppearance[]> {
  return tauriCmd<CharacterAppearance[]>('get_character_appearances', [], { characterExternalId });
}

export interface SkeletonCharacter {
  external_id: string;
  name: string;
  image_url?: string | null;
  relation_type?: string | null;
  character_name?: string | null;
}

export async function saveCharactersSkeleton(mediaExternalId: string, characters: SkeletonCharacter[]): Promise<void> {
  return tauriRun('save_characters_skeleton', { mediaExternalId, characters });
}

export interface DbMediaCharacter {
  external_id: string;
  name: string;
  image_url?: string | null;
  relation_type?: string | null;
  character_name?: string | null;
}

// Get all characters cached locally for a specific media
export async function getMediaCharacters(mediaExternalId: string): Promise<DbMediaCharacter[]> {
  return tauriCmd<DbMediaCharacter[]>('get_media_characters', [], { mediaExternalId });
}
