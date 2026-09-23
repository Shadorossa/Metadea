import { describe, expect, it } from 'vitest';
import {
  characterPageUrl, emptyCharacterReactionGroups, movedIds, normalizeReaction, reactionCounts, reactionGroupsReducer, reactionOf,
  toggleReaction, type CharacterReactionGroups, type CharacterReactionItem,
} from './character-reactions';

const item = (n: number): CharacterReactionItem => ({ external_id: `character:a:${n}`, name: `C${n}`, image_url: null });

function groups(like: number[], interest: number[] = [], dislike: number[] = []): CharacterReactionGroups {
  return { like: like.map(item), interest: interest.map(item), dislike: dislike.map(item) };
}

const ids = (list: CharacterReactionItem[]) => list.map(i => i.external_id);

describe('toggleReaction / normalizeReaction', () => {
  it('clicking the active reaction clears it, another one replaces it', () => {
    expect(toggleReaction(null, 'like')).toBe('like');
    expect(toggleReaction('like', 'like')).toBeNull();
    expect(toggleReaction('like', 'dislike')).toBe('dislike');
  });

  it('maps the legacy "interested" and rejects anything else', () => {
    expect(normalizeReaction('interested')).toBe('interest');
    expect(normalizeReaction('dislike')).toBe('dislike');
    expect(normalizeReaction('love')).toBeNull();
    expect(normalizeReaction(null)).toBeNull();
  });
});

describe('reactionGroupsReducer', () => {
  it('keeps a character in exactly one list when it moves', () => {
    const start = groups([1, 2], [3]);
    const moved = reactionGroupsReducer(start, { type: 'set', item: item(1), reaction: 'dislike' });
    expect(ids(moved.like)).toEqual(['character:a:2']);
    expect(ids(moved.dislike)).toEqual(['character:a:1']);
    expect(reactionOf(moved, 'character:a:1')).toBe('dislike');
    expect(reactionCounts(moved)).toEqual({ like: 1, interest: 1, dislike: 1 });
  });

  it('setting the reaction it already has keeps its place; null removes it', () => {
    const start = groups([1, 2, 3]);
    expect(reactionGroupsReducer(start, { type: 'set', item: item(1), reaction: 'like' })).toBe(start);
    const cleared = reactionGroupsReducer(start, { type: 'set', item: item(2), reaction: null });
    expect(ids(cleared.like)).toEqual(['character:a:1', 'character:a:3']);
    expect(reactionOf(cleared, 'character:a:2')).toBeNull();
  });

  it('reorders one list and ignores ids it does not hold', () => {
    const start = groups([1, 2, 3], [4]);
    const next = reactionGroupsReducer(start, { type: 'reorder', reaction: 'like', ids: ['character:a:3', 'character:a:4', 'character:a:1'] });
    expect(ids(next.like)).toEqual(['character:a:3', 'character:a:1', 'character:a:2']);
    expect(next.interest).toBe(start.interest);
  });

  it('reset restores a snapshot (the optimistic rollback)', () => {
    const snapshot = groups([1]);
    const changed = reactionGroupsReducer(snapshot, { type: 'set', item: item(1), reaction: null });
    expect(reactionGroupsReducer(changed, { type: 'reset', groups: snapshot })).toBe(snapshot);
    expect(reactionCounts(emptyCharacterReactionGroups())).toEqual({ like: 0, interest: 0, dislike: 0 });
  });
});

describe('movedIds / characterPageUrl', () => {
  it('moves one id and leaves out-of-range moves alone', () => {
    const list = [item(1), item(2), item(3)];
    expect(movedIds(list, 0, 2)).toEqual(['character:a:2', 'character:a:3', 'character:a:1']);
    expect(movedIds(list, 0, 5)).toEqual(['character:a:1', 'character:a:2', 'character:a:3']);
  });

  it('links like the Favorites tab does', () => {
    expect(characterPageUrl('character:a:40')).toBe('/character?id=a%3A40');
  });
});
