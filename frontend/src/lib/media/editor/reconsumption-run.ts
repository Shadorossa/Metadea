// The media editor's "re-watching / re-reading / re-playing" toggle, as pure
// LogState patches (dispatched through the existing UPDATE_LOG action).
//
// Only the draft-side half of the feature lives here. The other half —
// bumping reconsumption_count, clearing the flag, snapping progress back to
// the catalog totals and logging the `complete` event when a re-run is
// completed again — runs in save_library_entry (user_library.rs), so the
// player/reader auto-mark flows get it too without knowing about it.
import type { LogState } from './library-log-state';

// A re-run can only start from a finished work.
export function canStartReconsumptionRun(log: Pick<LogState, 'status' | 'reconsuming'>): boolean {
  return log.status === 'completed' && !log.reconsuming;
}

// "I'm watching this again": back to the in-progress status for this media
// type, progress counts the new run from 0. started_at/finished_at are
// deliberately NOT in the patch — the first run's dates stay as they are.
export function startReconsumptionRun(inProgressStatus: string): Partial<LogState> {
  return { reconsuming: true, status: inProgressStatus, progress: 0, progressCount2: 0 };
}

// Toggling the button off mid-run abandons the re-run without counting it:
// back to completed with progress restored to the totals (unknown total →
// leave the draft's value alone), count unchanged.
export function cancelReconsumptionRun(
  totals: { totalCount?: number | null; totalCount2?: number | null },
): Partial<LogState> {
  const patch: Partial<LogState> = { reconsuming: false, status: 'completed' };
  if (totals.totalCount && totals.totalCount > 0) patch.progress = totals.totalCount;
  if (totals.totalCount2 && totals.totalCount2 > 0) patch.progressCount2 = totals.totalCount2;
  return patch;
}

// i18n key (media.editor.*) for the toggle's label, by the media type's own
// in-progress verb: "Rewatch" for anime/series/movie, "Reread" for manga/
// books/comics, "Replay" for games/VNs.
export type ReconsumeLabelKey = 'reconsume_watching' | 'reconsume_reading' | 'reconsume_playing';

export function reconsumeLabelKey(inProgressStatus: string): ReconsumeLabelKey {
  if (inProgressStatus === 'reading') return 'reconsume_reading';
  if (inProgressStatus === 'playing') return 'reconsume_playing';
  return 'reconsume_watching';
}

// Stepper input for the "×N" badge: whole numbers, never below 0.
export function clampReconsumptionCount(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value));
}
