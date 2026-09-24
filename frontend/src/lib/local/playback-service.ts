// Single global "what's playing right now" store — the one source of truth
// behind both the app-wide NowPlayingBar (mounted once in BaseLayout, so it
// survives Astro page transitions since it's outside <slot />) and whichever
// LocalMediaDetailPanel happens to be open. Playback used to live entirely
// inside LocalMediaDetailPanel's own component state, which meant it reset
// to nothing the instant you navigated away or even just closed the panel —
// this moves ownership up to a module-level singleton (survives navigation
// the same way any other imported module's state does under Astro's
// ClientRouter, which swaps DOM without tearing down the JS module graph)
// that keeps tracking the built-in player and saving progress regardless of
// what's mounted. Progress arrives as `player://*` events from the libmpv
// engine (no polling).
import {
  saveLibraryEntry, saveEpisodeHistoryEntry, addSequelToPlanning, getEpisodeHistory, deleteEpisodeHistoryEntry, deleteLibraryEntry,
  type LibraryEntry,
} from '../tauri';
import { getResumePosition, saveResumePosition, clearResumePosition } from '../tauri/resume-position';
import {
  playerEngineAvailable, playerOpen, playerSetPause, playerNext, playerStopClose, playerGetStatus,
  listenPlayerStatus, listenPlayerTrackChanged, listenPlayerEnded, showEpisodeWatchedToast, listenToastAction,
} from '../tauri/player';
import { undoEpisodeMark, type EpisodeMarkSnapshot } from './episode-undo';
import { completionEpisode, isFillerEpisode, skipsFiller } from '../anime/filler';
import { getLoadedFillerInfo, loadAllFillerInfo } from '../anime/filler-store';
import type { PlayerEnded, PlayerStatus } from '../player/player-status';
import { buildPresenceSnapshot, shouldResendPresence, type PresenceSnapshot } from '../player/presence-sync';
import { getControlsMode } from '../player/player-settings';
import { closePlayerModal, openPlayerModal } from '../player/player-modal-state';
import {
  hasReachedWatchedThreshold, indicesToMarkOnAdvance, positionFraction, shouldPersistResumePosition,
} from '../player/progress-rules';
import { isSameFile } from '../player/queue';
import { getT } from '../../i18n/runtime';
import { syncToAniList, isAniListType } from '../media/anilist-sync';
import { toMediumCover } from '../media/small-cover';
import { setPlaybackPresence, clearPlaybackPresence } from './discord-presence';
import { createExternalStore } from '../shared/state/external-store';
import { emitSessionEnded } from '../plugins/host-events';

export interface PlaybackQueueItem {
  episodeNumber: number;
  filePath: string;
  seasonNumber?: number;
  episodeTitle?: string;
}

export type PlaybackStatus = 'playing' | 'paused';

export interface PlaybackState {
  externalId:    string;
  type:          string;
  title:         string;
  cover:         string | null;
  libraryEntry:  LibraryEntry;
  totalCount:    number | null;
  queue:         PlaybackQueueItem[];
  queueIndex:    number;
  status:        PlaybackStatus;
  position:      number; // 0-1, current file
  time:          number; // seconds, current file
  length:        number; // seconds, current file
}

export interface StartPlaybackTarget {
  externalId:   string;
  type:         string;
  title:        string;
  cover:        string | null;
  libraryEntry: LibraryEntry;
  totalCount:   number | null;
  queue:        PlaybackQueueItem[]; // non-empty; [0] is what gets launched
}

// Same three-way split used everywhere else in the app for what an
// in-progress status verb should read as.
const START_STATUS_BY_TYPE: Record<string, string> = {
  anime: 'watching', series: 'watching', movie: 'watching',
  manga: 'reading', lnovel: 'reading', book: 'reading',
};

// The reactive (subscribe/useSyncExternalStore) half of this module's
// pub/sub — internal code below still reads/writes the plain `state`
// variable directly everywhere, same as before; the store only mirrors it
// at each point `notify()` already ran, which is exactly the same set of
// points external subscribers previously learned about a change at.
export const playbackStore = createExternalStore<PlaybackState | null>(null);

let state: PlaybackState | null = null;
// Per-session mirrors of the engine's last report — reset whenever the
// active episode changes (queue advance or a fresh startQueuePlayback).
let lastKnownTime = 0;
let markedEpisode: number | null = null;
// What Discord last got - see lib/player/presence-sync.ts for when a new
// snapshot is different enough to send again.
let lastPresence: PresenceSnapshot | null = null;
// Screenshot-style label per queue entry (S01E02 / M01), computed once per
// session in startQueuePlayback and reused for Discord's episode line.
let sessionEpisodeLabels: string[] = [];
// The one auto-mark the native toast's Undo button can still revert (the
// toast shows a single notice at a time, so only the latest is kept). The
// token travels through the toast window and back in `toast://action`.
let pendingUndo: { token: number; snapshot: EpisodeMarkSnapshot } | null = null;
let nextUndoToken = 1;
let toastListening: Promise<void> | null = null;
// Resolved by handleInternalEnded so stopPlayback can wait for mpv's exact
// position instead of racing it with the last tick's stale one.
let endedSignal: (() => void) | null = null;
const ENDED_WAIT_MS = 1500;

function notify() {
  playbackStore.set(state);
}

// Persists just enough to rebuild the bar after an F5 — a full reload wipes
// this module's in-memory `state` even though the engine (Rust side) is
// still actually playing, which is what made the NowPlayingBar (and the
// "reproduciendo" indicator) vanish on refresh despite playback continuing
// underneath it. sessionStorage (not localStorage): scoped to this tab's
// lifetime, same as never persisting across a real app restart — there's
// no player session left to reattach to by then anyway.
const STORAGE_KEY = 'metadea_now_playing_v1';

function persistState(next: PlaybackState | null) {
  try {
    if (next) sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    else sessionStorage.removeItem(STORAGE_KEY);
  } catch { /* sessionStorage unavailable/full */ }
}

function setState(next: PlaybackState | null) {
  state = next;
  persistState(next);
  notify();
}


// React binding — any component can call this to reactively read the
// current playback state without needing its own subscribe/useEffect glue.
// NowPlayingBar renders via an Astro island (client:load), which does an
// initial SSR pass on the server, reporting "nothing playing" (the store's
// own initial value) until the client takes over and subscribes.

// Screenshot-style label (S01E02 / M01) of a queue entry for the toast and
// Discord; falls back to a bare `E02` for an episode outside the session.
function episodeLabelFor(episodeNumber: number): string {
  const index = state ? state.queue.findIndex(item => item.episodeNumber === episodeNumber) : -1;
  return (index >= 0 && sessionEpisodeLabels[index]) || `E${String(episodeNumber).padStart(2, '0')}`;
}

// Everything the mark touched, reverted in one go — see episode-undo.ts.
async function undoPendingMark(token: number): Promise<void> {
  if (!pendingUndo || pendingUndo.token !== token) return;
  const { snapshot } = pendingUndo;
  pendingUndo = null;
  try {
    const restored = await undoEpisodeMark(snapshot, {
      saveLibraryEntry,
      getEpisodeHistory,
      deleteEpisodeHistoryEntry,
      saveResumePosition,
      deleteLibraryEntry,
      syncToAniList,
      dispatchEpisodeMarked: (externalId, episodeNumber) =>
        window.dispatchEvent(new CustomEvent('metadea:episode-marked', { detail: { externalId, episodeNumber } })),
    });
    // The next mark in this session builds on the restored entry again.
    if (state && state.externalId === snapshot.externalId) {
      state = { ...state, libraryEntry: restored };
      notify();
    }
  } catch (err) {
    console.error('Failed to undo the watched mark', err);
  }
}

// One app-wide subscription to the toast window's button, for both engines.
function ensureToastListener(): Promise<void> {
  if (!toastListening) {
    toastListening = listenToastAction(action => {
      if (action.action === 'undo') undoPendingMark(action.token).catch(() => {});
    }).then(() => undefined).catch(err => {
      toastListening = null;
      console.error('Failed to subscribe to toast actions', err);
    });
  }
  return toastListening;
}

// `positionSecs` is where playback was when the mark fired — what Undo puts
// back as the resume point (the mark itself clears it).
async function markEpisodeWatched(episodeNumber: number, positionSecs = lastKnownTime): Promise<void> {
  if (!state || markedEpisode === episodeNumber) return;
  markedEpisode = episodeNumber;

  const { externalId, libraryEntry, totalCount, title } = state;
  // Read before the first await: a mark fired from the session's own end
  // (player://ended) outlives `state`, which finishSession clears at once.
  const episodeLabel = episodeLabelFor(episodeNumber);
  const snapshot: EpisodeMarkSnapshot = {
    externalId,
    episodeNumber,
    previousEntry: { ...libraryEntry },
    resumeSeconds: Math.max(0, positionSecs),
    addedSequelExternalId: null,
    anilistSynced: false,
  };
  // Reaching the last episode/chapter BY ACTUALLY PLAYING IT through the app
  // is what completes a work here — not just "progress caught up to
  // total_count" in the abstract, since that could also come from a manual
  // edit elsewhere that isn't "just finished watching."
  // An anime set to "Filler: Skipped" finishes at its last canon/mixed
  // episode (lib/anime/filler.ts); the filler map is warmed at session start.
  const completeAt = libraryEntry.type === 'anime'
    ? completionEpisode(libraryEntry, getLoadedFillerInfo(externalId), totalCount)
    : totalCount;
  const finishing = completeAt != null && completeAt > 0 && episodeNumber >= completeAt;
  const nextStatus = finishing
    ? 'completed'
    : libraryEntry.status === 'planning'
    ? (START_STATUS_BY_TYPE[libraryEntry.type] ?? libraryEntry.status)
    : libraryEntry.status;
  // Plain YYYY-MM-DD, not a full ISO datetime — started_at/finished_at feed
  // a native <input type="date"> elsewhere (MediaEditorModal), which only
  // accepts that exact format and silently renders empty (the locale's
  // "dd/mm/aaaa" placeholder) for anything else, including a real
  // timestamp string that LOOKS like a valid non-empty value everywhere
  // else in the code.
  const today = new Date().toISOString().slice(0, 10);
  const startedAt = libraryEntry.started_at ?? today;
  const finishedAt = finishing ? today : libraryEntry.finished_at;

  try {
    const saved = await saveLibraryEntry({
      ...libraryEntry,
      progress:    episodeNumber,
      status:      nextStatus,
      started_at:  startedAt,
      finished_at: finishedAt,
    });
    // Each successive episode in a queue needs the PREVIOUS one's saved
    // status/progress (e.g. planning -> watching only happens once) — this
    // is what state.libraryEntry being kept fresh here is for.
    if (state && state.externalId === externalId) {
      state = { ...state, libraryEntry: saved };
    }
    saveEpisodeHistoryEntry(externalId, episodeNumber).catch(err => console.error('Failed to save episode history', err));
    // Now watched — nothing left to resume for this one, so the next
    // "Reproducir" on it (a rewatch) starts fresh instead of picking up
    // wherever this viewing happened to end.
    clearResumePosition(externalId, episodeNumber).catch(() => {});
    // Only from actually finishing it here — see addSequelToPlanning's own
    // comment for why this doesn't live inside saveLibraryEntry itself.
    if (finishing) {
      addSequelToPlanning(externalId)
        .then(sequelId => { snapshot.addedSequelExternalId = sequelId ?? null; })
        .catch(err => console.error('Failed to auto-add sequel to planning:', err));
    }
    // MediaEditorModal's own save does this too — the auto-mark-on-watch
    // flow here saves straight to saveLibraryEntry (bypassing that modal
    // entirely), so without this an episode watched through the local
    // player updated progress in-app but never reached AniList at all.
    if (isAniListType(libraryEntry.type)) {
      snapshot.anilistSynced = true;
      syncToAniList({
        externalId, type: libraryEntry.type, status: nextStatus ?? '',
        rating: libraryEntry.rating ?? 0, progress: episodeNumber,
        progressVolumes: libraryEntry.progress_2 ?? 0,
        startedAt: startedAt ?? '', finishedAt: finishedAt ?? '',
        notes: libraryEntry.notes ?? '',
      }).catch(err => console.error('Failed to sync watched episode to AniList:', err));
    }
    // LocalMediaDetailPanel (if open on this exact item) listens for this to
    // refetch its episode-history list and tell its parent grid to refresh —
    // a plain window event instead of a callback prop, since this module has
    // no reference to whichever component(s) happen to be mounted right now.
    window.dispatchEvent(new CustomEvent('metadea:episode-marked', { detail: { externalId, episodeNumber } }));
    // The native "marked as watched · Undo" toast (toast_window.rs) — the
    // same always-on-top window as the F12 capture notice, so it is seen
    // over the video whichever engine is playing.
    const token = nextUndoToken++;
    pendingUndo = { token, snapshot };
    await ensureToastListener();
    showEpisodeWatchedToast(title, episodeLabel, token)
      .catch(err => console.error('Failed to show the watched toast', err));
  } catch (err) {
    // Don't block the next status tick from retrying on a transient save error.
    markedEpisode = null;
    console.error('Failed to auto-mark episode watched', err);
  }
}

// Sends a presence only when it materially changed: status flips go out
// at once (the engine's state changes are urgent, unthrottled events), a
// duration that becomes known or a real drift of the timestamps re-sends,
// tick jitter does not. Timestamps are only ever sent with a known
// duration (mpv reports 0 until the demuxer knows - that used to freeze
// Discord at 00:00). `speed` stretches the remaining time.
function updateDiscordForTick(episodeNumber: number, statusState: PlaybackStatus, time: number, length: number, speed = 1) {
  if (!state) return;
  const coverUrl = state.cover && state.cover.startsWith('http') ? toMediumCover(state.cover) : undefined;
  const next = buildPresenceSnapshot(statusState, Math.floor(Date.now() / 1000), time, length, speed);
  if (!shouldResendPresence(lastPresence, next)) return;
  lastPresence = next;
  const queueIndex = state.queue.findIndex(item => item.episodeNumber === episodeNumber);
  const item = queueIndex >= 0 ? state.queue[queueIndex] : undefined;
  setPlaybackPresence({
    title: state.title,
    externalId: state.externalId,
    episodeNumber,
    episodeLabel: queueIndex >= 0 ? sessionEpisodeLabels[queueIndex] : undefined,
    episodeTitle: item?.episodeTitle,
    status: next.status,
    startTime: next.startTime,
    endTime: next.endTime,
    coverUrl,
    share: state.externalId ? { externalId: state.externalId, title: state.title, coverUrl: state.cover } : undefined,
  });
}

// Resume point when a session ends at `time` of `length` (seconds): past
// the watched threshold the episode is marked (which clears the resume
// point); before it, the exact position is kept for the next "Reproducir".
function persistStopPosition(episodeNumber: number, time: number, length: number) {
  if (!state) return;
  if (hasReachedWatchedThreshold(time, length)) {
    markEpisodeWatched(episodeNumber, time).catch(() => {});
  } else if (time > 0) {
    saveResumePosition(state.externalId, episodeNumber, time).catch(() => {});
  }
}

function finishSession() {
  if (state) emitSessionEnded({ externalId: state.externalId, kind: 'watch' });
  endedSignal = null;
  lastPresence = null;
  clearPlaybackPresence();
  setState(null);
}

// ── Built-in player (libmpv) event path ─────────────────────────────────────
// Fed by `player://*` events. The engine reports the exact playlist index,
// so track changes need no filename/time heuristics; the 80 % rule and the
// cascade-mark on a multi-file jump live in lib/player/progress-rules.ts.

let internalListening: Promise<void> | null = null;

function handleInternalIndexChange(newIndex: number) {
  if (!state) return;
  if (newIndex === state.queueIndex) return;
  const fromIndex = state.queueIndex;
  const reached = hasReachedWatchedThreshold(lastKnownTime, state.length);
  for (const index of indicesToMarkOnAdvance(fromIndex, newIndex, reached)) {
    const item = state.queue[index];
    if (item) markEpisodeWatched(item.episodeNumber).catch(() => {});
  }
  if (!state || newIndex < 0 || newIndex >= state.queue.length) { finishSession(); return; }
  lastKnownTime = 0;
  markedEpisode = null;
  setState({ ...state, queueIndex: newIndex, status: 'playing', position: 0, time: 0, length: 0 });
}

function handleInternalStatus(status: PlayerStatus) {
  if (!state) return;
  if (status.state === 'idle') return; // nothing loaded yet
  if (status.playlist_index >= 0 && status.playlist_index !== state.queueIndex) {
    handleInternalIndexChange(status.playlist_index);
    if (!state) return;
  }
  const current = state.queue[state.queueIndex];
  if (!current) { finishSession(); return; }

  const time = status.position_secs;
  const length = status.duration_secs;
  lastKnownTime = time;

  if (status.state === 'ended') {
    // keep-open=yes: only the LAST queued file reports "ended" (earlier
    // ones auto-advance), so this is the queue finishing.
    if (hasReachedWatchedThreshold(time, length)) markEpisodeWatched(current.episodeNumber, time).catch(() => {});
    finishSession();
    return;
  }

  if (shouldPersistResumePosition(time, length)) {
    saveResumePosition(state.externalId, current.episodeNumber, time).catch(() => {});
  }
  const uiStatus: PlaybackStatus = status.state === 'paused' ? 'paused' : 'playing';
  updateDiscordForTick(current.episodeNumber, uiStatus, time, length, status.speed);
  setState({ ...state, status: uiStatus, position: positionFraction(time, length), time, length });
  if (hasReachedWatchedThreshold(time, length)) {
    markEpisodeWatched(current.episodeNumber, time);
  }
}

function handleInternalEnded(ended: PlayerEnded) {
  closePlayerModal();
  endedSignal?.();
  endedSignal = null;
  if (!state) return;
  // The payload carries mpv's own final position (the throttled ticks may
  // be a quarter second stale) and which queue entry it belonged to.
  const index = ended.playlist_index >= 0 && ended.playlist_index < state.queue.length ? ended.playlist_index : state.queueIndex;
  const current = state.queue[index];
  if (current) {
    const length = ended.duration_secs > 0 ? ended.duration_secs : state.length;
    persistStopPosition(current.episodeNumber, ended.position_secs, length);
  }
  finishSession();
}

// Registered once per page load; the handlers ignore events whenever no
// session is active, so nothing needs tearing down.
function ensureInternalListeners(): Promise<void> {
  if (!internalListening) {
    internalListening = Promise.all([
      listenPlayerStatus(handleInternalStatus),
      listenPlayerTrackChanged(change => handleInternalIndexChange(change.index)),
      listenPlayerEnded(handleInternalEnded),
    ]).then(() => undefined).catch(err => {
      internalListening = null;
      console.error('Failed to subscribe to player events', err);
    });
  }
  return internalListening;
}

// The built-in player is the only engine: a missing libmpv rejects the
// launch with a translated message (shown by the caller) instead of failing
// silently. An old stored "engine = vlc" preference is never read.
async function ensureEngineAvailable(): Promise<void> {
  if (await playerEngineAvailable()) return;
  throw new Error(getT().player.engine_unavailable);
}

export async function startQueuePlayback(target: StartPlaybackTarget): Promise<void> {
  if (target.queue.length === 0) return;
  await ensureEngineAvailable();
  const first = target.queue[0];
  // Resumes from wherever the player's position was last saved for this
  // exact episode instead of always starting at 0 — survives fully closing
  // the player, since it's read from the DB, not in-memory state.
  const resumeSeconds = await getResumePosition(target.externalId, first.episodeNumber).catch(() => null);

  lastKnownTime = 0;
  markedEpisode = null;
  lastPresence = null;

  const pad = (value: number) => String(value).padStart(2, '0');
  const seriesEpisodeLabels = target.type === 'series'
    ? await import('../media/episodes/episode-list')
      .then(({ fetchLocalSeriesEpisodeLabels }) => fetchLocalSeriesEpisodeLabels(target.externalId))
      .catch(() => new Map<number, string>())
    : new Map<number, string>();
  const screenshotEpisodeLabels = target.queue.map(item => {
    if (target.type === 'movie') return `M${pad(item.episodeNumber)}`;
    const seriesLabel = seriesEpisodeLabels.get(item.episodeNumber);
    if (seriesLabel) return seriesLabel;
    if (target.type === 'series') {
      const filenameLabel = item.filePath.split(/[\\/]/).pop()?.match(/\bS\d{2}E\d{2}\b/i)?.[0];
      if (filenameLabel) return filenameLabel.toUpperCase();
    }
    return `S${pad(item.seasonNumber ?? 1)}E${pad(item.episodeNumber)}`;
  });

  sessionEpisodeLabels = screenshotEpisodeLabels;

  void loadAllFillerInfo();
  const baseState = {
    externalId: target.externalId, type: target.type, title: target.title, cover: target.cover,
    libraryEntry: target.libraryEntry, totalCount: target.totalCount,
    queue: target.queue, queueIndex: 0, status: 'playing' as const, position: 0, time: 0, length: 0,
  };

  await ensureInternalListeners();
  // "Filler: Skipped": the controls window has no filler store, so it gets
  // the queue's filler episodes and offers the next canon one instead of
  // rolling into them (lib/player/filler-next.ts).
  const fillerInfo = (await loadAllFillerInfo()).get(target.externalId);
  const fillerEpisodes = skipsFiller(target.libraryEntry, fillerInfo, target.totalCount)
    ? target.queue.map(q => q.episodeNumber).filter(episode => isFillerEpisode(fillerInfo, episode))
    : [];
  await playerOpen({
    queue: target.queue.map(q => q.filePath),
    startIndex: 0,
    startSeconds: resumeSeconds ?? null,
    workName: target.title,
    episodeLabels: screenshotEpisodeLabels,
    titles: target.queue.map(q => q.episodeTitle ?? ''),
    externalId: target.externalId,
    episodeNumbers: target.queue.map(q => q.episodeNumber),
    fillerEpisodes,
    overlay: getControlsMode() === 'overlay',
  });
  setState(baseState);
  // The player is a modal over the current page (like the comic reader),
  // rendered by NowPlayingBar while this store says so; closing it stops
  // the engine (PlayerStage), which in turn ends the session here.
  openPlayerModal();
}

export function pausePlayback(): void {
  if (!state) return;
  playerSetPause(true).catch(() => {});
  setState({ ...state, status: 'paused' });
}

export function resumePlayback(): void {
  if (!state) return;
  playerSetPause(false).catch(() => {});
  setState({ ...state, status: 'playing' });
}

// Optimistic — mirrors handleInternalIndexChange so the UI doesn't wait for
// the engine's next report to reflect the skip; that report then just
// confirms the (by-then-matching) index.
export function skipToNext(): void {
  if (!state || state.queueIndex >= state.queue.length - 1) return;
  const current = state.queue[state.queueIndex];
  playerNext().catch(() => {});
  if (hasReachedWatchedThreshold(lastKnownTime, state.length)) {
    markEpisodeWatched(current.episodeNumber).catch(() => {});
  }
  lastKnownTime = 0;
  markedEpisode = null;
  setState({ ...state, queueIndex: state.queueIndex + 1, status: 'playing', position: 0, time: 0, length: 0 });
}

export function stopPlayback(): void {
  if (!state) return;
  // Teardown answers with `player://ended` carrying mpv's exact position;
  // handleInternalEnded persists it and finishes the session. The event
  // and the invoke's own resolution arrive over separate IPC paths, so
  // the fallback (what the last tick knew) only runs once the event has
  // had a fair chance to land — i.e. the engine was already gone.
  closePlayerModal();
  const ended = new Promise<void>(resolve => { endedSignal = resolve; });
  const timeout = new Promise<void>(resolve => { setTimeout(resolve, ENDED_WAIT_MS); });
  playerStopClose('stopped')
    .catch(() => {})
    .then(() => Promise.race([ended, timeout]))
    .then(() => {
      if (!state) return;
      const current = state.queue[state.queueIndex];
      if (current) persistStopPosition(current.episodeNumber, lastKnownTime, state.length);
      finishSession();
    });
}

// Runs once, at module load (client-side only — Astro's server pass never
// gets here) — rehydrates `state` from whatever was persisted right before
// the page reloaded, but only if the engine itself confirms it's still
// actually playing that same file. Restoring blind (or on the player being
// closed/moved on to something else in the meantime) would show a
// "reproduciendo" bar for a session that no longer exists — the whole point
// is showing reality, not a stale guess dressed up as one.
async function restorePersistedSession(): Promise<void> {
  let saved: PlaybackState | null = null;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (raw) saved = JSON.parse(raw);
  } catch { /* sessionStorage unavailable */ }
  if (!saved) return;

  // A session saved by an older build that played through external VLC
  // (`engine: 'vlc'`) has nothing left to reattach to; the field itself is
  // dropped either way.
  const { engine: legacyEngine, ...session } = saved as PlaybackState & { engine?: string };
  const current = session.queue?.[session.queueIndex];
  if (legacyEngine === 'vlc' || !current) { persistState(null); return; }

  // The built-in player lives in the same process, so its status is the
  // authority on whether this session is still real.
  const status = await playerGetStatus();
  const alive = !!status && status.state !== 'idle' && isSameFile(status.path, current.filePath);
  if (!alive) { persistState(null); return; }
  lastKnownTime = status.position_secs;
  state = {
    ...session,
    status: status.state === 'paused' ? 'paused' : 'playing',
    position: positionFraction(status.position_secs, status.duration_secs),
    time: status.position_secs,
    length: status.duration_secs,
  };
  notify();
  await ensureInternalListeners();
}

restorePersistedSession();
