import { isTauri, invoke, tauriRun } from './core';

export async function playFileWithVlc(filePath: string): Promise<void> {
  return tauriRun('play_file_with_vlc', { filePath });
}

export interface VlcPlaybackStatus {
  state:    string;
  position: number;
  time:     number;
  length:   number;
}

// Returns null whenever VLC's HTTP status interface isn't reachable (not
// running yet, or the user already had a VLC instance open without it) —
// callers should treat that as "no progress info available", not an error.
export async function getVlcPlaybackStatus(): Promise<VlcPlaybackStatus | null> {
  if (!isTauri()) return null;
  return invoke<VlcPlaybackStatus | null>('get_vlc_playback_status');
}

