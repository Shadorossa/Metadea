import { describe, expect, it } from 'vitest';
import type { PlayerTrack } from './player-status';
import {
  chooseTracks, DEFAULT_TRACK_PREFERENCES, hintFor, isAnimeExternalId, isSignsTrack, matchHint, normalizeLanguage,
  resolvePreferredLanguage, spanishVariantScore, trackLanguage, type TrackContext, type TrackPreferences,
} from './track-preferences';

let nextId = 1;
function track(kind: 'audio' | 'sub', lang: string | null, title: string | null = null, extra: Partial<PlayerTrack> = {}): PlayerTrack {
  return {
    id: nextId++, kind, lang, title, selected: false, is_default: false, codec: null, external: false, forced: false, ...extra,
  };
}

function context(overrides: Partial<TrackContext> = {}, prefs: Partial<TrackPreferences> = {}): TrackContext {
  return { preferences: { ...DEFAULT_TRACK_PREFERENCES, ...prefs }, appLanguage: 'es', isAnime: true, ...overrides };
}

describe('language matching', () => {
  it('normalises ISO 639-1 / 639-2 codes and regions', () => {
    for (const [code, base] of [
      ['es', 'es'], ['spa', 'es'], ['es-ES', 'es'], ['spa_419', 'es'], ['en', 'en'], ['eng', 'en'], ['ja', 'ja'], ['jpn', 'ja'],
      ['jp', 'ja'], ['de', 'de'], ['deu', 'de'], ['ger', 'de'], ['fr', 'fr'], ['fra', 'fr'], ['fre', 'fr'], ['it', 'it'],
      ['ita', 'it'], ['ca', 'ca'], ['cat', 'ca'], ['ru', 'ru'], ['rus', 'ru'],
    ]) {
      expect(normalizeLanguage(code)).toBe(base);
    }
    expect(normalizeLanguage('und')).toBeNull();
    expect(normalizeLanguage('')).toBeNull();
    expect(normalizeLanguage(null)).toBeNull();
  });

  it('falls back to the track title when the tag is missing', () => {
    expect(trackLanguage({ lang: null, title: 'Japanese' })).toBe('ja');
    expect(trackLanguage({ lang: 'und', title: 'Español (Latino)' })).toBe('es');
    expect(trackLanguage({ lang: null, title: 'Castellano' })).toBe('es');
    expect(trackLanguage({ lang: 'eng', title: 'Japanese commentary' })).toBe('en');
    expect(trackLanguage({ lang: null, title: 'Track 3' })).toBeNull();
  });

  it('scores Castilian over Latin American Spanish', () => {
    expect(spanishVariantScore({ lang: 'spa', title: 'Castellano' })).toBe(1);
    expect(spanishVariantScore({ lang: 'es-ES', title: null })).toBe(1);
    expect(spanishVariantScore({ lang: 'spa', title: 'Español (Latino)' })).toBe(-1);
    expect(spanishVariantScore({ lang: 'es-419', title: null })).toBe(-1);
    expect(spanishVariantScore({ lang: 'spa', title: 'Español' })).toBe(0);
  });

  it('tells signs/forced tracks from full dialogue', () => {
    expect(isSignsTrack({ title: 'Signs & Songs', forced: false })).toBe(true);
    expect(isSignsTrack({ title: 'Forzados', forced: false })).toBe(true);
    expect(isSignsTrack({ title: null, forced: true })).toBe(true);
    expect(isSignsTrack({ title: 'Full', forced: false })).toBe(false);
    expect(isSignsTrack({ title: 'Full (with songs)', forced: false })).toBe(false);
  });

  it('resolves the preferred language from the app language or the setting', () => {
    expect(resolvePreferredLanguage(DEFAULT_TRACK_PREFERENCES, 'es')).toBe('es');
    expect(resolvePreferredLanguage({ ...DEFAULT_TRACK_PREFERENCES, subtitleLanguage: 'fr' }, 'es')).toBe('fr');
  });

  it('recognises anime ids', () => {
    expect(isAnimeExternalId('anime:21')).toBe(true);
    expect(isAnimeExternalId('series:1399:s2')).toBe(false);
    expect(isAnimeExternalId(null)).toBe(false);
  });
});

describe('chooseTracks: anime', () => {
  it('picks Japanese audio and full Spanish subtitles over signs', () => {
    const tracks = [
      track('audio', 'spa', 'Español', { is_default: true, selected: true }),
      track('audio', 'jpn', null),
      track('sub', 'spa', 'Signs & Songs'),
      track('sub', 'spa', 'Full'),
      track('sub', 'eng', 'Full'),
    ];
    expect(chooseTracks(tracks, context())).toEqual({ audio: tracks[1].id, sub: tracks[3].id });
  });

  it('prefers Castilian subtitles to Latin American ones', () => {
    const tracks = [
      track('audio', 'jpn'),
      track('sub', 'spa', 'Español (Latino)', { is_default: true }),
      track('sub', 'spa', 'Castellano'),
    ];
    expect(chooseTracks(tracks, context()).sub).toBe(tracks[2].id);
  });

  it('falls back to English subtitles, then to the file default', () => {
    const english = [track('audio', 'jpn'), track('sub', 'eng', 'Dialogue'), track('sub', 'fre')];
    expect(chooseTracks(english, context()).sub).toBe(english[1].id);
    const neither = [track('audio', 'jpn'), track('sub', 'fre')];
    expect(chooseTracks(neither, context()).sub).toBeUndefined();
    expect(chooseTracks(english, context({}, { fallbackSubtitles: 'none' })).sub).toBeNull();
  });

  it('without Japanese audio uses the preferred audio with signs, else no subtitles', () => {
    const withSigns = [track('audio', 'eng'), track('audio', 'spa'), track('sub', 'spa', 'Forzados'), track('sub', 'spa', 'Completos')];
    expect(chooseTracks(withSigns, context())).toEqual({ audio: withSigns[1].id, sub: withSigns[2].id });
    const noSigns = [track('audio', 'spa'), track('sub', 'spa', 'Completos')];
    expect(chooseTracks(noSigns, context())).toEqual({ audio: noSigns[0].id, sub: null });
  });

  it('honours the anime audio setting', () => {
    const tracks = [track('audio', 'jpn'), track('audio', 'spa'), track('sub', 'spa')];
    expect(chooseTracks(tracks, context({}, { animeAudio: 'preferred' }))).toEqual({ audio: tracks[1].id, sub: null });
    const fileDefault = chooseTracks(tracks, context({}, { animeAudio: 'default' }));
    expect(fileDefault.audio).toBeUndefined();
  });

  it('for a Japanese UI keeps Japanese audio without subtitles', () => {
    const tracks = [track('audio', 'jpn'), track('sub', 'eng')];
    expect(chooseTracks(tracks, context({ appLanguage: 'ja' }))).toEqual({ audio: tracks[0].id, sub: null });
  });
});

describe('chooseTracks: other media', () => {
  it('uses preferred-language audio and turns subtitles off (keeping forced ones)', () => {
    const tracks = [track('audio', 'eng', null, { is_default: true }), track('audio', 'spa'), track('sub', 'spa'), track('sub', 'spa', null, { forced: true })];
    expect(chooseTracks(tracks, context({ isAnime: false }))).toEqual({ audio: tracks[1].id, sub: tracks[3].id });
  });

  it('keeps the original audio when the preferred one is missing and adds subtitles', () => {
    const tracks = [track('audio', 'eng', null, { is_default: true, selected: true }), track('sub', 'eng'), track('sub', 'spa')];
    expect(chooseTracks(tracks, context({ isAnime: false }))).toEqual({ audio: undefined, sub: tracks[2].id });
  });

  it('with English as the preferred language leaves English audio unsubtitled', () => {
    const tracks = [track('audio', 'eng', null, { selected: true }), track('sub', 'eng')];
    expect(chooseTracks(tracks, context({ isAnime: false, appLanguage: 'en' }))).toEqual({ audio: tracks[0].id, sub: null });
  });

  it('does nothing when smart selection is off', () => {
    const tracks = [track('audio', 'jpn'), track('sub', 'spa')];
    expect(chooseTracks(tracks, context({}, { smart: false }))).toEqual({ audio: undefined, sub: undefined });
  });
});

describe('per-series memory', () => {
  it('matches remembered hints by language and title, not index', () => {
    const tracks = [track('sub', 'spa', 'Signs'), track('sub', 'spa', 'Español (Latino)'), track('sub', 'spa', 'Castellano')];
    const hint = hintFor(tracks[1]);
    expect(hint).toEqual({ lang: 'es', title: 'Español (Latino)', forced: false });
    const nextEpisode = [track('sub', 'spa', 'Castellano'), track('sub', 'spa', 'Español (Latino)')];
    expect(matchHint(nextEpisode, 'sub', hint)?.id).toBe(nextEpisode[1].id);
    expect(matchHint([track('sub', 'eng')], 'sub', hint)).toBeNull();
  });

  it('overrides the global rule per kind and can remember "off"', () => {
    const tracks = [track('audio', 'jpn'), track('audio', 'spa', 'Español (Latino)'), track('sub', 'spa', 'Full'), track('sub', 'eng')];
    const memory = { audio: { lang: 'es', title: 'Español (Latino)', forced: false }, sub: null };
    expect(chooseTracks(tracks, context({ memory }))).toEqual({ audio: tracks[1].id, sub: null });
    const subOnly = { sub: { lang: 'en', title: null, forced: false } };
    expect(chooseTracks(tracks, context({ memory: subOnly }))).toEqual({ audio: tracks[0].id, sub: tracks[3].id });
  });

  it('falls back to the rule when the remembered track is not in this file', () => {
    const tracks = [track('audio', 'jpn'), track('sub', 'spa', 'Full')];
    const memory = { sub: { lang: 'fr', title: null, forced: false } };
    expect(chooseTracks(tracks, context({ memory })).sub).toBe(tracks[1].id);
  });
});
