import { tauriCmd, tauriRun } from './core';

// Where VLC's own position was last seen for an episode not yet marked
// watched — see resume_position.rs's own comment for why this is a
// persisted table rather than in-memory state.
export async function getResumePosition(externalId: string, episodeNumber: number): Promise<number | null> {
  return tauriCmd<number | null>('get_resume_position', null, { externalId, episodeNumber });
}

export async function saveResumePosition(externalId: string, episodeNumber: number, positionSeconds: number): Promise<void> {
  return tauriRun('save_resume_position', { externalId, episodeNumber, positionSeconds });
}

export async function clearResumePosition(externalId: string, episodeNumber: number): Promise<void> {
  return tauriRun('clear_resume_position', { externalId, episodeNumber });
}
