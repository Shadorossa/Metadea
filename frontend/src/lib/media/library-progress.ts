// How an auto-mark (the player finishing an episode, the reader closing a
// volume) moves a library entry's progress counter.
import type { LibraryEntry } from '../tauri/library';

/** The progress to save after consuming unit `n`: during a re-run
 *  (`reconsuming`) the counter follows the re-run from 1 again; otherwise
 *  going back to an earlier episode or volume never lowers it — rewatching
 *  episode 3 of a show at 10/12 (or completed) used to save 3/12 and push
 *  that to AniList/MyAnimeList. */
export function nextProgress(
  entry: Pick<LibraryEntry, 'progress' | 'progress_2' | 'reconsuming'>,
  n: number,
  field: 'progress' | 'progress_2' = 'progress',
): number {
  if (entry.reconsuming) return n;
  return Math.max(entry[field] ?? 0, n);
}
