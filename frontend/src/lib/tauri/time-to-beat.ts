import { tauriTry } from './bridge';

// ── How long to beat (src-tauri/src/time_to_beat) ───────────────────────────

export interface TimeToBeatQuery {
  /** `game:<igdb id>` or `vnovel:<igdb id>`; anything else is ignored. */
  externalId: string;
  /** Title and release year: how a visual novel is looked up on VNDB. */
  title?: string;
  releaseYear?: number;
}

export interface TimeToBeat {
  externalId: string;
  /** IGDB `hastily`, or VNDB's vote-averaged reading time. */
  mainSeconds: number | null;
  /** IGDB `normally`. */
  extraSeconds: number | null;
  /** IGDB `completely`. */
  completionistSeconds: number | null;
  votes: number | null;
  /** VNDB 1 (very short) – 5 (very long), only when it has no minutes. */
  lengthBucket: number | null;
  source: 'igdb' | 'vndb';
  fetchedAt: number;
}

/** Cache first, then IGDB / VNDB. Works without data are absent. */
export function getTimeToBeat(queries: TimeToBeatQuery[]): Promise<TimeToBeat[]> {
  return tauriTry<TimeToBeat[]>('get_time_to_beat', [], { queries });
}

/** Cache only (no requests), stale rows included. */
export function getCachedTimeToBeat(externalIds: string[]): Promise<TimeToBeat[]> {
  return tauriTry<TimeToBeat[]>('get_cached_time_to_beat', [], { externalIds });
}
