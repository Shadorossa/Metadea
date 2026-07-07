import { isTauri, invoke, tauriCmd, tauriRun } from './core';

export interface CharacterEntry {
  id:          string;
  external_id: string;
  name:        string;
  image_url?:  string | null;
  reaction?:   string | null;
  created_at:  string;
  updated_at:  string;
}

export interface CharacterAppearance {
  media_external_id: string;
  relation_type?:     string | null;
}

export async function saveCharacter(externalId: string, name: string, imageUrl?: string | null): Promise<CharacterEntry> {
  if (!isTauri()) throw new Error('Tauri not available');
  return invoke<CharacterEntry>('save_character', { externalId, name, imageUrl });
}

export async function getCharacter(externalId: string): Promise<CharacterEntry | null> {
  return tauriCmd<CharacterEntry | null>('get_character', null, { externalId });
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
