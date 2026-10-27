import { useState, useEffect, useRef, useCallback } from 'react';
import type { LibraryEntry } from '../../../lib/tauri';
// Served from the media page's mount bundle while its visit is active, a
// plain get_library_entry otherwise.
import { readLibraryEntryCached } from '../../../lib/media/media-page-read-cache';

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

  // In-page navigation to another work keeps the previous work's state until
  // the new read lands; it never counts for the new id, so neither the hero
  // nor a quick click in the meantime acts on it (a click used to save the
  // change onto the previous work). A read that answers after the id
  // changed again is ignored.
  const current = entry?.external_id === currentId ? entry : null;

  useEffect(() => {
    if (!mediaType || !currentId) return;
    let cancelled = false;
    readLibraryEntryCached(currentId)
      .then(fetched => {
        if (cancelled) return;
        lastKnownEntry.current = fetched;
        setEntry(fetched);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [currentId, mediaType]);

  const updateLocal = useCallback((overrides: Partial<LibraryEntry>): LibraryEntry => {
    const draft: LibraryEntry = {
      id: '', user_id: 'local', type: mediaType ?? '',
      status: null, rating: null, rating_2: null, progress: 0, progress_2: 0, minutes_spent: 0,
      is_favorite: 0, is_platinum: 0, tags: null, notes: null,
      added_at: null, updated_at: null, selected_platform: null, selected_version: null,
      started_at: null, finished_at: null,
      ...current,
      ...overrides,
      external_id: currentId,
    };
    setEntry(draft);
    return draft;
  }, [currentId, mediaType, current]);

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
    entry: current,
    status: current?.status ?? '',
    rating: current?.rating ?? 0,
    inLibrary: !!current?.status,
    updateLocal,
    applySaved,
    applyDeleted,
    rollback,
  };
}
