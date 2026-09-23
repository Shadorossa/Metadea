// Single global "what's playing right now" store — the one source of truth
// behind both the app-wide NowPlayingBar (mounted once in BaseLayout, so it
// survives Astro page transitions since it's outside <slot />) and whichever
// LocalMediaDetailPanel happens to be open. Playback used to live entirely
// inside LocalMediaDetailPanel's own component state, which meant it reset
// to nothing the instant you navigated away or even just closed the panel —
// this moves ownership up to a module-level singleton (survives navigation
// the same way any other imported module's state does under Astro's
// ClientRouter, which swaps DOM without tearing down the JS module graph)
// that keeps polling VLC and saving progress regardless of what's mounted.
//
// Two engines sit behind the same API: the built-in libmpv player
// (`internal`, default — progress arrives as `player://*` events, no
// polling) and VLC (`vlc`, the original HTTP-polling path, kept verbatim as
// the fallback when libmpv is not installed or the user prefers VLC).
import {
  saveLibraryEntry, saveEpisodeHistoryEntry, addSequelToPlanning, getEpisodeHistory, deleteEpisodeHistoryEntry, deleteLibraryEntry,
  type LibraryEntry,
} from '../tauri';
import { getResumePosition, saveResumePosition, clearResumePosition } from '../tauri/resume-position';
import { playFileWithVlc, getVlcPlaybackStatus, sendVlcCommand, type VlcPlaybackStatus } from '../tauri/anime-local';
import {
  playerEngineAvailable, playerOpen, playerSetPause, playerNext, playerStopClose, playerGetStatus,
  listenPlayerStatus, listenPlayerTrackChanged, listenPlayerEnded, showEpisodeWatchedToast, listenToastAction,
} from '../tauri/player';
import { undoEpisodeMark, type EpisodeMarkSnapshot } from './episode-undo';
import type { PlayerEnded, PlayerStatus } from '../player/player-status';
import { buildPresenceSnapshot, shouldResendPresence, type PresenceSnapshot } from '../player/presence-sync';
import { getControlsMode, getPlaybackEngine, type PlaybackEngine } from '../player/player-settings';
import { closePlayerModal, openPlayerModal } from '../player/player-modal-state';
import {
  AUTO_MARK_THRESHOLD, hasReachedWatchedThreshold, indicesToMarkOnAdvance, positionFraction, shouldPersistResumePosition,
} from '../player/progress-rules';
import { isSameFile } from '../player/queue';
import { showToast } from '../dom/toast';
import { getT } from '../../i18n/runtime';
import { syncToAniList, isAniListType } from '../media/anilist-sync';
import { toMediumCover } from '../media/small-cover';
import { setPlaybackPresence, clearPlaybackPresence } from './discord-presence';
import { createExternalStore } from '../shared/state/external-store';

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
  engine:        PlaybackEngine;
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

// The 80 % "watched" rule itself lives in lib/player/progress-rules.ts
// (shared with the built-in player); AUTO_MARK_THRESHOLD is re-imported
// here for the VLC path below.
const POLL_INTERVAL_MS = 3000;
// A sharp `time` drop while still `playing` — required, unconditionally, for
// ANY track-boundary detection below. This is what makes detection
// self-limiting: once a boundary fires, lastKnownTime resets near 0, so the
// very next tick's real (small) time can't be "less than lastKnownTime - 10"
// again until playback has actually advanced close to a real boundary once
// more. Without this gate, comparing VLC's reported filename alone against
// what we expect turned out to be exactly this fragile: the moment it
// mismatched for ANY reason (encoding, casing, a VLC build that formats it
// differently), it mismatched on every single poll tick forever, racing
// through the entire queue in seconds and marking every episode watched —
// a real regression this app shipped, not a hypothetical. A missed
// detection now just means one episode doesn't auto-mark (recoverable
// manually); it can never again mass-complete a whole season on its own.
const TRACK_BOUNDARY_DROP_SECONDS = 10;
// Same self-limiting spirit as TRACK_BOUNDARY_DROP_SECONDS, applied to how
// far a single tick's boundary detection is allowed to cascade-mark
// episodes watched. VLC's single-instance mode silently forwards a new
// "Reproducir" onto whatever VLC window is already open instead of actually
// launching this app's own controlled instance (see playFileWithVlc's own
// comment) — if that pre-existing window still had a much later episode of
// the same show loaded from an earlier session, status.filename can match
// far ahead in the current queue on the very first tick, and without a cap
// here every episode in between gets marked watched at once.
//
// The cap itself is grounded in real elapsed wall-clock time, not a fixed
// count: actually watching N episodes takes real minutes per episode no
// matter what queue/filename VLC reports, so however much time has
// genuinely passed since the last episode was marked is a hard ceiling on
// how many *could* have legitimately finished since then. 60s/episode is
// deliberately far below any real episode's runtime — it only exists to
// reject "5 episodes finished in the same 3-second poll tick" outright,
// never to slow down a real catch-up after the app was actually away for a
// while (laptop sleep, minimized for hours, ...), which this still allows
// in full once enough time has genuinely elapsed.
const MIN_MS_PER_EPISODE = 60_000;

function fileBasename(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

// True once VLC has moved on from `current` to some other file in the
// queue. The time-drop gate above is mandatory; filename (when VLC's status
// reports one) or duration is only the disambiguator for "is this actually
// a different file, or did the user just rewind to the start of this one" —
// never the sole signal.
function detectTrackBoundary(status: VlcPlaybackStatus, current: PlaybackQueueItem, knownLength: number): boolean {
  if (!(status.time < lastKnownTime - TRACK_BOUNDARY_DROP_SECONDS)) return false;
  if (status.filename) {
    return status.filename !== fileBasename(current.filePath);
  }
  // VLC's status can transiently report length as 0 (or otherwise bogus)
  // right after a seek or a pause/resume — exactly what scrubbing around to
  // grab a screenshot looks like — which used to read as "different file,
  // different duration" and misfire a track-boundary advance for a seek
  // that never actually left the current episode. A real length comparison
  // only means anything once both readings are plausible durations.
  if (status.length <= 0 || knownLength <= 0) return false;
  return Math.abs(status.length - knownLength) > 2;
}

// The reactive (subscribe/useSyncExternalStore) half of this module's
// pub/sub — internal code below still reads/writes the plain `state`
// variable directly everywhere, same as before; the store only mirrors it
// at each point `notify()` already ran, which is exactly the same set of
// points external subscribers previously learned about a change at.
export const playbackStore = createExternalStore<PlaybackState | null>(null);

let state: PlaybackState | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;
// Mirrors of per-session state pollTick needs across ticks — reset whenever
// the active episode changes (queue advance or a fresh startQueuePlayback).
let lastKnownTime = 0;
let markedEpisode: number | null = null;
// What Discord last got - see lib/player/presence-sync.ts for when a new
// snapshot is different enough to send again.
let lastPresence: PresenceSnapshot | null = null;
// Screenshot-style label per queue entry (S01E02 / M01), computed once per
// session in startQueuePlayback and reused for Discord's episode line.
let sessionEpisodeLabels: string[] = [];
// Wall-clock time (Date.now(), not video position) of the last episode
// actually marked watched — see MIN_MS_PER_EPISODE's own comment. Seeded on
// every fresh startQueuePlayback so the very first episode's own real
// runtime counts against the cap too, not just episodes after the first.
let lastMarkedAt = 0;
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
// this module's in-memory `state` even though VLC itself (a separate
// process) is still actually playing, which is what made the NowPlayingBar
// (and the "reproduciendo" indicator) vanish on refresh despite playback
// continuing underneath it. sessionStorage (not localStorage): scoped to
// this tab's lifetime, same as never persisting across a real app restart —
// there's no VLC session left to reattach to by then anyway.
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
  lastMarkedAt = Date.now();

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
  const finishing = totalCount != null && totalCount > 0 && episodeNumber >= totalCount;
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
    // Don't block the next poll tick from retrying on a transient save error.
    markedEpisode = null;
    console.error('Failed to auto-mark episode watched', err);
  }
}

function stopPolling() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}

// Sends a presence only when it materially changed: status flips go out
// at once (the engine's state changes are urgent, unthrottled events), a
// duration that becomes known or a real drift of the timestamps re-sends,
// tick jitter does not. Timestamps are only ever sent with a known
// duration (mpv reports 0 until the demuxer knows - that used to freeze
// Discord at 00:00). `speed` stretches the remaining time (mpv only; VLC
// callers leave it at 1).
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
  stopPolling();
  endedSignal = null;
  lastPresence = null;
  clearPlaybackPresence();
  setState(null);
}

async function pollTick(): Promise<void> {
  if (!state) { stopPolling(); return; }
  const current = state.queue[state.queueIndex];
  if (!current) { finishSession(); return; }

  const status = await getVlcPlaybackStatus().catch(() => null);
  if (!state) return; // stopped/changed while the request was in flight

  if (!status || (status.state !== 'playing' && status.state !== 'paused')) {
    // VLC stopped responding (closed) or moved to "stopped"/ended — this is
    // exactly the tick that would observe "episode finished", so it can't
    // just bail without checking: use the last known time/length, since a
    // "stopped" status often no longer reports a meaningful position.
    if (state.length > 0 && (lastKnownTime / state.length) >= AUTO_MARK_THRESHOLD) {
      await markEpisodeWatched(current.episodeNumber);
    }
    finishSession();
    return;
  }

  if (detectTrackBoundary(status, current, state.length)) {
    // VLC moved on to some other file in the queue on its own. Searches
    // forward for exactly which one instead of just assuming +1 — a missed
    // poll tick (very short episodes, a slow tick) could mean VLC is
    // actually two or more files ahead of where we last knew, in which case
    // every episode in between also finished and gets marked too, not just
    // the one active on the previous tick.
    const queue = state.queue;
    const fromIndex = state.queueIndex;
    const matchIndex = status.filename
      ? queue.findIndex((q, i) => i > fromIndex && fileBasename(q.filePath) === status.filename)
      : -1;
    const uncappedNext = matchIndex !== -1 ? matchIndex : fromIndex + 1;
    // However many episodes real time actually allows for since the last
    // one was marked, at minimum 1 — a genuinely missed tick or two still
    // catches up in full once that much time has passed for real.
    const maxPlausible = Math.max(1, Math.floor((Date.now() - lastMarkedAt) / MIN_MS_PER_EPISODE));
    const nextIndex = Math.min(uncappedNext, fromIndex + maxPlausible);
    for (let i = fromIndex; i < nextIndex && i < queue.length; i++) {
      await markEpisodeWatched(queue[i].episodeNumber);
    }
    if (!state || nextIndex >= queue.length) { finishSession(); return; }
    lastKnownTime = 0;
    markedEpisode = null;
    setState({ ...state, queueIndex: nextIndex, status: 'playing', position: 0, time: 0, length: 0 });
    return; // next tick reads the new file's real values
  }

  lastKnownTime = status.time;

  // Keeps the resume point fresh while it's still worth resuming from — no
  // point persisting it once we're about to auto-mark this episode watched
  // anyway (markEpisodeWatched clears it right after).
  if (status.position < AUTO_MARK_THRESHOLD) {
    saveResumePosition(state.externalId, current.episodeNumber, status.time).catch(() => {});
  }

  updateDiscordForTick(current.episodeNumber, status.state as PlaybackStatus, status.time, status.length);
  setState({ ...state, status: status.state as PlaybackStatus, position: status.position, time: status.time, length: status.length });

  if (status.position >= AUTO_MARK_THRESHOLD) {
    markEpisodeWatched(current.episodeNumber);
  }
}

function ensurePolling() {
  if (pollTimer) return;
  pollTimer = setInterval(() => { pollTick().catch(() => {}); }, POLL_INTERVAL_MS);
}

// ── Built-in player (libmpv) event path ─────────────────────────────────────
// Mirrors pollTick's decisions, fed by `player://*` events instead of a
// timer. The engine reports the exact playlist index, so track changes need
// no filename/time heuristics; the 80 % rule and the cascade-mark on a
// multi-file jump are the same shared progress-rules.

let internalListening: Promise<void> | null = null;

function handleInternalIndexChange(newIndex: number) {
  if (!state || state.engine !== 'internal') return;
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
  if (!state || state.engine !== 'internal') return;
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
  if (!state || state.engine !== 'internal') return;
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
// internal session is active, so nothing needs tearing down.
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

// `internal` unless the user picked VLC or libmpv cannot be loaded — the
// latter is announced once per attempt so a missing DLL is never silent.
async function resolvePlaybackEngine(): Promise<PlaybackEngine> {
  if (getPlaybackEngine() === 'vlc') return 'vlc';
  if (await playerEngineAvailable()) return 'internal';
  showToast(getT().player.engine_unavailable_fallback, { backgroundColor: 'var(--color-gold)', durationMs: 6000 });
  return 'vlc';
}

export async function startQueuePlayback(target: StartPlaybackTarget): Promise<void> {
  if (target.queue.length === 0) return;
  const first = target.queue[0];
  // Resumes from wherever VLC's position was last saved for this exact
  // episode instead of always starting at 0 — survives fully closing VLC,
  // since it's read from the DB, not in-memory state.
  const resumeSeconds = await getResumePosition(target.externalId, first.episodeNumber).catch(() => null);

  lastKnownTime = 0;
  markedEpisode = null;
  lastPresence = null;
  lastMarkedAt = Date.now();

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

  const engine = await resolvePlaybackEngine();
  const baseState = {
    externalId: target.externalId, type: target.type, title: target.title, cover: target.cover,
    libraryEntry: target.libraryEntry, totalCount: target.totalCount,
    queue: target.queue, queueIndex: 0, status: 'playing' as const, position: 0, time: 0, length: 0,
  };

  if (engine === 'internal') {
    await ensureInternalListeners();
    await playerOpen({
      queue: target.queue.map(q => q.filePath),
      startIndex: 0,
      startSeconds: resumeSeconds ?? null,
      workName: target.title,
      episodeLabels: screenshotEpisodeLabels,
      titles: target.queue.map(q => q.episodeTitle ?? ''),
      externalId: target.externalId,
      episodeNumbers: target.queue.map(q => q.episodeNumber),
      overlay: getControlsMode() === 'overlay',
    });
    setState({ ...baseState, engine: 'internal' });
    // The player is a modal over the current page (like the comic reader),
    // rendered by NowPlayingBar while this store says so; closing it stops
    // the engine (PlayerStage), which in turn ends the session here.
    openPlayerModal();
    return;
  }

  await playFileWithVlc(
    target.queue.map(q => q.filePath),
    resumeSeconds ?? undefined,
    target.title,
    screenshotEpisodeLabels,
  );

  setState({ ...baseState, engine: 'vlc' });
  ensurePolling();
}

export function pausePlayback(): void {
  if (!state) return;
  if (state.engine === 'internal') playerSetPause(true).catch(() => {});
  else sendVlcCommand('pl_forcepause').catch(() => {});
  setState({ ...state, status: 'paused' });
}

export function resumePlayback(): void {
  if (!state) return;
  if (state.engine === 'internal') playerSetPause(false).catch(() => {});
  else sendVlcCommand('pl_forceresume').catch(() => {});
  setState({ ...state, status: 'playing' });
}

// Optimistic — mirrors pollTick's own track-boundary branch so the UI
// doesn't wait out a full poll interval to reflect the skip. The next real
// tick just confirms VLC's actual (by-then-matching) status.
export function skipToNext(): void {
  if (!state || state.queueIndex >= state.queue.length - 1) return;
  const current = state.queue[state.queueIndex];
  if (state.engine === 'internal') playerNext().catch(() => {});
  else sendVlcCommand('pl_next').catch(() => {});
  if (state.length > 0 && (lastKnownTime / state.length) >= AUTO_MARK_THRESHOLD) {
    markEpisodeWatched(current.episodeNumber).catch(() => {});
  }
  lastKnownTime = 0;
  markedEpisode = null;
  setState({ ...state, queueIndex: state.queueIndex + 1, status: 'playing', position: 0, time: 0, length: 0 });
}

export function stopPlayback(): void {
  if (!state) return;
  if (state.engine === 'internal') {
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
    return;
  }
  const current = state.queue[state.queueIndex];
  if (current) persistStopPosition(current.episodeNumber, lastKnownTime, state.length);
  sendVlcCommand('pl_stop').catch(() => {});
  finishSession();
}

// Runs once, at module load (client-side only — Astro's server pass never
// gets here) — rehydrates `state` from whatever was persisted right before
// the page reloaded, but only if VLC itself confirms it's still actually
// playing that same file. Restoring blind (or on VLC being closed/moved on
// to something else in the meantime) would show a "reproduciendo" bar for a
// session that no longer exists — the whole point is showing reality, not a
// stale guess dressed up as one.
async function restorePersistedSession(): Promise<void> {
  let saved: PlaybackState | null = null;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (raw) saved = JSON.parse(raw);
  } catch { /* sessionStorage unavailable */ }
  if (!saved) return;

  const current = saved.queue[saved.queueIndex];
  if (!current) { persistState(null); return; }

  if (saved.engine === 'internal') {
    // The built-in player lives in the same process, so its status is the
    // authority on whether this session is still real.
    const status = await playerGetStatus();
    const alive = !!status && status.state !== 'idle' && isSameFile(status.path, current.filePath);
    if (!alive) { persistState(null); return; }
    lastKnownTime = status.position_secs;
    lastMarkedAt = Date.now();
    state = {
      ...saved,
      status: status.state === 'paused' ? 'paused' : 'playing',
      position: positionFraction(status.position_secs, status.duration_secs),
      time: status.position_secs,
      length: status.duration_secs,
    };
    notify();
    await ensureInternalListeners();
    return;
  }

  const status = await getVlcPlaybackStatus().catch(() => null);
  const stillSameFile = !!status
    && (status.state === 'playing' || status.state === 'paused')
    && (!status.filename || status.filename === fileBasename(current.filePath));
  if (!status || !stillSameFile) { persistState(null); return; }

  lastKnownTime = status.time;
  lastMarkedAt = Date.now();
  state = { ...saved, engine: saved.engine ?? 'vlc', status: status.state as PlaybackStatus, position: status.position, time: status.time, length: status.length };
  notify();
  ensurePolling();
}

restorePersistedSession();
