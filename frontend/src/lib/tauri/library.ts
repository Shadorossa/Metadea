import { tauriCmd, tauriRun, invoke, isTauri, readStoredJson, writeStoredJson } from './core';
import { STORAGE_KEYS } from '../shared/storage-keys';

export interface LibraryEntry {
  id: string;
  user_id: string;
  external_id: string;
  type: string;
  status: string | null;
  rating: number | null;
  progress: number;
  progress_2: number;
  minutes_spent: number;
  is_favorite: number;
  is_platinum: number;
  tags: string[] | null;
  notes: string | null;
  added_at: string | null;
  updated_at: string | null;
  selected_platform: string | null;
  selected_version: string | null;
  started_at: string | null;
  finished_at: string | null;
}

// Fired after any write below, from wherever it happens (Profile's own
// editor, the media detail page, local library import, AniList import,
// admin panel, ...) — this is the single point every path funnels through,
// so the Profile tabs' shared cache (lib/profile/library-data-cache.ts)
// stays correct without every caller having to remember to invalidate it
// itself. Cheap no-op when the Profile page isn't even open (just an event
// with no listeners).
function notifyLibraryChanged() {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('refresh-profile-library'));
}

export async function saveLibraryEntry(entry: LibraryEntry): Promise<LibraryEntry> {
  if (!isTauri()) throw new Error('Tauri not available');
  const saved = await invoke<LibraryEntry>('save_library_entry', { entry });
  notifyLibraryChanged();
  return saved;
}

export async function getLibraryEntry(externalId: string): Promise<LibraryEntry | null> {
  return tauriCmd<LibraryEntry | null>('get_library_entry', null, { externalId });
}

export async function deleteLibraryEntry(externalId: string): Promise<void> {
  await tauriRun('delete_library_entry', { externalId });
  notifyLibraryChanged();
}

export async function getAllLibraryEntries(): Promise<LibraryEntry[]> {
  return tauriCmd<LibraryEntry[]>('get_all_library_entries', []);
}

export interface EpisodeHistoryEntry {
  id:             string;
  external_id:    string;
  episode_number: number;
  watched_at:     string;
}

export async function saveEpisodeHistoryEntry(externalId: string, episodeNumber: number): Promise<void> {
  return tauriRun('save_episode_history_entry', { externalId, episodeNumber });
}

export async function getEpisodeHistory(externalId: string): Promise<EpisodeHistoryEntry[]> {
  return tauriCmd<EpisodeHistoryEntry[]>('get_episode_history', [], { externalId });
}

export async function readMonthlyHistory(): Promise<Record<string, string[]>> {
  return readStoredJson<Record<string, string[]>>('read_monthly_history', STORAGE_KEYS.monthlyHistory, {});
}

export async function writeMonthlyHistory(history: Record<string, string[]>): Promise<void> {
  return writeStoredJson('write_monthly_history', STORAGE_KEYS.monthlyHistory, history);
}
