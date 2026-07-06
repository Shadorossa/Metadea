import { tauriCmd, tauriRun, invoke, isTauri, readStoredJson, writeStoredJson } from './core';

export interface LibraryEntry {
  id:                string;
  user_id:           string;
  external_id:       string;
  type:              string;
  status:            string | null;
  rating:            number | null;
  progress:          number;
  progress_2:        number;
  minutes_spent:     number;
  is_favorite:       number;
  is_platinum:       number;
  tags:              string[] | null;
  notes:             string | null;
  added_at:          string | null;
  updated_at:        string | null;
  selected_platform: string | null;
  selected_version:  string | null;
  started_at:        string | null;
  finished_at:       string | null;
}

export async function saveLibraryEntry(entry: LibraryEntry): Promise<LibraryEntry> {
  if (!isTauri()) throw new Error('Tauri not available');
  return invoke<LibraryEntry>('save_library_entry', { entry });
}

export async function getLibraryEntry(externalId: string, entryType: string): Promise<LibraryEntry | null> {
  return tauriCmd<LibraryEntry | null>('get_library_entry', null, { externalId, entryType });
}

export async function deleteLibraryEntry(externalId: string, entryType: string): Promise<void> {
  return tauriRun('delete_library_entry', { externalId, entryType });
}

export async function getAllLibraryEntries(): Promise<LibraryEntry[]> {
  return tauriCmd<LibraryEntry[]>('get_all_library_entries', []);
}

export async function readMonthlyHistory(): Promise<Record<string, string[]>> {
  return readStoredJson<Record<string, string[]>>('read_monthly_history', 'monthly_history', {});
}

export async function writeMonthlyHistory(history: Record<string, string[]>): Promise<void> {
  return writeStoredJson('write_monthly_history', 'monthly_history', history);
}
