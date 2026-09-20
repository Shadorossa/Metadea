import { scanFolderContents, type LibraryEntry, type LocalFolderEntry, type MediaCatalogEntry } from '../../lib/tauri';
import type { LocalMediaItem } from '../local/hooks/useLocalMediaEntries';
import {
  extractEpisodeInfo, extractTitleSeason, findMatchingEpisodeFile, findMatchingFile,
  findMatchingFolder, findTaggedPathRecursive, hasMediaFiles, MEDIA_EXTENSIONS, soleMediaFile,
} from '../local/utils/folderMatch';
import { resolveOwnSeasonNumber, resolveSeasonExternalIds } from '../local/utils/seasonResolve';
import { isInProgressStatus, isReadingType } from '../../lib/constants/media';

export function toLocalMediaItem(entry: LibraryEntry, catalog?: MediaCatalogEntry): LocalMediaItem {
  return {
    externalId: entry.external_id,
    title: catalog?.title_main ?? entry.external_id,
    titleRomaji: catalog?.title_romaji ?? null,
    titleNative: catalog?.title_native ?? null,
    cover: catalog?.cover_url ?? null,
    status: entry.status ?? '',
    progress: entry.progress ?? 0,
    libraryEntry: entry,
    catalogEntry: catalog,
  };
}

/**
 * Uses Local / Play's folder and next-file matchers so a profile shortcut is
 * only available when Local would be able to open a real file for continuing.
 */
export async function isLocalMediaItemPlayable(
  item: LocalMediaItem,
  rootPath: string,
  rootEntries: LocalFolderEntry[],
): Promise<boolean> {
  if (item.libraryEntry.type === 'event') return false;
  if (!isInProgressStatus(item.status)) return false;

  const candidateTitles = [item.title, item.titleRomaji, item.titleNative].filter((value): value is string => !!value);
  let itemSeason = candidateTitles.reduce<number | null>((found, title) => found ?? extractTitleSeason(title), null);
  itemSeason = await resolveOwnSeasonNumber(item.externalId, item.title).catch(() => null) ?? itemSeason;

  const matchedFolder = findMatchingFolder(rootEntries, candidateTitles, itemSeason, item.externalId);
  const isReading = isReadingType(item.libraryEntry.type);
  const totalVolumes = item.catalogEntry?.total_count_2 ?? null;
  const hasDefinedVolumes = isReading && totalVolumes != null && totalVolumes > 0;
  const isMovie = item.libraryEntry.type === 'movie' || item.catalogEntry?.format === 'MOVIE';
  const isSingle = hasDefinedVolumes
    ? totalVolumes === 1
    : item.catalogEntry?.total_count === 1 || isMovie;
  const rootFile = isSingle && !matchedFolder
    ? findMatchingFile(rootEntries, candidateTitles, item.externalId)
    : null;

  let taggedPath: Awaited<ReturnType<typeof findTaggedPathRecursive>> = null;
  if (!matchedFolder && !rootFile) {
    taggedPath = await findTaggedPathRecursive(rootPath, item.externalId).catch(() => null);
  }
  if (taggedPath && !taggedPath.isDir) return true;

  const folderPath = matchedFolder
    ? `${rootPath}/${matchedFolder.name}`
    : taggedPath?.isDir ? taggedPath.absPath : null;
  let entries: LocalFolderEntry[] | null = folderPath
    ? await scanFolderContents(folderPath).catch(() => [] as LocalFolderEntry[])
    : null;

  if (folderPath && entries && !hasMediaFiles(entries)) {
    const subdirectories = entries.filter(entry => entry.is_dir);
    const childScans = await Promise.all(subdirectories.map(directory =>
      scanFolderContents(`${folderPath}/${directory.name}`).catch(() => [] as LocalFolderEntry[]),
    ));
    const mediaChildren = childScans.filter(hasMediaFiles);
    if (mediaChildren.length === 1) entries = mediaChildren[0];
  }

  if (!rootFile && (!entries || !hasMediaFiles(entries))) return false;

  const nextNumber = hasDefinedVolumes
    ? Math.floor(item.libraryEntry.progress_2 ?? 0) + 1
    : item.progress + 1;
  if (hasDefinedVolumes && entries && entries.filter(entry => !entry.is_dir && MEDIA_EXTENSIONS.test(entry.name)).length !== totalVolumes) return false;

  if (rootFile) return true;
  if (!entries) return false;
  if (isReading) {
    if (findMatchingEpisodeFile(entries, nextNumber, null)) return true;
    const mediaFiles = entries.filter(entry => !entry.is_dir && MEDIA_EXTENSIONS.test(entry.name))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
    return hasDefinedVolumes && nextNumber >= 1 && nextNumber <= mediaFiles.length
      ? true
      : !!soleMediaFile(entries);
  }

  const entriesHaveSeasonMarkers = entries.some(entry =>
    !entry.is_dir && MEDIA_EXTENSIONS.test(entry.name) && extractEpisodeInfo(entry.name)?.season != null,
  );
  let seasonOffset = 0;
  if (itemSeason != null && itemSeason > 1 && !entriesHaveSeasonMarkers) {
    const seasons = await resolveSeasonExternalIds(item.externalId, item.title, itemSeason).catch(() => ({}));
    let precedingTotal = 0;
    for (let season = 1; season < itemSeason; season++) {
      const count = seasons[season]?.totalCount;
      if (!count) { precedingTotal = 0; break; }
      precedingTotal += count;
    }
    seasonOffset = precedingTotal;
  }
  return !!findMatchingEpisodeFile(entries, nextNumber + seasonOffset, itemSeason)
    || (isSingle && !!soleMediaFile(entries));
}
