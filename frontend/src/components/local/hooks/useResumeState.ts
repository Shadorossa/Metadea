import { getResumePosition, getReadingProgress } from '../../../lib/tauri';
import { useAsyncResource } from '../../shared/hooks/useAsyncResource';
import type { LocalMediaItem } from './useLocalMediaEntries';

export interface ReadingProgress {
  pageNumber: number;
  totalPages: number | null;
}

export interface ResumeState {
  resumeSeconds: number | null;
  readingProgress: ReadingProgress | null;
}

// Where the next episode/volume was left off — the player's saved position
// for video, the reader's saved page for comics/books. Re-read whenever the
// target episode changes, or when this item's playback session /
// reader modal comes and goes (the position may have moved meanwhile).
export function useResumeState(
  item: LocalMediaItem,
  nextNumber: number,
  isThisPlaying: boolean,
  isReading: boolean,
  readerOpen: boolean,
): ResumeState {
  const { value: resumeSeconds } = useAsyncResource<number | null>(
    () => getResumePosition(item.externalId, nextNumber).catch(() => null),
    [item.externalId, nextNumber, isThisPlaying],
    null,
  );

  const { value: readingProgress } = useAsyncResource<ReadingProgress | null>(
    () => isReading
      ? getReadingProgress(item.externalId, nextNumber).catch(() => null)
      : Promise.resolve(null),
    [isReading, item.externalId, nextNumber, readerOpen],
    null,
  );

  return { resumeSeconds, readingProgress };
}
