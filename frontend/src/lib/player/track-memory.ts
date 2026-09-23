// Per-series memory of hand-picked audio/subtitle tracks (keyed by the
// work's external id, stored as language + title hints — never a track
// index, which changes between releases). Read by usePlayerTrackPreferences
// through lib/player/track-preferences.ts's `chooseTracks`.
//
// Also holds the "the user just cycled a track with the keyboard" flag:
// the C/A keys ask mpv to move to the next track without knowing which one
// that is, so the choice is recorded once the new selection shows up in
// the status.

import { STORAGE_KEYS } from '../storage/storage-keys';
import type { TrackHint, TrackMemory } from './track-preferences';

/** Oldest series are dropped past this many entries. */
export const TRACK_MEMORY_LIMIT = 300;

interface StoredEntry extends TrackMemory {
  updatedAt: number;
}

type StoredMemory = Record<string, StoredEntry>;

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function readAll(): StoredMemory {
  try {
    const parsed: unknown = JSON.parse(storage()?.getItem(STORAGE_KEYS.playerTrackMemory) ?? '{}');
    return parsed && typeof parsed === 'object' ? (parsed as StoredMemory) : {};
  } catch {
    return {};
  }
}

/** Keeps the newest `limit` entries. Pure, exported for tests. */
export function pruneMemory(memory: StoredMemory, limit = TRACK_MEMORY_LIMIT): StoredMemory {
  const entries = Object.entries(memory);
  if (entries.length <= limit) return memory;
  entries.sort((a, b) => (b[1].updatedAt ?? 0) - (a[1].updatedAt ?? 0));
  return Object.fromEntries(entries.slice(0, limit));
}

function writeAll(memory: StoredMemory): void {
  storage()?.setItem(STORAGE_KEYS.playerTrackMemory, JSON.stringify(pruneMemory(memory)));
}

export function getTrackMemory(externalId: string | null | undefined): TrackMemory | null {
  if (!externalId) return null;
  const entry = readAll()[externalId];
  if (!entry) return null;
  const memory: TrackMemory = {};
  if (entry.audio !== undefined) memory.audio = entry.audio;
  if (entry.sub !== undefined) memory.sub = entry.sub;
  return memory.audio === undefined && memory.sub === undefined ? null : memory;
}

/** Remembers a hand-picked track (`null` = turned off) for the series. */
export function rememberTrack(externalId: string | null | undefined, kind: 'audio' | 'sub', hint: TrackHint | null): void {
  if (!externalId) return;
  const memory = readAll();
  memory[externalId] = { ...memory[externalId], [kind]: hint, updatedAt: Date.now() };
  writeAll(memory);
}

export function forgetTrackMemory(externalId: string | null | undefined): void {
  if (!externalId) return;
  const memory = readAll();
  if (!(externalId in memory)) return;
  delete memory[externalId];
  writeAll(memory);
}

// ── Keyboard cycling (C / A) ─────────────────────────────────────────────

const pendingCycles = new Set<'audio' | 'sub'>();

export function markManualCycle(kind: 'audio' | 'sub'): void {
  pendingCycles.add(kind);
}

/** True once per cycle: the caller records the selection it now sees. */
export function takeManualCycle(kind: 'audio' | 'sub'): boolean {
  return pendingCycles.delete(kind);
}
