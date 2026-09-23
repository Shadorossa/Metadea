import { updateDiscordPresence, resetDiscordPresence, type PresenceButton } from '../tauri/discord-presence';
import { formatPresenceLines, formatThemePresenceLines } from '../player/presence-sync';
import { toMediumCover } from '../media/small-cover';
import { buildShareUrl, isValidDeepLinkTarget } from '../deep-link/deep-link-routes';
import { buildShareLink, type ShareableWork } from '../deep-link/share-link';
import { createExternalStore } from '../shared/state/external-store';
import {
  buildGameStateLine, platformPresenceImage, sameAchievementCount, type AchievementCount,
} from './game-rich-presence';

// Discord-facing literal (not app UI): the second presence button, a share
// link that opens the work's page in Metadea.
const OPEN_IN_METADEA_LABEL = 'Open in Metadea';

// The "Open in Metadea" button for a work, or none when the id is not a
// shareable external id (local-only entries). With the work's catalog data
// it is the rich preview link (share-link.ts); otherwise, or when that data
// cannot be encoded, the plain /open/ redirect.
export function mediaPresenceButton(externalId: string | undefined, work?: ShareableWork): PresenceButton | undefined {
  if (!externalId) return undefined;
  const target = { kind: 'media', external_id: externalId } as const;
  if (!isValidDeepLinkTarget(target)) return undefined;
  const rich = work && work.externalId === externalId ? buildShareLink(work) : null;
  return { label: OPEN_IN_METADEA_LABEL, url: rich ?? buildShareUrl(target) };
}

export interface GamePresence {
  title: string;
  coverUrl?: string;
  startTime: number;
  externalId?: string;
  installPath?: string;
  romPlatform?: string;
  // Console and emulator for ROMs ("Nintendo DS", "melonDS").
  platformName?: string;
  emulatorName?: string;
  // Steam games: the app id their achievements are read with.
  steamAppId?: number;
  // RetroAchievements (ROMs) or Steam unlock counts, refreshed during the
  // session by game-achievement-refresh.ts.
  achievements?: AchievementCount;
  // Set when the presence mirrors a Rust game session (game-session-state.ts):
  // only those are cleared when the session list empties.
  sessionId?: string;
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
  // The work's external id: links the "Open in Metadea" button to its page.
  externalId?: string;
  // Catalog data for the button's rich share link (share-link.ts).
  share?: ShareableWork;
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
  // Optional: a theme always plays on a media page, so the page's own id is
  // the fallback for the button.
  externalId?: string;
  share?: ShareableWork;
}

export interface MediaPagePresence {
  title: string;
  typeLabel: string;
  coverUrl?: string;
  externalId?: string;
  share?: ShareableWork;
}

let activeGame: GamePresence | null = null;
let activePlayback: PlaybackPresence | null = null;
let activeTheme: ThemePresence | null = null;
let activeReading: ReadingPresence | null = null;
let activeMediaPage: MediaPagePresence | null = null;
export const gamePresenceStore = createExternalStore<GamePresence | null>(null);

// Game presence is set and cleared from the Rust session registry on every
// page load and on "game-sessions-changed" (game-session-state.ts), so it
// survives navigation; nothing here listens for sessions itself.

function applyCurrentPresence() {
  // 1. Highest priority: Active game
  if (activeGame) {
    const cover = activeGame.coverUrl ? toMediumCover(activeGame.coverUrl) : undefined;
    // ROMs show their console as the small image; everything else Metadea.
    const consoleImage = platformPresenceImage(activeGame.romPlatform);
    updateDiscordPresence(
      `Playing ${activeGame.title}`,
      buildGameStateLine(activeGame),
      activeGame.startTime,
      undefined,
      cover,
      activeGame.title,
      consoleImage ?? "metadea",
      consoleImage ? (activeGame.platformName ?? activeGame.title) : "Metadea",
      'playing',
    ).catch(() => {});
    return;
  }

  // 2. Second priority: Active video playback (built-in player)
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
      mediaPresenceButton(activePlayback.externalId, activePlayback.share),
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
      mediaPresenceButton(
        activeTheme.externalId ?? activeMediaPage?.externalId,
        activeTheme.share ?? activeMediaPage?.share,
      ),
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
      "Metadea",
      undefined,
      mediaPresenceButton(activeMediaPage.externalId, activeMediaPage.share),
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

// A fresh unlock count for the running session's presence; unchanged counts
// (or another session by now) leave Discord alone.
export function updateGameAchievements(sessionId: string, count: AchievementCount) {
  if (!activeGame || activeGame.sessionId !== sessionId) return;
  if (sameAchievementCount(activeGame.achievements, count)) return;
  activeGame = { ...activeGame, achievements: count };
  gamePresenceStore.set(activeGame);
  applyCurrentPresence();
}

export function getGamePresence(): GamePresence | null {
  return activeGame;
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
