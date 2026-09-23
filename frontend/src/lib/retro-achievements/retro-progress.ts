// Read-side facade for callers outside the panel (the Discord presence
// layer): the linked RA game's progress summary for a library entry, served
// from the Rust cache so it never blocks on the network for long and is
// null when the entry has no RA link or RA is not configured.
import { raGetGameProgress, raGetLink } from '../tauri/retro-achievements';
import { summarizeProgress, type RetroProgressSummary } from './progress-summary';

export async function getRetroProgressSummary(externalId: string): Promise<RetroProgressSummary | null> {
  const link = await raGetLink(externalId);
  if (!link) return null;
  try {
    const cached = await raGetGameProgress(link.raGameId);
    return summarizeProgress(cached.data);
  } catch {
    // A read whose absence the caller already represents (no presence line).
    return null;
  }
}
