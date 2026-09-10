// Marks a chapter/issue/volume as read once the in-app reader (Comic
// ReaderModal) reaches its last page — the reading-type counterpart to
// playback-service.ts's markEpisodeWatched. Kept separate (not folded into
// that module) since the trigger is completely different: an exact "last
// page reached" from synchronous in-page state here, vs. VLC poll-tick
// position/track-boundary detection there — no queue, no Discord presence,
// no external process to poll.
import { saveLibraryEntry, saveEpisodeHistoryEntry, addSequelToPlanning, type LibraryEntry } from '../tauri';
import { clearReadingProgress } from '../tauri/comic-reader';
import { syncToAniList, isAniListType } from '../media/anilist-sync';

// Same three-way status-by-type split playback-service.ts uses for watching
// — 'comic' added here since it's a reading type (see READING_TYPES,
// constants/media.ts) that module's own map doesn't cover.
const START_STATUS_BY_TYPE: Record<string, string> = {
  manga: 'reading', lnovel: 'reading', book: 'reading', comic: 'reading',
};

export async function markChapterRead(
  externalId: string,
  libraryEntry: LibraryEntry,
  // Value written to library progress/history/AniList sync — normally the
  // file's own episode number, but a single-tomo edition of an otherwise
  // multi-issue series passes totalCount here instead (see
  // ComicReaderModal's isSingleTomo): finishing that one file means the
  // *whole* work is done, not just "episode 1" of it.
  progressNumber: number,
  totalCount: number | null,
  // The actual file's own episode number, for clearing its saved reading
  // position specifically — defaults to progressNumber (the normal case,
  // where they're the same number). Kept separate for the single-tomo
  // case above: the page position was saved under the file's real episode
  // number throughout the reading session, not under totalCount, so
  // clearing has to target that same key or it'd leave a stale row behind
  // and clear nothing.
  readingProgressKey: number = progressNumber,
): Promise<LibraryEntry> {
  // Same "finishing" rule as markEpisodeWatched: reaching the last
  // chapter/issue BY ACTUALLY READING IT THROUGH is what completes a work
  // here, not just progress catching up to total_count in the abstract.
  const finishing = totalCount != null && totalCount > 0 && progressNumber >= totalCount;
  const nextStatus = finishing
    ? 'completed'
    : libraryEntry.status === 'planning'
    ? (START_STATUS_BY_TYPE[libraryEntry.type] ?? libraryEntry.status)
    : libraryEntry.status;
  const today = new Date().toISOString().slice(0, 10);
  const startedAt = libraryEntry.started_at ?? today;
  const finishedAt = finishing ? today : libraryEntry.finished_at;

  const isManga = libraryEntry.type === 'manga';
  const saved = await saveLibraryEntry({
    ...libraryEntry,
    progress: isManga ? (libraryEntry.progress ?? 0) : progressNumber,
    progress_2: isManga ? progressNumber : (libraryEntry.progress_2 ?? 0),
    status: nextStatus,
    started_at: startedAt,
    finished_at: finishedAt,
  });

  saveEpisodeHistoryEntry(externalId, progressNumber).catch(err => console.error('Failed to save reading history', err));
  clearReadingProgress(externalId, readingProgressKey).catch(() => {});
  if (finishing) {
    addSequelToPlanning(externalId).catch(err => console.error('Failed to auto-add sequel to planning:', err));
  }
  if (isAniListType(libraryEntry.type)) {
    syncToAniList({
      externalId, type: libraryEntry.type, status: nextStatus ?? '',
      rating: libraryEntry.rating ?? 0,
      progress: isManga ? (libraryEntry.progress ?? 0) : progressNumber,
      progressVolumes: isManga ? progressNumber : (libraryEntry.progress_2 ?? 0),
      startedAt: startedAt ?? '', finishedAt: finishedAt ?? '',
      notes: libraryEntry.notes ?? '',
    }).catch(err => console.error('Failed to sync read chapter to AniList:', err));
  }
  // Same event playback-service.ts's markEpisodeWatched dispatches —
  // LocalMediaDetailPanel already listens for it to refetch history and
  // refresh the parent grid, no separate wiring needed for reading.
  window.dispatchEvent(new CustomEvent('metadea:episode-marked', { detail: { externalId, episodeNumber: progressNumber } }));
  return saved;
}
