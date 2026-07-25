import type { SocialLibraryItem, LibraryEntry } from '../tauri';

// Maps a synced social library row onto the same LibraryEntry shape the
// local profile page uses, so the exact same rendering (HofSection,
// LibraryCard, the grouping helpers in library-grouping.ts, monthly.ts'
// buildMonthlyHistoryHtml) can be reused verbatim for someone else's
// profile — genuinely the same components, not a lesser lookalike.
// Bookkeeping fields nobody else's page ever reads (progress_2,
// minutes_spent, favorite/platinum flags, selected platform/version)
// default to their neutral value; `type` is derived from the external_id's
// own "{type}:{id}" prefix rather than the LEFT JOIN's resolved media_type,
// since that's null whenever the viewer's own catalog doesn't recognize the
// entry yet — this file's whole reason to exist is entries that don't.
export function toLibraryEntry(item: SocialLibraryItem): LibraryEntry {
  return {
    id: item.external_id,
    user_id: '',
    external_id: item.external_id,
    type: item.external_id.split(':')[0] ?? item.media_type ?? '',
    status: item.status,
    rating: item.rating,
    // Dual rating is a personal, device-level preference (Settings >
    // Preferencias) — never synced as part of someone else's profile data.
    rating_2: null,
    progress: item.progress ?? 0,
    progress_2: 0,
    minutes_spent: 0,
    is_favorite: 0,
    is_platinum: 0,
    tags: item.tags,
    notes: item.notes,
    added_at: item.started_at,
    updated_at: item.finished_at ?? item.started_at,
    selected_platform: null,
    selected_version: null,
    started_at: item.started_at,
    finished_at: item.finished_at,
  };
}
