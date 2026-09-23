import { updateDiscordPresence, resetDiscordPresence } from '../tauri/discord-presence';
import { formatPresenceLines, formatThemePresenceLines } from '../player/presence-sync';
import { toMediumCover } from '../media/small-cover';
import { listenGameSessionEnded, addPlaytimeHours } from '../tauri';
import { createExternalStore } from '../shared/state/external-store';

export interface GamePresence {
  title: string;
  coverUrl?: string;
  startTime: number;
  externalId?: string;
  installPath?: string;
  romPlatform?: string;
}

export interface PlaybackPresence {
  // Screenshot-style label (S01E02 / M01) and the episode's own title, when
  // the queue knows them - see formatPresenceLines.
  episodeLabel?: string;
  episodeTitle?: string;
  title: string;
  episodeNumber: number;
  status: 'playing' | 'paused';
  startTime?: number;
  endTime?: number;
  coverUrl?: string;
}

export interface ReadingPresence {
  title: string;
  pageLabel: string;
  coverUrl?: string;
  // Unix seconds the reading session opened — Discord shows the elapsed time.
  startTime?: number;
}

// An OP/ED playing in a media page's theme player.
export interface ThemePresence {
  themeLabel: string;
  songTitle?: string | null;
  artists?: string | null;
  mediaTitle: string;
  status: 'playing' | 'paused';
  startTime?: number;
  endTime?: number;
  coverUrl?: string;
}

export interface MediaPagePresence {
  title: string;
  typeLabel: string;
  coverUrl?: string;
}

let activeGame: GamePresence | null = null;
let activePlayback: PlaybackPresence | null = null;
let activeTheme: ThemePresence | null = null;
let activeReading: ReadingPresence | null = null;
let activeMediaPage: MediaPagePresence | null = null;
let listenerInitialized = false;
export const gamePresenceStore = createExternalStore<GamePresence | null>(null);


function initSessionListener() {
  if (listenerInitialized || typeof window === 'undefined') return;
  listenerInitialized = true;
  listenGameSessionEnded(() => {
    clearGamePresence();
  }).catch(() => {
    // If WebView/Tauri event setup was temporarily unavailable, retry instead
    // of leaving the game presence permanently uncleared for this page life.
    listenerInitialized = false;
    setTimeout(initSessionListener, 1000);
  });
}

initSessionListener();

function applyCurrentPresence() {
  // 1. Highest priority: Active game
  if (activeGame) {
    const cover = activeGame.coverUrl ? toMediumCover(activeGame.coverUrl) : undefined;
    updateDiscordPresence(
      `Playing ${activeGame.title}`,
      "",
      activeGame.startTime,
      undefined,
      cover,
      activeGame.title,
      "metadea",
      "Metadea",
      'playing',
    ).catch(() => {});
    return;
  }

  // 2. Second priority: Active media playback (VLC)
  if (activePlayback) {
    const cover = activePlayback.coverUrl ? toMediumCover(activePlayback.coverUrl) : undefined;
    const lines = formatPresenceLines({
      title: activePlayback.title,
      episodeNumber: activePlayback.episodeNumber,
      episodeLabel: activePlayback.episodeLabel,
      episodeTitle: activePlayback.episodeTitle,
      status: activePlayback.status,
    });
    updateDiscordPresence(
      lines.details,
      lines.state,
      activePlayback.startTime,
      activePlayback.endTime,
      cover,
      activePlayback.title,
      "metadea",
      "Metadea",
      'watching',
    ).catch(() => {});
    return;
  }

  // 3. A theme (OP/ED) playing on a media page — beats the page's own
  // "Viewing" tier and the reader (the reader can't be open on a media page).
  if (activeTheme) {
    const cover = activeTheme.coverUrl ? toMediumCover(activeTheme.coverUrl) : undefined;
    const lines = formatThemePresenceLines(activeTheme);
    updateDiscordPresence(
      lines.details,
      lines.state,
      activeTheme.startTime,
      activeTheme.endTime,
      cover,
      activeTheme.mediaTitle,
      "metadea",
      "Metadea",
      'listening',
    ).catch(() => {});
    return;
  }

  // 4. Reading in reader modal — Discord has no "Reading" type; "Watching"
  // is the closest header.
  if (activeReading) {
    const cover = activeReading.coverUrl ? toMediumCover(activeReading.coverUrl) : undefined;
    updateDiscordPresence(
      `Reading ${activeReading.title}`,
      `Page ${activeReading.pageLabel}`,
      activeReading.startTime,
      undefined,
      cover,
      activeReading.title,
      "metadea",
      "Metadea",
      'watching',
    ).catch(() => {});
    return;
  }

  // 5. Viewing a media catalog entry
  if (activeMediaPage) {
    const cover = activeMediaPage.coverUrl ? toMediumCover(activeMediaPage.coverUrl) : undefined;
    updateDiscordPresence(
      `Viewing ${activeMediaPage.typeLabel}`,
      "",
      undefined,
      undefined,
      cover,
      activeMediaPage.title,
      "metadea",
      "Metadea"
    ).catch(() => {});
    return;
  }

  // 6. Default: Exploring library
  resetDiscordPresence().catch(() => {});
}

export function setThemePresence(theme: ThemePresence) {
  activeTheme = theme;
  applyCurrentPresence();
}

export function clearThemePresence() {
  if (!activeTheme) return;
  activeTheme = null;
  applyCurrentPresence();
}

export function setGamePresence(game: GamePresence) {
  activeGame = game;
  gamePresenceStore.set(game);
  applyCurrentPresence();
}

export function clearGamePresence() {
  activeGame = null;
  gamePresenceStore.set(null);
  applyCurrentPresence();
}

export function setPlaybackPresence(playback: PlaybackPresence) {
  activePlayback = playback;
  applyCurrentPresence();
}

export function clearPlaybackPresence() {
  activePlayback = null;
  applyCurrentPresence();
}

export function setReadingPresence(reading: ReadingPresence) {
  activeReading = reading;
  applyCurrentPresence();
}

export function clearReadingPresence() {
  activeReading = null;
  applyCurrentPresence();
}

export function setMediaPagePresence(mediaPage: MediaPagePresence) {
  activeMediaPage = mediaPage;
  applyCurrentPresence();
}

export function clearMediaPagePresence() {
  activeMediaPage = null;
  applyCurrentPresence();
}

export function requestDiscordIdle() {
  if (activeGame || activePlayback || activeTheme || activeReading) {
    return;
  }
  activeMediaPage = null;
  applyCurrentPresence();
}

if (typeof window !== 'undefined') {
  window.__metadeaPresenceManager = {
    requestDiscordIdle,
    clearGamePresence,
  };
}
