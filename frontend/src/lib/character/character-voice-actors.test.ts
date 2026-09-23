import { describe, expect, it } from 'vitest';
import type { AniListCharacterDetail } from '../search/providers/anilist';
import {
  defaultVoiceActorLanguage,
  groupVoiceActorsByLanguage,
  mergeVoiceActors,
  splitVoiceActorName,
  toPersistedActor,
  voiceActorInitial,
} from './character-voice-actors';

type Edge = AniListCharacterDetail['media']['edges'][number];

function edge(voiceActors: NonNullable<Edge['voiceActors']>): Edge {
  return {
    characterRole: 'MAIN',
    voiceActors,
    node: { id: 1, title: { userPreferred: 'Show' }, coverImage: { large: '' }, type: 'ANIME', format: 'TV', startDate: null },
  };
}

const tanaka = { id: 1, name: { full: 'Mayumi Tanaka', native: '田中真弓', userPreferred: 'Mayumi Tanaka' }, languageV2: 'Japanese', image: { large: 'https://img/tanaka.jpg', medium: null }, siteUrl: null };
const colleen = { id: 2, name: { full: 'Colleen Clinkenbeard', native: null, userPreferred: 'Colleen Clinkenbeard' }, languageV2: 'English', image: null, siteUrl: 'https://anilist.co/staff/2' };

describe('mergeVoiceActors', () => {
  it('keys live actors by person:a{id}, lets persisted rows override and flags unpersisted ones', () => {
    const { actors, hasNewActors } = mergeVoiceActors(
      [edge([tanaka]), edge([tanaka, colleen])],
      [
        { external_id: 'person:a1', name: 'Tanaka Mayumi', language: 'Japanese' },
        { external_id: 'va:Manual VA', name: 'Manual VA', language: 'Spanish', image_url: 'https://img/m.jpg' },
      ],
    );
    expect(actors).toEqual([
      { externalId: 'person:a1', name: 'Tanaka Mayumi', native: '田中真弓', image: 'https://img/tanaka.jpg', siteUrl: 'https://anilist.co/staff/1', language: 'Japanese' },
      { externalId: 'person:a2', name: 'Colleen Clinkenbeard', native: '', image: '', siteUrl: 'https://anilist.co/staff/2', language: 'English' },
      { externalId: 'va:Manual VA', name: 'Manual VA', native: '', image: 'https://img/m.jpg', siteUrl: '', language: 'Spanish' },
    ]);
    expect(hasNewActors).toBe(true);
  });

  it('reports nothing new when every actor is already persisted', () => {
    const { actors, hasNewActors } = mergeVoiceActors(undefined, [{ external_id: 'person:a1', name: 'X' }]);
    expect(actors).toEqual([{ externalId: 'person:a1', name: 'X', native: '', image: '', siteUrl: '', language: 'Japanese' }]);
    expect(hasNewActors).toBe(false);
    expect(toPersistedActor(actors[0])).toEqual({ external_id: 'person:a1', name: 'X', name_native: null, image_url: null, role: null, language: 'Japanese' });
  });
});

describe('groupVoiceActorsByLanguage', () => {
  it('buckets by language code in priority order, unknown languages last alphabetically', () => {
    const base = { native: '', image: '', siteUrl: '' };
    const { byLang, languages } = groupVoiceActorsByLanguage([
      { externalId: 'a', name: 'A', language: 'English', ...base },
      { externalId: 'b', name: 'B', language: 'Japanese', ...base },
      { externalId: 'c', name: 'C', language: 'Hebrew', ...base },
      { externalId: 'd', name: 'D', language: 'Mandarin', ...base },
      { externalId: 'e', name: 'E', language: 'Brazilian', ...base },
      { externalId: 'f', name: 'F', language: '', ...base },
    ]);
    expect(languages).toEqual(['JP', 'EN', 'ZH', 'BR', 'HE']);
    expect(byLang.get('JP')!.map(v => v.externalId)).toEqual(['b', 'f']);
    expect(defaultVoiceActorLanguage(languages)).toBe('JP');
    expect(defaultVoiceActorLanguage(['EN', 'ES'])).toBe('EN');
  });
});

describe('name helpers', () => {
  it('splits a parenthetical suffix and derives the avatar initial', () => {
    expect(splitVoiceActorName('Mayumi Tanaka (田中真弓)')).toEqual({ name: 'Mayumi Tanaka', suffix: '(田中真弓)' });
    expect(splitVoiceActorName('Mayumi Tanaka')).toEqual({ name: 'Mayumi Tanaka', suffix: null });
    expect(voiceActorInitial('mayumi (x)')).toBe('M');
    expect(voiceActorInitial('(x)')).toBe('?');
  });
});
