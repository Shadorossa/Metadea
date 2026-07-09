import { isTauri, invoke, tauriCmd, tauriRun } from './core';

export interface CharacterEntry {
  id:           string;
  external_id:  string;
  name:         string;
  name_native?: string | null;
  /** Comma-separated alternative names (AniList's name.alternative list). */
  aliases_csv?: string | null;
  biography?:   string | null;
  image_url?:   string | null;
  reaction?:    string | null;
  created_at:   string;
  updated_at:   string;
}

export interface CharacterAppearance {
  media_external_id: string;
  relation_type?:     string | null;
}

export async function saveCharacter(
  externalId: string,
  name: string,
  imageUrl?: string | null,
  nameNative?: string | null,
  aliasesCsv?: string | null,
  biography?: string | null,
): Promise<CharacterEntry> {
  if (!isTauri()) throw new Error('Tauri not available');
  return invoke<CharacterEntry>('save_character', { externalId, name, imageUrl, nameNative, aliasesCsv, biography });
}

export async function getCharacter(externalId: string): Promise<CharacterEntry | null> {
  return tauriCmd<CharacterEntry | null>('get_character', null, { externalId });
}

// Bulk fetch for UI that needs every cached character's name/cover without a
// per-id round trip (e.g. the profile Favorites tab) — characters live only
// in this table, never in media_catalog.
export async function getAllCharacters(): Promise<CharacterEntry[]> {
  return tauriCmd<CharacterEntry[]>('get_all_characters', []);
}

export async function setCharacterReaction(externalId: string, reaction: string | null): Promise<void> {
  return tauriRun('set_character_reaction', { externalId, reaction });
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
}

export async function saveCharactersSkeleton(mediaExternalId: string, characters: SkeletonCharacter[]): Promise<void> {
  return tauriRun('save_characters_skeleton', { mediaExternalId, characters });
}

export interface MediaCharacter {
  external_id: string;
  name: string;
  image_url?: string | null;
  relation_type?: string | null;
}

// Reverse of getCharacterAppearances — all characters already cached locally
// for a given media, used to carry them along into a collaborative-catalog
// PR bundle (see PrEditorModal) instead of losing them.
export async function getMediaCharacters(mediaExternalId: string): Promise<MediaCharacter[]> {
  return tauriCmd<MediaCharacter[]>('get_media_characters', [], { mediaExternalId });
}
