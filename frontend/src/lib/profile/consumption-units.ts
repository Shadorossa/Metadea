// The one place the reconsumption counter (rewatch / reread / replay) turns
// into consumed units for the profile's totals — episodes, chapters, hours.
//
// A work finished N extra times counts its units N + 1 times; a re-run in
// progress adds the new run's partial progress on top of the full runs
// already behind it. Every "sum of units" in lib/profile goes through
// consumedUnits so the multiplier can't drift between the overview, the
// per-type breakdown and the duration sort.
import type { LibraryEntry } from '../tauri';

export interface ConsumptionInput {
  /** Units logged for the CURRENT run (episodes, chapters, minutes, ...). */
  progress: number;
  /** Units of one full run, when the catalog knows it. */
  totalUnits?: number | null;
  reconsumptionCount?: number | null;
  reconsuming?: number | boolean | null;
}

// How many times a finished work's units are counted: once for the first
// run plus once per completed re-run.
export function consumptionMultiplier(entry: Pick<LibraryEntry, 'reconsumption_count'>): number {
  return 1 + Math.max(0, entry.reconsumption_count ?? 0);
}

export function consumedUnits({ progress, totalUnits, reconsumptionCount, reconsuming }: ConsumptionInput): number {
  const current = Math.max(0, progress || 0);
  const completedReruns = Math.max(0, reconsumptionCount ?? 0);
  if (reconsuming) {
    // Mid re-run: `progress` is the new run counted from 0. The runs already
    // finished (the first one + every counted re-run) are each one full
    // work; without a known total there is nothing to add for them.
    const fullRun = totalUnits && totalUnits > 0 ? totalUnits : 0;
    return fullRun * (1 + completedReruns) + current;
  }
  // Not mid-run: `progress` already equals the total for a completed work
  // (save_library_entry snaps it back), so the multiplier applies directly.
  return current * (1 + completedReruns);
}

// Convenience over a library row for the unit the caller has in hand.
export function consumedUnitsOf(
  entry: Pick<LibraryEntry, 'reconsumption_count' | 'reconsuming'>,
  progress: number,
  totalUnits?: number | null,
): number {
  return consumedUnits({
    progress, totalUnits,
    reconsumptionCount: entry.reconsumption_count, reconsuming: entry.reconsuming,
  });
}
