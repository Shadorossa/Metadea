import { readStoredJson, writeStoredJson } from './core';

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
  return readStoredJson<DayJourney[]>('read_user_journey', 'user_journey', []);
}

export async function writeUserJourney(journey: DayJourney[]): Promise<void> {
  return writeStoredJson('write_user_journey', 'user_journey', journey);
}
