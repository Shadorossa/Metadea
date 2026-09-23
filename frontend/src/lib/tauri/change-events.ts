// Window events the local-DB wrappers fire after a write, so read-side
// memos (lib/media/media-page-read-cache.ts's visit-scoped bundle, the
// profile's library-data-cache) can drop just the rows that changed. Same
// idea as catalog.ts's 'media-relations-changed' and library.ts's
// 'refresh-profile-library', for the per-media tables the media page bundle
// (media-page.ts) carries: a writer names the part, the memo marks it stale.

export type MediaPagePart =
  | 'authors' | 'characters' | 'staff' | 'companies' | 'episodes' | 'themes' | 'sync_state';

export const MEDIA_PART_CHANGED_EVENT = 'media-page-part-changed';

export interface MediaPartChangedDetail {
  part: MediaPagePart;
}

export function notifyMediaPartChanged(part: MediaPagePart): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<MediaPartChangedDetail>(MEDIA_PART_CHANGED_EVENT, { detail: { part } }));
}
