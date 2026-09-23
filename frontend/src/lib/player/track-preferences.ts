// Smart default audio/subtitle tracks for the built-in player. Pure: no
// React, no Tauri, no storage — the hook (components/player/hooks/
// usePlayerTrackPreferences) feeds it mpv's `track-list`, the settings and
// the per-series memory, and applies what comes back.
//
// Rules, with L = the preferred language (Settings › Player, default: the
// app language):
// - Anime (`anime:` ids): Japanese audio (setting: Japanese / my language /
//   file default) with full-dialogue L subtitles, falling back to English
//   (setting) and then to the file's own choice. No Japanese audio: L audio
//   with L signs/forced subtitles if any, else subtitles off.
// - Everything else: L audio if present, else the file default. Audio in L
//   means subtitles off (except L signs/forced); otherwise L subtitles,
//   then the fallback, then the file's own choice.
// - A choice the user made by hand for a series (language + title hints,
//   never a track index) overrides the rule for that kind of track.

import type { PlayerTrack } from './player-status';

export type AnimeAudioPreference = 'japanese' | 'preferred' | 'default';
export type FallbackSubtitles = 'english' | 'none';
/** 'app' follows the UI language; anything else is a language code. */
export type SubtitleLanguagePreference = 'app' | string;

export interface TrackPreferences {
  smart: boolean;
  animeAudio: AnimeAudioPreference;
  subtitleLanguage: SubtitleLanguagePreference;
  fallbackSubtitles: FallbackSubtitles;
}

export const DEFAULT_TRACK_PREFERENCES: TrackPreferences = {
  smart: true,
  animeAudio: 'japanese',
  subtitleLanguage: 'app',
  fallbackSubtitles: 'english',
};

/** What the user picked by hand, remembered per series. */
export interface TrackHint {
  lang: string | null;
  title: string | null;
  forced: boolean;
}

/** `null` = the user turned that kind off. */
export interface TrackMemory {
  audio?: TrackHint | null;
  sub?: TrackHint | null;
}

/** `undefined` = leave mpv's choice, `null` = off, number = track id. */
export interface TrackChoice {
  audio: number | null | undefined;
  sub: number | null | undefined;
}

// ── Language matching ────────────────────────────────────────────────────

const CODE_ALIASES: Record<string, string> = {
  es: 'es', spa: 'es', esp: 'es',
  en: 'en', eng: 'en',
  ja: 'ja', jpn: 'ja', jp: 'ja',
  de: 'de', deu: 'de', ger: 'de',
  fr: 'fr', fra: 'fr', fre: 'fr',
  it: 'it', ita: 'it',
  ca: 'ca', cat: 'ca',
  ru: 'ru', rus: 'ru',
  pt: 'pt', por: 'pt',
  zh: 'zh', zho: 'zh', chi: 'zh',
  ko: 'ko', kor: 'ko',
};

// Title words that name a language, for tracks with no (or an `und`) tag.
const TITLE_LANGUAGES: [RegExp, string][] = [
  [/japanese|japon[eé]s|japonais|giapponese|japanisch|日本語|японск/i, 'ja'],
  [/english|ingl[eé]s|anglais|inglese|englisch|англ/i, 'en'],
  [/espa[ñn]ol|spanish|castellano|latino|espagnol|spagnolo|spanisch|испан/i, 'es'],
  [/deutsch|german|alem[aá]n|allemand|tedesco|немец/i, 'de'],
  [/fran[çc]ais|french|franc[eé]s|francese|franz[öo]sisch|франц/i, 'fr'],
  [/italiano|italian|italien|итальян/i, 'it'],
  [/catal[àa]|catalan/i, 'ca'],
  [/русский|russian|ruso|russe|russo|russisch/i, 'ru'],
];

/** ISO 639-1/-2 code (optionally with a region: `es-ES`, `spa_419`) → base code. */
export function normalizeLanguage(code: string | null | undefined): string | null {
  const base = (code ?? '').trim().toLowerCase().split(/[-_]/)[0];
  if (!base || base === 'und' || base === 'mul' || base === 'zxx') return null;
  return CODE_ALIASES[base] ?? base;
}

/** The language a track is in: its tag, else what its title says. */
export function trackLanguage(track: Pick<PlayerTrack, 'lang' | 'title'>): string | null {
  const fromCode = normalizeLanguage(track.lang);
  if (fromCode) return fromCode;
  const title = track.title ?? '';
  for (const [pattern, lang] of TITLE_LANGUAGES) {
    if (pattern.test(title)) return lang;
  }
  return null;
}

const LATIN_AMERICAN = /latino|latinoam|latam|lat\.?\b|\(la\)|m[eé]xic|hispanoam|es-419|spa-419/i;
const CASTILIAN = /castellano|castilian|espa[ñn]a|spain|european|\(es\)|es-es|spa-es/i;

/** For Spanish: +1 Castilian / es-ES, -1 Latin American, 0 unknown. */
export function spanishVariantScore(track: Pick<PlayerTrack, 'lang' | 'title'>): number {
  const text = `${track.lang ?? ''} ${track.title ?? ''}`;
  const region = (track.lang ?? '').toLowerCase().split(/[-_]/)[1] ?? '';
  if (LATIN_AMERICAN.test(text) || (region && region !== 'es')) return -1;
  if (CASTILIAN.test(text) || region === 'es') return 1;
  return 0;
}

const SIGNS = /sign|song|forced|forzad|forc[ée]|carteles|letreros|s&s|надпис|erzwungen|forzati/i;
const FULL = /full|dialog|di[áa]logo|complet|vollst|полн/i;

/** Signs & songs / forced-only subtitles (not the whole dialogue). */
export function isSignsTrack(track: Pick<PlayerTrack, 'title' | 'forced'>): boolean {
  const title = track.title ?? '';
  return Boolean(track.forced) || (SIGNS.test(title) && !FULL.test(title));
}

// ── Picking ──────────────────────────────────────────────────────────────

function ofKind(tracks: readonly PlayerTrack[], kind: 'audio' | 'sub'): PlayerTrack[] {
  return tracks.filter(track => track.kind === kind);
}

/** Best track in `lang`, highest score wins, file order breaks ties. */
function best(tracks: readonly PlayerTrack[], lang: string, score: (track: PlayerTrack) => number): PlayerTrack | null {
  let winner: PlayerTrack | null = null;
  let winnerScore = -Infinity;
  for (const track of tracks) {
    if (trackLanguage(track) !== lang) continue;
    const value = score(track);
    if (value > winnerScore) {
      winner = track;
      winnerScore = value;
    }
  }
  return winner;
}

function baseScore(track: PlayerTrack, lang: string): number {
  let value = track.is_default ? 1 : 0;
  if (lang === 'es') value += spanishVariantScore(track) * 4;
  return value;
}

function pickAudio(tracks: readonly PlayerTrack[], lang: string): PlayerTrack | null {
  return best(ofKind(tracks, 'audio'), lang, track => baseScore(track, lang) - (/comment/i.test(track.title ?? '') ? 10 : 0));
}

/** Whole-dialogue subtitles in `lang` (signs-only tracks excluded). */
function pickDialogueSub(tracks: readonly PlayerTrack[], lang: string): PlayerTrack | null {
  const dialogue = ofKind(tracks, 'sub').filter(track => !isSignsTrack(track));
  return best(dialogue, lang, track => baseScore(track, lang) + (FULL.test(track.title ?? '') ? 2 : 0));
}

function pickSignsSub(tracks: readonly PlayerTrack[], lang: string): PlayerTrack | null {
  const signs = ofKind(tracks, 'sub').filter(isSignsTrack);
  return best(signs, lang, track => baseScore(track, lang));
}

/** The audio mpv would play if left alone: selected, else default, else first. */
function effectiveAudio(tracks: readonly PlayerTrack[]): PlayerTrack | null {
  const audio = ofKind(tracks, 'audio');
  return audio.find(track => track.selected) ?? audio.find(track => track.is_default) ?? audio[0] ?? null;
}

function subtitlesFor(
  tracks: readonly PlayerTrack[],
  audioLang: string | null,
  preferred: string,
  fallback: FallbackSubtitles,
): number | null | undefined {
  if (audioLang === preferred) return pickSignsSub(tracks, preferred)?.id ?? null;
  const dialogue = pickDialogueSub(tracks, preferred);
  if (dialogue) return dialogue.id;
  if (fallback === 'none') return null;
  if (preferred !== 'en') {
    const english = pickDialogueSub(tracks, 'en');
    if (english) return english.id;
  }
  return undefined;
}

/** A remembered hint → the matching track (same language, then title). */
export function matchHint(tracks: readonly PlayerTrack[], kind: 'audio' | 'sub', hint: TrackHint): PlayerTrack | null {
  const candidates = ofKind(tracks, kind);
  let winner: PlayerTrack | null = null;
  let winnerScore = 0;
  for (const track of candidates) {
    const lang = trackLanguage(track);
    if (hint.lang && lang !== hint.lang) continue;
    let value = 1;
    const title = (track.title ?? '').trim().toLowerCase();
    const wanted = (hint.title ?? '').trim().toLowerCase();
    if (wanted && title === wanted) value += 4;
    else if (wanted && title && (title.includes(wanted) || wanted.includes(title))) value += 2;
    if (kind === 'sub' && isSignsTrack(track) === hint.forced) value += 3;
    if (!hint.lang && !(wanted && title === wanted)) continue;
    if (value > winnerScore) {
      winner = track;
      winnerScore = value;
    }
  }
  return winner;
}

export function hintFor(track: PlayerTrack): TrackHint {
  return { lang: trackLanguage(track), title: track.title?.trim() || null, forced: isSignsTrack(track) };
}

export function isAnimeExternalId(externalId: string | null | undefined): boolean {
  return /^anime:/.test(externalId ?? '');
}

export function resolvePreferredLanguage(preferences: TrackPreferences, appLanguage: string): string {
  const chosen = preferences.subtitleLanguage === 'app' ? appLanguage : preferences.subtitleLanguage;
  return normalizeLanguage(chosen) ?? 'en';
}

export interface TrackContext {
  preferences: TrackPreferences;
  /** Resolved UI language (i18n runtime: Settings → system → English). */
  appLanguage: string;
  isAnime: boolean;
  memory?: TrackMemory | null;
}

/** What to select for a freshly loaded file. */
export function chooseTracks(tracks: readonly PlayerTrack[], context: TrackContext): TrackChoice {
  const choice: TrackChoice = { audio: undefined, sub: undefined };
  if (!context.preferences.smart || tracks.length === 0) return choice;
  const preferred = resolvePreferredLanguage(context.preferences, context.appLanguage);
  const { fallbackSubtitles, animeAudio } = context.preferences;

  let audioTrack: PlayerTrack | null = null;
  if (context.isAnime) {
    const japanese = pickAudio(tracks, 'ja');
    if (animeAudio === 'japanese') audioTrack = japanese ?? pickAudio(tracks, preferred);
    else if (animeAudio === 'preferred') audioTrack = pickAudio(tracks, preferred);
  } else {
    audioTrack = pickAudio(tracks, preferred);
  }

  // A remembered audio choice for this series wins over the rule.
  const memory = context.memory;
  if (memory && memory.audio !== undefined) {
    const remembered = memory.audio ? matchHint(tracks, 'audio', memory.audio) : null;
    if (memory.audio === null) choice.audio = null;
    else if (remembered) audioTrack = remembered;
  }
  if (choice.audio === undefined && audioTrack) choice.audio = audioTrack.id;

  const audioLang = choice.audio === null ? null : trackLanguage(audioTrack ?? effectiveAudio(tracks) ?? { lang: null, title: null });
  if (ofKind(tracks, 'sub').length > 0 || memory?.sub === null) {
    choice.sub = subtitlesFor(tracks, audioLang, preferred, fallbackSubtitles);
  }
  if (memory && memory.sub !== undefined) {
    if (memory.sub === null) choice.sub = null;
    else {
      const remembered = matchHint(tracks, 'sub', memory.sub);
      if (remembered) choice.sub = remembered.id;
    }
  }
  return choice;
}
