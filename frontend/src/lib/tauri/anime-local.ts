import { isTauri, invoke, tauriRun } from './core';

// filePaths plays as one VLC playlist, in order — lets a caller queue every
// remaining episode in one launch instead of relaunching per episode.
// startSeconds only ever applies to the first path.
export async function playFileWithVlc(filePaths: string[], startSeconds?: number): Promise<void> {
  return tauriRun('play_file_with_vlc', { filePaths, startSeconds: startSeconds ?? null });
}

export interface VlcPlaybackStatus {
  state:    string;
  position: number;
  time:     number;
  length:   number;
  // The currently loaded file's own name — null if VLC's response didn't
  // carry it. See get_vlc_playback_status's own comment for why this beats
  // inferring a track change from time/duration alone.
  filename: string | null;
}

// Returns null whenever VLC's HTTP status interface isn't reachable (not
// running yet, or the user already had a VLC instance open without it) —
// callers should treat that as "no progress info available", not an error.
export async function getVlcPlaybackStatus(): Promise<VlcPlaybackStatus | null> {
  if (!isTauri()) return null;
  return invoke<VlcPlaybackStatus | null>('get_vlc_playback_status');
}

// Fire-and-forget playback control (pause/resume/stop/skip) — see
// send_vlc_command's own Rust-side comment for the actual command names.
export async function sendVlcCommand(command: string, val?: string): Promise<void> {
  return tauriRun('send_vlc_command', { command, val: val ?? null });
}

