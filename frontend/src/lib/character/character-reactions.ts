// Pure state for character reactions (like / interest / dislike): the
// character page's toggle and the profile's reaction lists. A character is
// in at most one list — the same rule src-tauri/src/character_reactions.rs
// enforces — so every transition here keeps that invariant, which lets the
// UI update optimistically and roll back to the previous state on error.
import {
  CHARACTER_REACTIONS, emptyCharacterReactionGroups,
  type CharacterReaction, type CharacterReactionGroups, type CharacterReactionItem,
} from '../tauri/character-reactions';

export { CHARACTER_REACTIONS, emptyCharacterReactionGroups };
export type { CharacterReaction, CharacterReactionGroups, CharacterReactionItem };

/** A stored/IPC value → a reaction. The old page wrote "interested". */
export function normalizeReaction(value: unknown): CharacterReaction | null {
  if (value === 'interested') return 'interest';
  return typeof value === 'string' && (CHARACTER_REACTIONS as readonly string[]).includes(value)
    ? value as CharacterReaction
    : null;
}

/** Clicking the active reaction again clears it. */
export function toggleReaction(current: CharacterReaction | null, clicked: CharacterReaction): CharacterReaction | null {
  return current === clicked ? null : clicked;
}

export function reactionOf(groups: CharacterReactionGroups, externalId: string): CharacterReaction | null {
  return CHARACTER_REACTIONS.find(r => groups[r].some(item => item.external_id === externalId)) ?? null;
}

export function reactionCounts(groups: CharacterReactionGroups): Record<CharacterReaction, number> {
  return { like: groups.like.length, interest: groups.interest.length, dislike: groups.dislike.length };
}

export type ReactionAction =
  /** Move `item` to `reaction` (appended), or drop it with null. Setting
   *  the reaction it already has keeps its place. */
  | { type: 'set'; item: CharacterReactionItem; reaction: CharacterReaction | null }
  /** New order of one list; ids it doesn't hold are ignored, ones missing
   *  from `ids` keep their relative order at the end. */
  | { type: 'reorder'; reaction: CharacterReaction; ids: readonly string[] }
  | { type: 'reset'; groups: CharacterReactionGroups };

export function reactionGroupsReducer(state: CharacterReactionGroups, action: ReactionAction): CharacterReactionGroups {
  switch (action.type) {
    case 'reset':
      return action.groups;
    case 'set': {
      const id = action.item.external_id;
      if (action.reaction && state[action.reaction].some(item => item.external_id === id)) return state;
      const next = emptyCharacterReactionGroups();
      for (const r of CHARACTER_REACTIONS) next[r] = state[r].filter(item => item.external_id !== id);
      if (action.reaction) next[action.reaction] = [...next[action.reaction], action.item];
      return next;
    }
    case 'reorder': {
      const list = state[action.reaction];
      const byId = new Map(list.map(item => [item.external_id, item]));
      const ordered = [...new Set(action.ids)].flatMap(id => byId.get(id) ?? []);
      const placed = new Set(ordered.map(item => item.external_id));
      return { ...state, [action.reaction]: [...ordered, ...list.filter(item => !placed.has(item.external_id))] };
    }
  }
}

/** `index` moved to `to` within one list — the ids to persist. */
export function movedIds(items: readonly CharacterReactionItem[], from: number, to: number): string[] {
  const ids = items.map(item => item.external_id);
  if (from < 0 || from >= ids.length || to < 0 || to >= ids.length) return ids;
  const [moved] = ids.splice(from, 1);
  ids.splice(to, 0, moved);
  return ids;
}

/** Character page URL, same form as the Favorites tab's character cards. */
export function characterPageUrl(externalId: string): string {
  return `/character?id=${encodeURIComponent(externalId.replace(/^character:/, ''))}`;
}
