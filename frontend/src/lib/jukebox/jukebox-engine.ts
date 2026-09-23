// The jukebox's side effects: one detached HTMLAudioElement (never in the
// DOM, so Astro's body swap cannot touch it) driven by jukeboxStore, the
// favourites round-trip to Rust, media-key handlers, Discord presence and
// the "someone else is playing video, get out of the way" rules. Pure queue
// decisions live in jukebox-store.ts; this file only wires them to the
// element and the rest of the app.
import { wrapAssetUrl } from '../tauri/bridge';
import { getFavoriteThemes, reorderFavoriteThemes, setThemeFavorite, type FavoriteTheme } from '../tauri/jukebox';
import { getThemeVideoPath, type MediaTheme } from '../tauri/themes';
import { clearThemePresence, setThemePresence } from '../local/discord-presence';
import { playbackStore } from '../local/playback-service';
import { playerModalStore } from '../player/player-modal-state';
import { buildPresenceSnapshot, shouldResendPresence, type PresenceSnapshot } from '../player/presence-sync';
import { toMediumCover } from '../media/small-cover';
import { moveItem } from '../shared/collections/move-item';
import { readJukeboxPreferences, writeJukeboxPreferences } from './jukebox-preferences';
import { applyFavoriteToggle, themeDisplayTitle, toFavoriteKeys, type FavoriteToggleContext } from './jukebox-favorites';
import {
  clampVolume, currentTheme, cycleRepeat, effectiveVolume, findQueueIndex, jukeboxStore, nextIndex, prevIndex, themeKey,
  withQueue, withShuffle, type JukeboxState,
} from './jukebox-store';

const THEME_OVERLAY_SELECTOR = '.theme-player-overlay';

let audio: HTMLAudioElement | null = null;
let initialized = false;
// Bumped on every load so a slow source resolution for a theme the user
// already skipped past cannot clobber the element.
let loadToken = 0;
// Consecutive themes that failed to load — stops an all-broken queue from
// spinning forever on auto-advance.
let failureStreak = 0;
let lastPresence: PresenceSnapshot | null = null;
let overlayObserver: MutationObserver | null = null;
// Temporary volume multiplier (Ambient mode's "play softly"); never saved and
// never shown — the store keeps the user's own volume.
let duckFactor = 1;

function patch(partial: Partial<JukeboxState>): void {
  jukeboxStore.set({ ...jukeboxStore.get(), ...partial });
}

function savePreferences(): void {
  const state = jukeboxStore.get();
  const current = currentTheme(state);
  writeJukeboxPreferences({
    volume: state.volume,
    shuffle: state.shuffle,
    repeat: state.repeat,
    lastKey: current ? themeKey(current.theme) : null,
  });
}

// ── Discord ──────────────────────────────────────────────────────────────

function publishPresence(): void {
  const state = jukeboxStore.get();
  const entry = currentTheme(state);
  if (!entry || !audio) return;
  const status = audio.paused || audio.ended ? 'paused' : 'playing';
  const snapshot = buildPresenceSnapshot(status, Math.floor(Date.now() / 1000), audio.currentTime, audio.duration, audio.playbackRate);
  if (!shouldResendPresence(lastPresence, snapshot)) return;
  lastPresence = snapshot;
  const cover = entry.cover_url;
  setThemePresence({
    themeLabel: `${entry.theme.theme_type}${entry.theme.sequence}`,
    songTitle: entry.theme.song_title,
    artists: entry.theme.artists,
    mediaTitle: entry.media_title,
    status: snapshot.status,
    startTime: snapshot.startTime,
    endTime: snapshot.endTime,
    coverUrl: cover && cover.startsWith('http') ? toMediumCover(cover) : undefined,
    externalId: entry.theme.external_id,
    share: { externalId: entry.theme.external_id, title: entry.media_title, coverUrl: cover },
  });
}

function dropPresence(): void {
  lastPresence = null;
  clearThemePresence();
}

// ── Media keys ───────────────────────────────────────────────────────────

function mediaSession(): MediaSession | null {
  return typeof navigator !== 'undefined' && 'mediaSession' in navigator ? navigator.mediaSession : null;
}

function updateMediaSessionMetadata(entry: FavoriteTheme | null): void {
  const session = mediaSession();
  if (!session) return;
  if (!entry) {
    session.metadata = null;
    return;
  }
  const cover = entry.cover_url;
  session.metadata = new MediaMetadata({
    title: themeDisplayTitle(entry.theme),
    artist: entry.theme.artists ?? '',
    album: entry.media_title,
    artwork: cover && cover.startsWith('http') ? [{ src: toMediumCover(cover) }] : [],
  });
}

function updateMediaSessionState(): void {
  const session = mediaSession();
  if (!session) return;
  const status = jukeboxStore.get().status;
  session.playbackState = status === 'playing' ? 'playing' : status === 'paused' ? 'paused' : 'none';
}

function installMediaSessionHandlers(): void {
  const session = mediaSession();
  if (!session) return;
  const handlers: Array<[MediaSessionAction, MediaSessionActionHandler]> = [
    ['play', () => { resume(); }],
    ['pause', () => { pause(); }],
    ['nexttrack', () => { next(); }],
    ['previoustrack', () => { prev(); }],
    ['seekto', details => { if (details.seekTime != null) seekTo(details.seekTime); }],
  ];
  for (const [action, handler] of handlers) {
    try {
      session.setActionHandler(action, handler);
    } catch {
      // An action the platform does not support is simply not offered.
    }
  }
}

// ── Element ──────────────────────────────────────────────────────────────

// One audio element per window, whatever module instance asks: a second
// copy of this module (dev HMR, a chunk loaded under another URL) must not
// start a second element that plays on top of the first.
const AUDIO_GLOBAL_KEY = '__metadeaJukeboxAudio';
type AudioHost = { [AUDIO_GLOBAL_KEY]?: HTMLAudioElement };

function ensureAudio(): HTMLAudioElement {
  if (audio) return audio;
  const host = globalThis as unknown as AudioHost;
  const orphan = host[AUDIO_GLOBAL_KEY];
  if (orphan) {
    orphan.pause();
    orphan.removeAttribute('src');
    orphan.load();
  }
  const element = new Audio();
  host[AUDIO_GLOBAL_KEY] = element;
  element.preload = 'auto';
  element.volume = effectiveVolume(jukeboxStore.get().volume, duckFactor);
  element.addEventListener('play', () => {
    patch({ status: 'playing', error: false });
    updateMediaSessionState();
    publishPresence();
  });
  element.addEventListener('pause', () => {
    if (element.ended) return;
    patch({ status: 'paused' });
    updateMediaSessionState();
    publishPresence();
  });
  element.addEventListener('timeupdate', () => {
    patch({ time: element.currentTime, duration: Number.isFinite(element.duration) ? element.duration : 0 });
  });
  element.addEventListener('durationchange', () => {
    patch({ duration: Number.isFinite(element.duration) ? element.duration : 0 });
    publishPresence();
  });
  element.addEventListener('seeked', publishPresence);
  element.addEventListener('ratechange', publishPresence);
  element.addEventListener('ended', onEnded);
  element.addEventListener('error', () => {
    // Ignore errors from an emptied/aborted source (src removed or being
    // replaced); only a failure of the current track counts.
    if (!element.currentSrc || element.error?.code === MediaError.MEDIA_ERR_ABORTED) return;
    onLoadError();
  });
  audio = element;
  return element;
}

function onEnded(): void {
  const state = jukeboxStore.get();
  const target = nextIndex(state, 'ended');
  if (target === null) {
    patch({ status: 'paused', time: state.duration });
    updateMediaSessionState();
    dropPresence();
    return;
  }
  if (target === state.index && audio) {
    audio.currentTime = 0;
    audio.play().catch(onPlayRejected);
    return;
  }
  loadIndex(target, true);
}

// play() rejects with AbortError when a pause() or a new src interrupts
// it — a normal user action, not a broken theme. Treating it as a load
// error auto-advanced to another song.
function isPlaybackInterruption(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError';
}

function onPlayRejected(err: unknown): void {
  if (isPlaybackInterruption(err)) return;
  onLoadError();
}

function onLoadError(): void {
  const state = jukeboxStore.get();
  failureStreak += 1;
  patch({ status: 'paused', error: true });
  updateMediaSessionState();
  dropPresence();
  // Auto-advance past a broken theme, but give up once every entry failed
  // in a row.
  if (failureStreak >= state.queue.length) return;
  const target = nextIndex(state, 'ended');
  if (target !== null && target !== state.index) loadIndex(target, true);
}

// A cached local copy beats streaming; otherwise the theme's own URL, or
// the first version's. Null when nothing is playable.
async function resolveSource(theme: MediaTheme): Promise<string | null> {
  let fallback = theme.video_url;
  if (!fallback && theme.versions) {
    try {
      const parsed: unknown = JSON.parse(theme.versions);
      if (Array.isArray(parsed)) {
        const first = parsed.find((v): v is { videoUrl: string } => !!v && typeof v === 'object' && typeof (v as { videoUrl?: unknown }).videoUrl === 'string');
        if (first) fallback = first.videoUrl;
      }
    } catch {
      // malformed versions blob: the plain video_url is all there is
    }
  }
  try {
    const cached = await getThemeVideoPath(theme.external_id, theme.slug);
    if (cached) return wrapAssetUrl(cached);
  } catch {
    // cache lookup failed: stream instead
  }
  return fallback ?? null;
}

async function loadIndex(index: number, autoplay: boolean): Promise<void> {
  const element = ensureAudio();
  const entry = jukeboxStore.get().queue[index];
  if (!entry) return;
  const token = ++loadToken;
  lastPresence = null;
  patch({ index, status: autoplay ? 'loading' : 'paused', time: 0, duration: 0, error: false });
  updateMediaSessionMetadata(entry);
  updateMediaSessionState();
  savePreferences();

  const src = await resolveSource(entry.theme);
  if (token !== loadToken) return;
  if (!src) {
    onLoadError();
    return;
  }
  element.src = src;
  element.load();
  if (autoplay) {
    element.play().then(() => { failureStreak = 0; }).catch(err => {
      if (token === loadToken) onPlayRejected(err);
    });
  } else {
    patch({ status: 'paused' });
    updateMediaSessionState();
  }
}

// ── Public controls ──────────────────────────────────────────────────────

export function playAt(index: number): void {
  failureStreak = 0;
  loadIndex(index, true);
}

export function resume(): void {
  const state = jukeboxStore.get();
  if (state.index === null) {
    const first = nextIndex(state, 'manual');
    if (first !== null) playAt(first);
    return;
  }
  const element = ensureAudio();
  if (!element.src || state.error) {
    playAt(state.index);
    return;
  }
  element.play().catch(onPlayRejected);
}

export function pause(): void {
  if (audio && !audio.paused) audio.pause();
}

export function togglePlay(): void {
  if (jukeboxStore.get().status === 'playing') pause();
  else resume();
}

export function next(): void {
  const target = nextIndex(jukeboxStore.get(), 'manual');
  if (target !== null) playAt(target);
}

export function prev(): void {
  // Like most players: early in a track, go back a track; later, restart it.
  if (audio && audio.currentTime > 3 && jukeboxStore.get().index !== null) {
    audio.currentTime = 0;
    return;
  }
  const target = prevIndex(jukeboxStore.get());
  if (target !== null) playAt(target);
}

export function seekTo(seconds: number): void {
  if (!audio || !Number.isFinite(seconds)) return;
  const duration = jukeboxStore.get().duration;
  audio.currentTime = Math.max(0, duration > 0 ? Math.min(seconds, duration) : seconds);
  patch({ time: audio.currentTime });
}

export function setVolume(volume: number): void {
  const clamped = clampVolume(volume);
  patch({ volume: clamped });
  if (audio) audio.volume = effectiveVolume(clamped, duckFactor);
  savePreferences();
}

/** Scales the playing volume by `factor` (0–1) without changing the user's
 *  volume; 1 restores it. Ambient mode ramps this for its fades. */
export function setDuckFactor(factor: number): void {
  duckFactor = Number.isFinite(factor) ? Math.min(1, Math.max(0, factor)) : 1;
  if (audio) audio.volume = effectiveVolume(jukeboxStore.get().volume, duckFactor);
}

export function toggleShuffle(): void {
  const state = jukeboxStore.get();
  jukeboxStore.set(withShuffle(state, !state.shuffle));
  savePreferences();
}

export function cycleRepeatMode(): void {
  patch({ repeat: cycleRepeat(jukeboxStore.get().repeat) });
  savePreferences();
}

export function openStrip(): void { patch({ stripOpen: true }); }
export function closeStrip(): void { patch({ stripOpen: false }); }
export function toggleStrip(): void { patch({ stripOpen: !jukeboxStore.get().stripOpen }); }

// ── Favourites ───────────────────────────────────────────────────────────

export async function refreshFavorites(): Promise<void> {
  const queue = await getFavoriteThemes();
  jukeboxStore.set(withQueue(jukeboxStore.get(), queue));
  if (jukeboxStore.get().index === null) {
    updateMediaSessionMetadata(null);
    updateMediaSessionState();
    dropPresence();
  }
}

// Optimistic: the strip updates at once, Rust confirms, then the list is
// re-read so title/cover/preview frame come from the catalog. A failed
// write restores the previous queue and propagates.
export async function toggleFavorite(theme: MediaTheme, favorite: boolean, context: FavoriteToggleContext): Promise<void> {
  const before = jukeboxStore.get();
  jukeboxStore.set(withQueue(before, applyFavoriteToggle(before.queue, theme, favorite, context)));
  try {
    await setThemeFavorite(theme.external_id, theme.slug, favorite);
  } catch (err) {
    jukeboxStore.set(withQueue(jukeboxStore.get(), before.queue));
    throw err;
  }
  await refreshFavorites();
}

export async function reorderQueue(fromIndex: number, toIndex: number): Promise<void> {
  const before = jukeboxStore.get();
  const moved = moveItem(before.queue, fromIndex, toIndex);
  if (!moved) return;
  jukeboxStore.set(withQueue(before, moved));
  try {
    await reorderFavoriteThemes(toFavoriteKeys(moved));
  } catch (err) {
    jukeboxStore.set(withQueue(jukeboxStore.get(), before.queue));
    throw err;
  }
}

// ── Yield to other players ───────────────────────────────────────────────

function syncOverlayState(): void {
  if (typeof document === 'undefined') return;
  const active = !!document.querySelector(THEME_OVERLAY_SELECTOR);
  if (active !== jukeboxStore.get().overlayActive) patch({ overlayActive: active });
  if (active) pause();
}

// ThemePlayerOverlay portals straight into <body>, and Astro's router
// replaces the body element on every navigation, so the observer is
// re-armed after each swap.
function observeThemeOverlay(): void {
  if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return;
  overlayObserver?.disconnect();
  overlayObserver = new MutationObserver(syncOverlayState);
  overlayObserver.observe(document.body, { childList: true });
  syncOverlayState();
}

function installYieldRules(): void {
  playerModalStore.subscribe(() => {
    if (playerModalStore.get()) pause();
  });
  let previous = playbackStore.get();
  playbackStore.subscribe(() => {
    const current = playbackStore.get();
    const started = !!current && current.status === 'playing' && (!previous || previous.status !== 'playing');
    previous = current;
    if (started) pause();
  });
  // Any other unmuted media element starting (the theme overlay's <video>,
  // an embedded trailer...) pauses the jukebox. Hover previews are muted
  // and so never trigger this.
  document.addEventListener('play', event => {
    const target = event.target;
    if (target instanceof HTMLMediaElement && target !== audio && !target.muted) pause();
  }, true);
  document.addEventListener('astro:after-swap', observeThemeOverlay);
  observeThemeOverlay();
}

// ── Boot ─────────────────────────────────────────────────────────────────

// Idempotent: the island calls it on every mount, the work happens once
// per app session. Restores preferences, loads the favourites and points
// at the last theme without playing it.
export async function initJukebox(): Promise<void> {
  if (initialized || typeof window === 'undefined') return;
  initialized = true;
  const prefs = readJukeboxPreferences();
  jukeboxStore.set(withShuffle({ ...jukeboxStore.get(), volume: prefs.volume, repeat: prefs.repeat }, prefs.shuffle));
  ensureAudio().volume = effectiveVolume(prefs.volume, duckFactor);
  installMediaSessionHandlers();
  installYieldRules();
  try {
    await refreshFavorites();
  } catch (err) {
    console.error('[Jukebox] Failed to load favourites', err);
    return;
  }
  const state = jukeboxStore.get();
  const restored = findQueueIndex(state.queue, prefs.lastKey);
  if (restored !== null && state.index === null) {
    patch({ index: restored, status: 'paused' });
    updateMediaSessionMetadata(state.queue[restored]);
  }
}
