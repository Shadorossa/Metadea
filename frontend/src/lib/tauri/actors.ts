import { tauriCmd, tauriRun } from './core';

export interface DbCharacterActor {
  external_id: string;
  name: string;
  name_native?: string | null;
  image_url?: string | null;
  role?: string | null;
  language?: string | null;
}

// Get all actors (voice or live-action) cached locally for a specific character
export async function getCharacterActors(characterExternalId: string): Promise<DbCharacterActor[]> {
  return tauriCmd<DbCharacterActor[]>('get_character_actors', [], { characterExternalId });
}

export async function saveCharacterActors(characterExternalId: string, actors: DbCharacterActor[]): Promise<void> {
  return tauriRun('save_character_actors', { characterExternalId, actors });
}
