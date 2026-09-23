import { readStoredJson, writeStoredJson, isTauri, invoke } from './bridge';
import { STORAGE_KEYS } from '../storage/storage-keys';

export interface UserJourneyEvent {
  externalId:     string;
  type:           'start' | 'complete' | 'progress';
  progressStart?: number;
  progressEnd?:   number;
  mediaType:      string;
  timestamp:      string; // ISO String
}

export interface DayJourney {
  date:   string; // YYYY-MM-DD
  events: UserJourneyEvent[];
}

export async function readUserJourney(): Promise<DayJourney[]> {
  return readStoredJson<DayJourney[]>('read_user_journey', STORAGE_KEYS.userJourney, []);
}

/** Typed counterpart of readUserJourney: the same DayJourney[] as real
 *  values over IPC instead of a JSON string parsed here (see
 *  read_user_journey_typed in user_library.rs — identical key names,
 *  progressStart/progressEnd omitted when unset). Outside Tauri it falls
 *  back to readUserJourney's localStorage path. */
export async function readUserJourneyTyped(): Promise<DayJourney[]> {
  if (!isTauri()) return readUserJourney();
  return invoke<DayJourney[]>('read_user_journey_typed');
}

export async function writeUserJourney(journey: DayJourney[]): Promise<void> {
  return writeStoredJson('write_user_journey', STORAGE_KEYS.userJourney, journey);
}
