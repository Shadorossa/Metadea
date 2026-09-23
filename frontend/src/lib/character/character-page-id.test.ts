import { describe, expect, it } from 'vitest';
import { characterSavedMatchesPage, parseCharacterPageId } from './character-page-id';

describe('parseCharacterPageId', () => {
  it('accepts both prefixed and bare provider ids, and a bare numeric AniList id', () => {
    expect(parseCharacterPageId('a:123')).toEqual({ providerCode: 'a', rawId: '123', externalId: 'character:a:123' });
    expect(parseCharacterPageId('character:co:678')).toEqual({ providerCode: 'co', rawId: '678', externalId: 'character:co:678' });
    expect(parseCharacterPageId('ms:5256c8a2')).toEqual({ providerCode: 'ms', rawId: '5256c8a2', externalId: 'character:ms:5256c8a2' });
    expect(parseCharacterPageId('123')).toEqual({ providerCode: 'a', rawId: '123', externalId: 'character:a:123' });
  });

  it('rejects empty or malformed ids', () => {
    expect(parseCharacterPageId('')).toBeNull();
    expect(parseCharacterPageId('abc')).toBeNull();
    expect(parseCharacterPageId('a:')).toBeNull();
    expect(parseCharacterPageId(':1')).toBeNull();
  });
});

describe('characterSavedMatchesPage', () => {
  it('matches the saved external id against either form of the page id', () => {
    expect(characterSavedMatchesPage('a:1', 'character:a:1')).toBe(true);
    expect(characterSavedMatchesPage('character:a:1', 'character:a:1')).toBe(true);
    expect(characterSavedMatchesPage('a:1', 'character:a:2')).toBe(false);
    expect(characterSavedMatchesPage('a:1', undefined)).toBe(false);
  });
});
