// IPC layer for the skip-segment lookups (src-tauri/src/aniskip.rs).
//
// Same direct `@tauri-apps/api` invoke as ./player: these calls run in the
// player-overlay window too, which never runs `init_database`, and
// ./bridge's invoke would stall waiting for it. Every call degrades to
// "nothing" outside Tauri or on failure — a missing segment is never an
// error the user sees.

import { isTauri } from './bridge';

export type AniskipSkipType = 'op' | 'ed' | 'recap' | 'mixed-op' | 'mixed-ed';

export interface AniskipSegment {
  skip_type: AniskipSkipType | string;
  start_secs: number;
  end_secs: number;
}

async function invokeAniskip<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri()) throw new Error('Tauri not available');
  const { invoke } = await import(/* @vite-ignore */ '@tauri-apps/api/core');
  return invoke<T>(cmd, args);
}

export async function aniskipGetSegments(malId: number, episode: number, episodeLength: number): Promise<AniskipSegment[]> {
  if (!isTauri()) return [];
  return invokeAniskip<AniskipSegment[]>('aniskip_get_segments', { malId, episode, episodeLength }).catch(err => {
    console.debug('AniSkip lookup failed', err);
    return [];
  });
}

export async function getCatalogMalId(externalId: string): Promise<number | null> {
  if (!isTauri()) return null;
  return invokeAniskip<number | null>('get_catalog_mal_id', { externalId }).catch(() => null);
}

export async function setCatalogMalId(externalId: string, malId: number | null): Promise<void> {
  if (!isTauri()) return;
  await invokeAniskip<void>('set_catalog_mal_id', { externalId, malId }).catch(err => {
    console.debug('Could not persist the MAL id', err);
  });
}
