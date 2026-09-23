import type { SocialLibraryItem, LibraryEntry } from '../tauri';

// Maps a synced social library row onto the same LibraryEntry shape the
// local profile page uses, so the exact same rendering (HofSection,
// LibraryCard, the grouping helpers in library-grouping.ts, monthly.ts'
// buildMonthlyHistoryHtml) can be reused verbatim for someone else's
// profile — genuinely the same components, not a lesser lookalike.
//
// The owner's real numbers win whenever their app synced them (the
// profile-parity sync): minutes_spent (hours played / watched / read),
// rating_2, progress_2 and re-runs, so their Stats tab, "Total hours" and
// backlog read exactly what they see on their own profile. A row from an
// older app has none of them, and only then is minutes_spent rebuilt the
// way the library editor writes it (progress × 60, media-editor-save.ts).
// Bookkeeping nobody else's page reads (favorite/platinum flags, selected
// platform/version) keeps its neutral value. `type` is derived from the
// external_id's own "{type}:{id}" prefix rather than the LEFT JOIN's
// resolved media_type, since that's null whenever the viewer's own catalog
// doesn't recognize the entry yet — this file's whole reason to exist is
// entries that don't.
export function toLibraryEntry(item: SocialLibraryItem): LibraryEntry {
  const progress = item.progress ?? 0;
  return {
    id: item.external_id,
    user_id: '',
    external_id: item.external_id,
    type: item.external_id.split(':')[0] ?? item.media_type ?? '',
    status: item.status,
    rating: item.rating,
    rating_2: item.rating_2 ?? null,
    progress,
    progress_2: item.progress_2 ?? 0,
    minutes_spent: item.minutes_spent ?? progress * 60,
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
    reconsumption_count: item.reconsumption_count ?? 0,
    reconsuming: item.reconsuming ?? 0,
  };
}
