import { readStoredJson, writeStoredJson } from './core';
import { STORAGE_KEYS } from '../shared/storage-keys';

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

export async function writeUserJourney(journey: DayJourney[]): Promise<void> {
  return writeStoredJson('write_user_journey', STORAGE_KEYS.userJourney, journey);
}
