// Global "now reading" stand-by state -- the reading-type counterpart to
// playback-service.ts's PlaybackState. Stored at module level (survives Astro
// page transitions) so NowReadingBar can show the paused session and resume.
import { createExternalStore } from '../shared/external-store';
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

const sessionStore = createExternalStore<ReadingSessionState | null>(null);
const resumeOpenStore = createExternalStore(false);

export const subscribeReadingSession = sessionStore.subscribe;
export const getReadingSession = sessionStore.get;
export const getResumeOpen = resumeOpenStore.get;
export const useReadingSession = sessionStore.use;
export const useResumeOpen = resumeOpenStore.use;
export const setReadingSession = sessionStore.set;

export function clearReadingSession(): void {
  sessionStore.set(null);
  resumeOpenStore.set(false);
}

export function openResumeModal(): void {
  if (!sessionStore.get()) return;
  resumeOpenStore.set(true);
}

export function closeResumeModal(): void {
  resumeOpenStore.set(false);
}
