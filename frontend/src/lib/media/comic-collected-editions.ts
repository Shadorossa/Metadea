// Comic Vine "collected editions" relation ('Editions' tab on a comic's own
// page), split out of mediaService.ts the same way fetchComicIssues and
// fetchBookEditions are. A deluxe/omnibus/etc. reprint of this run is hidden
// from search results (see searchComics's collected-edition filter in
// comicvine.ts) so it doesn't clutter the list as if it were an unrelated
// comic — this is where it resurfaces, as a relation on the numbered run's
// own page, so it's still reachable (and still selectable when filing a
// local CBZ under the right catalog entry).
import { comicVineSearch } from '../tauri';
import { isCollectedEditionVolume, collectedEditionBaseName } from '../search/providers/comicvine';
import type { MediaPageData } from './types';

export async function fetchComicCollectedEditions(
  rawId: string,
  currentRelations: MediaPageData['relations'],
  editionsLabel: string,
  titleMain?: string,
): Promise<MediaPageData['relations'] | null> {
  if (!rawId.startsWith('comic:') || !titleMain) return null;

  const searchRes = await comicVineSearch(titleMain).catch(() => null);
  if (!searchRes?.volumes.length) return null;

  const ownBaseName = collectedEditionBaseName(titleMain);
  const editions = searchRes.volumes.filter(v =>
    `comic:${v.id}` !== rawId &&
    isCollectedEditionVolume(v) &&
    collectedEditionBaseName(v.name) === ownBaseName,
  );
  if (!editions.length) return null;

  const editionRelations: MediaPageData['relations'] = editions
    .map(v => {
      const cover = v.image?.medium_url ?? v.image?.small_url;
      if (!cover) return null;
      const relatedExternalId = `comic:${v.id}`;
      return { typeLabel: editionsLabel, relationType: 'EDITIONS', title: v.name, cover, url: `/media?id=${relatedExternalId}`, relatedExternalId };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);
  if (!editionRelations.length) return null;

  const withoutOld = (Array.isArray(currentRelations) ? currentRelations : []).filter(r => r.relationType !== 'EDITIONS');
  return [...withoutOld, ...editionRelations];
}
