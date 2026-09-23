// Reverting an automatic "episode watched" mark from the toast's Undo
// button. Plain function over injected wrappers so the exact sequence is
// characterized in episode-undo.test.ts without Tauri.

import type { EpisodeHistoryEntry, LibraryEntry } from '../tauri/library';

export interface EpisodeMarkSnapshot {
  externalId: string;
  episodeNumber: number;
  /// The entry exactly as it was before the auto-mark saved over it.
  previousEntry: LibraryEntry;
  /// Playback position (seconds) at mark time; the mark cleared it.
  resumeSeconds: number;
  /// Sequel entry the mark created (finishing a work), if any.
  addedSequelExternalId: string | null;
  /// Whether the mark pushed the watched state to AniList.
  anilistSynced: boolean;
}

export interface AniListSyncInput {
  externalId: string;
  type: string;
  status: string;
  rating: number;
  progress: number;
  progressVolumes: number;
  startedAt: string;
  finishedAt: string;
  notes: string;
}

export interface EpisodeUndoDeps {
  saveLibraryEntry: (entry: LibraryEntry) => Promise<LibraryEntry>;
  getEpisodeHistory: (externalId: string) => Promise<EpisodeHistoryEntry[]>;
  deleteEpisodeHistoryEntry: (id: string) => Promise<void>;
  saveResumePosition: (externalId: string, episodeNumber: number, seconds: number) => Promise<void>;
  deleteLibraryEntry: (externalId: string) => Promise<void>;
  syncToAniList: (input: AniListSyncInput) => Promise<unknown>;
  dispatchEpisodeMarked: (externalId: string, episodeNumber: number) => void;
}

// The history row the mark inserted: the newest one for that episode.
export function pickHistoryRowToDelete(rows: readonly EpisodeHistoryEntry[], episodeNumber: number): EpisodeHistoryEntry | null {
  const candidates = rows.filter(row => row.episode_number === episodeNumber);
  if (candidates.length === 0) return null;
  return candidates.reduce((newest, row) => (row.watched_at > newest.watched_at ? row : newest));
}

export async function undoEpisodeMark(snapshot: EpisodeMarkSnapshot, deps: EpisodeUndoDeps): Promise<LibraryEntry> {
  const { externalId, episodeNumber, previousEntry } = snapshot;

  // 1. The library entry, exactly as before (progress, status, dates; the
  //    rating was never touched by the mark and comes back unchanged too).
  const restored = await deps.saveLibraryEntry({ ...previousEntry });

  // 2. The history row the mark inserted.
  const rows = await deps.getEpisodeHistory(externalId).catch(() => [] as EpisodeHistoryEntry[]);
  const row = pickHistoryRowToDelete(rows, episodeNumber);
  if (row) await deps.deleteEpisodeHistoryEntry(row.id);

  // 3. The resume point the mark cleared.
  if (snapshot.resumeSeconds > 0) {
    await deps.saveResumePosition(externalId, episodeNumber, snapshot.resumeSeconds);
  }

  // 4. A sequel this very mark put in "planning".
  if (snapshot.addedSequelExternalId) {
    await deps.deleteLibraryEntry(snapshot.addedSequelExternalId);
  }

  // 5. AniList, back to the restored values.
  if (snapshot.anilistSynced) {
    await deps.syncToAniList({
      externalId,
      type: restored.type,
      status: restored.status ?? '',
      rating: restored.rating ?? 0,
      progress: restored.progress ?? 0,
      progressVolumes: restored.progress_2 ?? 0,
      startedAt: restored.started_at ?? '',
      finishedAt: restored.finished_at ?? '',
      notes: restored.notes ?? '',
    }).catch(err => console.error('Failed to re-sync AniList after undo:', err));
  }

  // 6. Open panels refresh the same way they did for the mark itself.
  deps.dispatchEpisodeMarked(externalId, episodeNumber);
  return restored;
}
