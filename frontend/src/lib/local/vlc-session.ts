// Identity of whichever episode was most recently launched via the local
// player's "Reproducir" button. VLC's HTTP status API (getVlcPlaybackStatus)
// reports playback state/position but never which file is open, so this is
// the only way a re-mounted LocalMediaDetailPanel can tell "is VLC actually
// still on the very episode I'm showing" from "that's some unrelated/stale
// VLC state" — needed because switching to another item and back used to
// always reset the panel to a fresh unplayed state regardless of whether
// playback was still going in the background.
let activeSession: { externalId: string; episodeNumber: number } | null = null;

export function setActiveVlcSession(externalId: string, episodeNumber: number): void {
  activeSession = { externalId, episodeNumber };
}

export function clearActiveVlcSession(externalId: string): void {
  if (activeSession?.externalId === externalId) activeSession = null;
}

export function getActiveVlcSession(): { externalId: string; episodeNumber: number } | null {
  return activeSession;
}
