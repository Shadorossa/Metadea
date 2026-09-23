// What keeps Ambient mode from starting even after the idle delay: the user
// is watching, reading, playing or typing, or something else is making
// sound. `collectAmbientBlockers` is the pure rule; `readAmbientBlockerSnapshot`
// gathers the facts (module stores + one cheap DOM probe), and only runs
// when the idle delay has already elapsed.
import { playerModalStore } from '../player/player-modal-state';
import { playbackStore } from '../local/playback-service';
import { gamePresenceStore } from '../local/discord-presence';

export type AmbientBlocker = 'player' | 'reader' | 'game' | 'text-input' | 'media-audio';

export interface AmbientBlockerSnapshot {
  /** The built-in player modal is open. */
  playerModalOpen: boolean;
  /** An external/local playback session is playing. */
  playbackPlaying: boolean;
  /** The comic or EPUB reader is open. */
  readerOpen: boolean;
  /** A game launched from the app is running (playtime session). */
  gameRunning: boolean;
  /** A text field inside a dialog has focus. */
  modalTextInputFocused: boolean;
  /** An unmuted <audio>/<video> in the page is playing (theme overlay,
   *  trailer...) — the jukebox's own element is not in the DOM. */
  foreignMediaPlaying: boolean;
  /** The media page's theme video overlay is open. */
  themeOverlayOpen: boolean;
}

export function collectAmbientBlockers(snapshot: AmbientBlockerSnapshot): AmbientBlocker[] {
  const blockers: AmbientBlocker[] = [];
  if (snapshot.playerModalOpen || snapshot.playbackPlaying) blockers.push('player');
  if (snapshot.readerOpen) blockers.push('reader');
  if (snapshot.gameRunning) blockers.push('game');
  if (snapshot.modalTextInputFocused) blockers.push('text-input');
  if (snapshot.foreignMediaPlaying || snapshot.themeOverlayOpen) blockers.push('media-audio');
  return blockers;
}

const READER_SELECTOR = '.comic-reader-overlay';
const THEME_OVERLAY_SELECTOR = '.theme-player-overlay';
const DIALOG_SELECTOR = '[role="dialog"], dialog, [aria-modal="true"]';
const TEXT_INPUT_TYPES = new Set(['text', 'search', 'email', 'url', 'tel', 'password', 'number', '']);

function isTextField(element: Element | null): boolean {
  if (!element) return false;
  if (element instanceof HTMLTextAreaElement) return true;
  if (element instanceof HTMLInputElement) return TEXT_INPUT_TYPES.has(element.type);
  return element instanceof HTMLElement && element.isContentEditable;
}

function isForeignMediaPlaying(doc: Document): boolean {
  for (const media of doc.querySelectorAll<HTMLMediaElement>('audio, video')) {
    if (!media.paused && !media.ended && !media.muted && media.volume > 0) return true;
  }
  return false;
}

export function readAmbientBlockerSnapshot(doc: Document = document): AmbientBlockerSnapshot {
  const active = doc.activeElement;
  return {
    playerModalOpen: playerModalStore.get(),
    playbackPlaying: playbackStore.get()?.status === 'playing',
    readerOpen: !!doc.querySelector(READER_SELECTOR),
    gameRunning: !!gamePresenceStore.get(),
    modalTextInputFocused: isTextField(active) && !!active?.closest(DIALOG_SELECTOR),
    foreignMediaPlaying: isForeignMediaPlaying(doc),
    themeOverlayOpen: !!doc.querySelector(THEME_OVERLAY_SELECTOR),
  };
}
