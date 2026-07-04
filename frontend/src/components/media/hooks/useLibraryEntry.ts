import { useState, useEffect, useRef, useCallback } from 'react';
import { getLibraryEntry } from '../../../lib/tauri';
import type { LibraryEntry } from '../../../lib/tauri';

export interface UseLibraryEntryResult {
  entry: LibraryEntry | null;
  status: string;
  rating: number;
  inLibrary: boolean;
  /** Merge `overrides` into the current entry (or a fresh draft) and apply it as the local state. */
  updateLocal: (overrides: Partial<LibraryEntry>) => LibraryEntry;
  /** Adopt a freshly-saved entry as the new source of truth. */
  applySaved: (saved: LibraryEntry) => void;
  /** Clear the entry after a delete, and forget the last known DB state. */
  applyDeleted: () => void;
  /** Discard any unsaved local draft, reverting to the last state actually persisted. */
  rollback: () => void;
}

/**
 * Centralizes a media page's library-tracking state (status/rating/etc.) so that
 * optimistic quick-edits (hero widget clicks) and the editor modal's save/delete/close
 * flows all mutate the same source of truth instead of juggling parallel useState calls.
 */
export function useLibraryEntry(currentId: string, mediaType: string | undefined): UseLibraryEntryResult {
  const [entry, setEntry] = useState<LibraryEntry | null>(null);

  // Last entry known to actually exist in the DB (fetched, saved or deleted).
  // Quick clicks on the hero widget mutate `entry` optimistically before the
  // editor even opens; if the user closes without saving, `rollback` restores
  // this instead of leaving the unsaved draft on screen.
  const lastKnownEntry = useRef<LibraryEntry | null>(null);

  useEffect(() => {
    if (!mediaType || !currentId) return;

    getLibraryEntry(currentId, mediaType)
      .then(fetched => {
        lastKnownEntry.current = fetched;
        setEntry(fetched);
      })
      .catch(() => {});
  }, [currentId, mediaType]);

  const updateLocal = useCallback((overrides: Partial<LibraryEntry>): LibraryEntry => {
    const draft: LibraryEntry = {
      id: '', user_id: 'local', external_id: currentId, type: mediaType ?? '',
      status: null, rating: null, progress: 0, progress_2: 0, minutes_spent: 0,
      is_favorite: 0, is_platinum: 0, tags: null, notes: null,
      added_at: null, updated_at: null, selected_platform: null, selected_version: null,
      started_at: null, finished_at: null,
      ...entry,
      ...overrides,
    };
    setEntry(draft);
    return draft;
  }, [currentId, mediaType, entry]);

  const applySaved = useCallback((saved: LibraryEntry) => {
    lastKnownEntry.current = saved;
    setEntry(saved);
  }, []);

  const applyDeleted = useCallback(() => {
    lastKnownEntry.current = null;
    setEntry(null);
  }, []);

  const rollback = useCallback(() => {
    setEntry(lastKnownEntry.current);
  }, []);

  return {
    entry,
    status: entry?.status ?? '',
    rating: entry?.rating ?? 0,
    inLibrary: !!entry?.status,
    updateLocal,
    applySaved,
    applyDeleted,
    rollback,
  };
}
