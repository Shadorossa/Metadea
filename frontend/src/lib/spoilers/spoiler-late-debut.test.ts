import { describe, it, expect } from 'vitest';
import { detectLateDebut, lateDebutCastIds } from './spoiler-late-debut';
import type { SpoilerFranchise } from './spoiler-franchises';

const franchise = (id: string, memberIds: string[]): SpoilerFranchise => ({
  id, memberIds, name: id, isProtected: true, isCompleted: false,
});

const jjk = franchise('anime:1', ['anime:1', 'anime:2', 'anime:3']);

describe('detectLateDebut', () => {
  it('flags a character whose works are all past the user', () => {
    const started = new Set(['anime:1']);
    expect(detectLateDebut([jjk], ['anime:2', 'anime:3'], id => started.has(id))).toEqual({ franchise: jjk, firstWorkId: 'anime:2' });
  });

  it('does not flag someone the user has already met', () => {
    const started = new Set(['anime:1']);
    expect(detectLateDebut([jjk], ['anime:1', 'anime:2'], id => started.has(id))).toBeNull();
  });

  it('says nothing about a franchise the user has not started', () => {
    expect(detectLateDebut([jjk], ['anime:2'], () => false)).toBeNull();
  });

  it('needs the character to be ahead in every followed franchise', () => {
    const manga = franchise('manga:10', ['manga:10']);
    const started = new Set(['anime:1', 'manga:10']);
    expect(detectLateDebut([jjk, manga], ['anime:3', 'manga:10'], id => started.has(id))).toBeNull();
  });
});

describe('lateDebutCastIds', () => {
  it('returns the cast members missing from every started cast list', () => {
    expect([...lateDebutCastIds(['c:1', 'c:2', 'c:3'], new Set(['c:1', 'c:3']))]).toEqual(['c:2']);
  });

  it('hides nobody when a started work has no cached cast', () => {
    expect(lateDebutCastIds(['c:1', 'c:2'], null).size).toBe(0);
  });
});
