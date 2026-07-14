import { tauriRun } from './core';

// Update Discord Rich Presence details and status state
export async function updateDiscordPresence(
  details: string,
  state: string,
  startTime?: number,
  endTime?: number,
  largeImage?: string,
  largeText?: string,
  smallImage?: string,
  smallText?: string
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
  });
}

// Reset Discord Rich Presence to default browsing state
export async function resetDiscordPresence(): Promise<void> {
  return tauriRun('reset_presence');
}
