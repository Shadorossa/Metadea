// Where a collaborative-catalog proposal file lives in the repo, one
// subfolder per media type (plus a standalone one for characters, which have
// no owning media_catalog row of their own). Mirrors the folder layout
// scripts/build-database.js walks and .github/workflows/update-database.yml
// watches — keep both in sync by hand if this changes.
const CATALOG_ROOT = 'catalog';

const MEDIA_TYPE_FOLDERS: Record<string, string> = {
  anime: 'Anime',
  manga: 'Manga',
  lnovel: 'LightNovels',
  game: 'Games',
  vnovel: 'VisualNovels',
  movie: 'Movies',
  series: 'Series',
  book: 'Books',
  comic: 'Comics',
};

export const CHARACTER_CATALOG_FOLDER = 'Characters';

// externalId is always "<type>:<id>" (media) or "character:<id>" — the type
// prefix before the first ':' is what picks the folder.
export function catalogFolderForExternalId(externalId: string): string {
  const type = externalId.split(':')[0];
  if (type === 'character') return CHARACTER_CATALOG_FOLDER;
  return MEDIA_TYPE_FOLDERS[type] || type;
}

// Same filename convention as before the folder split (externalId with ':'
// replaced by '-'), just nested one level deeper under its type's folder.
export function catalogFilePath(externalId: string): string {
  return `${CATALOG_ROOT}/${catalogFolderForExternalId(externalId)}/${externalId.replace(':', '-')}.json`;
}

export const MEDIA_CATALOG_FOLDERS: readonly string[] = [...new Set(Object.values(MEDIA_TYPE_FOLDERS))];

export const ALL_CATALOG_FOLDERS: readonly string[] = [...MEDIA_CATALOG_FOLDERS, CHARACTER_CATALOG_FOLDER];

export function catalogRootPath(folder: string): string {
  return `${CATALOG_ROOT}/${folder}`;
}
