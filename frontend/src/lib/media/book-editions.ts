// OpenLibrary editions ('Ediciones' tab), split out of mediaService.ts.
import { fetchOpenLibEditions, openLibCoverUrl, bookIdFromWorkKey } from '../search/providers/openlibrary';
import type { OpenLibEdition } from '../search/providers/openlibrary';
import type { MediaPageData } from './types';

// Only editions with a valid cover are included.
function editionsToRelations(editions: OpenLibEdition[], label: string): MediaPageData['relations'] {
  const seen = new Set<string>();
  const result: MediaPageData['relations'] = [];
  for (const ed of editions) {
    const edId = bookIdFromWorkKey(ed.key);
    if (seen.has(edId)) continue;
    seen.add(edId);
    const coverId = ed.covers?.[0];
    const cover = coverId && coverId > 0 ? openLibCoverUrl(coverId, 'M') : undefined;
    if (!cover) continue;
    const publisherPart = ed.publishers?.[0] ?? '';
    const yearPart = ed.publish_date ? ` (${ed.publish_date})` : '';
    const title = ed.title + (publisherPart ? ` — ${publisherPart}${yearPart}` : yearPart);
    result.push({ typeLabel: label, relationType: 'EDITIONS', title, cover });
  }
  return result;
}

// Page count lives on the edition, not the work (OpenLibrary has no such
// field on a Work at all) — different editions of the same book can report
// different counts (paperback vs. hardcover vs. ebook), so this is just
// whichever valid one comes first rather than picking "the" definitive
// count, which OpenLibrary itself has no single source of truth for.
function firstPageCount(editions: OpenLibEdition[]): number | null {
  return editions.find(e => e.number_of_pages && e.number_of_pages > 0)?.number_of_pages ?? null;
}

// All editions for a book, merged with existing relations (same pattern as
// fetchExtraRelations for games) — plus a representative page count for the
// progress field's total (see getProgressConfig, MediaEditorModal.tsx).
export async function fetchBookEditions(
  rawId: string,
  currentRelations: MediaPageData['relations'],
  editionsLabel: string,
): Promise<{ relations: MediaPageData['relations']; totalPages: number | null } | null> {
  const workId = rawId.slice(rawId.indexOf(':') + 1);
  const editions = await fetchOpenLibEditions(workId).catch(() => []);
  if (!editions.length) return null;
  const editionRelations = editionsToRelations(editions, editionsLabel);
  const totalPages = firstPageCount(editions);
  if (!editionRelations.length && totalPages === null) return null;
  const withoutOld = currentRelations.filter(r => r.relationType !== 'EDITIONS');
  return { relations: [...withoutOld, ...editionRelations], totalPages };
}
