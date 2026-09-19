import { updateDiscordPresence, resetDiscordPresence } from '../tauri/misc-commands';
import { toMediumCover } from '../shared/small-cover';
import { listenGameSessionEnded, addPlaytimeHours } from '../tauri';
import { createExternalStore } from '../shared/external-store';

export interface GamePresence {
  title: string;
  coverUrl?: string;
  startTime: number;
  externalId?: string;
  installPath?: string;
  romPlatform?: string;
}

export interface PlaybackPresence {
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
}

export interface MediaPagePresence {
  title: string;
  typeLabel: string;
  coverUrl?: string;
}

let activeGame: GamePresence | null = null;
let activePlayback: PlaybackPresence | null = null;
let activeReading: ReadingPresence | null = null;
let activeMediaPage: MediaPagePresence | null = null;
let listenerInitialized = false;
const gamePresenceStore = createExternalStore<GamePresence | null>(null);

export const useGamePresence = gamePresenceStore.use;

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
      "Metadea"
    ).catch(() => {});
    return;
  }

  // 2. Second priority: Active media playback (VLC)
  if (activePlayback) {
    const cover = activePlayback.coverUrl ? toMediumCover(activePlayback.coverUrl) : undefined;
    const stateText = activePlayback.status === 'paused' ? 'Paused' : '';
    updateDiscordPresence(
      `Watching ${activePlayback.title} - Episode ${activePlayback.episodeNumber}`,
      stateText,
      activePlayback.startTime,
      activePlayback.endTime,
      cover,
      activePlayback.title,
      "metadea",
      "Metadea"
    ).catch(() => {});
    return;
  }

  // 3. Third priority: Reading in reader modal
  if (activeReading) {
    const cover = activeReading.coverUrl ? toMediumCover(activeReading.coverUrl) : undefined;
    updateDiscordPresence(
      `Reading ${activeReading.title}`,
      `Page ${activeReading.pageLabel}`,
      undefined,
      undefined,
      cover,
      activeReading.title,
      "metadea",
      "Metadea"
    ).catch(() => {});
    return;
  }

  // 4. Fourth priority: Viewing a media catalog entry
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

  // 5. Default: Exploring library
  resetDiscordPresence().catch(() => {});
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
  if (activeGame || activePlayback || activeReading) {
    return;
  }
  activeMediaPage = null;
  applyCurrentPresence();
}

if (typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>).__metadeaPresenceManager = {
    requestDiscordIdle,
    clearGamePresence,
  };
}
