// Global "now reading" stand-by state -- the reading-type counterpart to
// playback-service.ts's PlaybackState. Stored at module level (survives Astro
// page transitions) so NowReadingBar can show the paused session and resume.
import { useSyncExternalStore } from 'react';
import type { LibraryEntry } from '../tauri';

export interface ReadingSessionState {
  externalId: string;
  title: string;
  cover: string | null;
  filePath: string;
  episodeNumber: number;
  totalCount: number | null;
  libraryEntry: LibraryEntry;
  isSingleTomo: boolean;
  pageCount: number;
  spreadIndex: number;
  totalSpreads: number;
}

let state: ReadingSessionState | null = null;
const listeners = new Set<() => void>();

function notify() {
  for (const cb of listeners) cb();
}

export function subscribeReadingSession(cb: () => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

export function getReadingSession(): ReadingSessionState | null {
  return state;
}

export function useReadingSession(): ReadingSessionState | null {
  return useSyncExternalStore(subscribeReadingSession, getReadingSession, () => null);
}

export function setReadingSession(next: ReadingSessionState | null): void {
  state = next;
  notify();
}

export function clearReadingSession(): void {
  setReadingSession(null);
}
