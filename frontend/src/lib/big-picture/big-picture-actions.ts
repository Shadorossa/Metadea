// The quick library edits Big Picture's X menu offers, through the same
// persistence the media page's own quick edits use (saveLibraryEntry, which
// broadcasts 'refresh-profile-library' so Local refetches, plus the
// favourites list / AniList sync). Writes propagate their errors.
import { saveLibraryEntry, type LibraryEntry } from '../tauri/library';
import { syncFavorites } from '../tauri/favorites';
import { isAniListType, syncToAniList } from '../media/anilist-sync';

export async function setLibraryFavorite(entry: LibraryEntry, favorite: boolean): Promise<LibraryEntry> {
  const saved = await saveLibraryEntry({ ...entry, is_favorite: favorite ? 1 : 0 });
  await syncFavorites(entry.type, entry.external_id, favorite);
  return saved;
}

/** Progress after one more episode/chapter, and whether that completes the
 *  work (reaching a known total, like the media page's `+`). Null when the
 *  total is already reached. */
export function nextProgressStep(current: number, total: number | null): { progress: number; completes: boolean } | null {
  const next = current + 1;
  if (total && total > 0 && next > total) return null;
  return { progress: next, completes: !!total && total > 0 && next >= total };
}

export async function markNextProgress(entry: LibraryEntry, total: number | null): Promise<LibraryEntry | null> {
  const step = nextProgressStep(entry.progress ?? 0, total);
  if (!step) return null;
  const draft: LibraryEntry = { ...entry, progress: step.progress };
  if (step.completes && entry.status !== 'completed') draft.status = 'completed';
  const saved = await saveLibraryEntry(draft);
  if (isAniListType(saved.type)) {
    void syncToAniList({
      externalId: saved.external_id, type: saved.type,
      status: saved.status ?? '', rating: saved.rating ?? 0,
      progress: saved.progress ?? 0, progressVolumes: saved.progress_2 ?? 0,
      startedAt: saved.started_at ?? '', finishedAt: saved.finished_at ?? '', notes: saved.notes ?? '',
    }).then(result => { if (!result.ok) console.warn('AniList sync failed:', result.error); });
  }
  return saved;
}
