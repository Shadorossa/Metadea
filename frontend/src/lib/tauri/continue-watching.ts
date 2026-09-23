// Home's "Continue watching" card — continue_watching.rs. A read whose
// absence the card already represents (no card), so failures resolve to
// "nothing watched".
import { tauriTry } from './bridge';
import type { ContinueWatchingSources } from '../home/continue-watching';

const EMPTY: ContinueWatchingSources = { resume: [], history: [], frames: [], episodes: [] };

export function getContinueWatchingSources(): Promise<ContinueWatchingSources> {
  return tauriTry<ContinueWatchingSources>('get_continue_watching_sources', EMPTY);
}
