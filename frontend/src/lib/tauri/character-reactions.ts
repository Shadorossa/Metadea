// Character reactions (like / interest / dislike) — see
// src-tauri/src/character_reactions.rs. They live in three hidden custom
// lists; a character is in at most one of them.
import { tauriCmd, tauriRun } from './bridge';

export const CHARACTER_REACTIONS = ['like', 'interest', 'dislike'] as const;
export type CharacterReaction = (typeof CHARACTER_REACTIONS)[number];

export interface CharacterReactionItem {
  external_id: string;
  name: string | null;
  /** Remote URL or a stored file path — pass through wrapAssetUrl(). */
  image_url: string | null;
  added_at?: string | null;
}

export type CharacterReactionGroups = Record<CharacterReaction, CharacterReactionItem[]>;

export function emptyCharacterReactionGroups(): CharacterReactionGroups {
  return { like: [], interest: [], dislike: [] };
}

/** `null` clears the reaction. */
export async function setCharacterReaction(externalId: string, reaction: CharacterReaction | null): Promise<void> {
  await tauriRun('set_character_reaction', { externalId, reaction: reaction ?? 'none' });
}

export async function getCharacterReaction(externalId: string): Promise<string | null> {
  return tauriCmd<string | null>('get_character_reaction', null, { externalId });
}

/** Each list in its saved order. */
export async function getCharacterReactions(): Promise<CharacterReactionGroups> {
  return tauriCmd<CharacterReactionGroups>('get_character_reactions', emptyCharacterReactionGroups());
}

export async function reorderCharacterReactions(reaction: CharacterReaction, externalIds: string[]): Promise<void> {
  await tauriRun('reorder_character_reactions', { reaction, externalIds });
}
