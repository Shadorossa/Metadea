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

const CHARACTER_CATALOG_FOLDER = 'Characters';

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
  return `${CATALOG_ROOT}/${catalogFolderForExternalId(externalId)}/${externalId.replace(/:/g, '-')}.json`;
}

// How many ':'-separated segments each type's externalId has — needed to
// invert catalogFilePath's "replace ':' with '-'" encoding, since a plain
// '-' split can't otherwise tell a segment separator from a '-' that was
// already part of the id itself (e.g. character ids like "a:171811").
// Every type not listed here defaults to the plain "<type>:<id>" shape.
const EXTERNAL_ID_SEGMENT_COUNTS: Record<string, number> = {
  character: 3, // character:<source>:<id>
};

// Inverse of catalogFilePath's filename convention: "<type>-<...>-<id>.json"
// back into "<type>:<...>:<id>". The first (segmentCount - 1) '-'-separated
// parts are taken as single segments, and everything after that is rejoined
// with '-' as the final segment — so a '-' inside the id itself (e.g. an
// AniList slug) survives the round trip.
export function externalIdFromFilename(filename: string): string {
  const bare = filename.replace(/\.json$/, '');
  const parts = bare.split('-');
  const type = parts[0];
  const segmentCount = EXTERNAL_ID_SEGMENT_COUNTS[type] ?? 2;
  if (parts.length < segmentCount) return bare.replace('-', ':');
  const headSegments = parts.slice(0, segmentCount - 1);
  const lastSegment = parts.slice(segmentCount - 1).join('-');
  return [...headSegments, lastSegment].join(':');
}

export const MEDIA_CATALOG_FOLDERS: readonly string[] = [...new Set(Object.values(MEDIA_TYPE_FOLDERS))];

export function catalogRootPath(folder: string): string {
  return `${CATALOG_ROOT}/${folder}`;
}
