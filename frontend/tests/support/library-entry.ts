import type { LibraryEntry } from '../../src/lib/tauri/library';

// A user_library row with neutral defaults (planning, nothing rated,
// no dates); tests override only the fields they are about. `type`
// defaults to the external_id's prefix.
export function libraryEntry(overrides: Partial<LibraryEntry> = {}): LibraryEntry {
  const externalId = overrides.external_id ?? 'anime:1';
  return {
    id: externalId, user_id: 'local', external_id: externalId, type: externalId.split(':')[0], status: 'planning',
    rating: null, rating_2: null, progress: 0, progress_2: 0, minutes_spent: 0, is_favorite: 0, is_platinum: 0,
    tags: null, notes: null, added_at: null, updated_at: null, selected_platform: null, selected_version: null,
    started_at: null, finished_at: null,
    ...overrides,
  };
}
