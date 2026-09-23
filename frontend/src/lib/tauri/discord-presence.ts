import { tauriRun } from './bridge';
// ── Discord Rich Presence ────────────────────────────────────────────────────

// Update Discord Rich Presence details and status state
export async function updateDiscordPresence(
  details: string,
  state: string,
  startTime?: number,
  endTime?: number,
  largeImage?: string,
  largeText?: string,
  smallImage?: string,
  smallText?: string,
  // Discord activity type: 'playing' (default) | 'watching' | 'listening'.
  activityType?: 'playing' | 'watching' | 'listening',
): Promise<void> {
  return tauriRun('update_presence', {
    details,
    state,
    startTime,
    endTime,
    largeImage,
    largeText,
    smallImage,
    smallText,
    activityType,
  });
}

// Reset Discord Rich Presence to default browsing state
export async function resetDiscordPresence(): Promise<void> {
  return tauriRun('reset_presence');
}
