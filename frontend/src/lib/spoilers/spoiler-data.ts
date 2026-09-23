// The one read the spoiler shield needs: library rows, catalog rows and the
// chain relations around them — exactly the bundle the profile/home views
// already share (lib/profile/library-data-cache.ts), so a visit that has it
// cached pays nothing and no provider API is ever called. Memoised per
// bundle: the cache itself drops on library/relation writes, and the next
// read rebuilds the input from the fresh rows.
import { getCachedLibraryAndCatalog, getCachedMediaRelations } from '../profile/library-data-cache';
import { getMediaCharacters } from '../tauri/characters';
import { MEDIA_PART_CHANGED_EVENT, type MediaPartChangedDetail } from '../tauri/change-events';
import type { SpoilerIndexInput } from './spoiler-franchises';

type BaseInput = Omit<SpoilerIndexInput, 'currentYear'>;

let lastBundle: { items: unknown; relations: unknown; input: BaseInput } | null = null;

export async function loadSpoilerIndexInput(): Promise<BaseInput> {
  const [{ items, catalog }, relations] = await Promise.all([getCachedLibraryAndCatalog(), getCachedMediaRelations()]);
  if (lastBundle && lastBundle.items === items && lastBundle.relations === relations) return lastBundle.input;
  const input: BaseInput = { library: items, catalog, relations };
  lastBundle = { items, relations, input };
  return input;
}

// Cast lists per work, read once per visit (local rows only; empty when the
// work's page was never opened, which lateDebutCastIds treats as unknown).
const castCache = new Map<string, Promise<Set<string> | null>>();

function loadCastIds(workId: string): Promise<Set<string> | null> {
  let pending = castCache.get(workId);
  if (!pending) {
    pending = getMediaCharacters(workId)
      .then(rows => {
        if (rows.length === 0) return null;
        const ids = new Set<string>();
        for (const row of rows) {
          ids.add(row.external_id);
          if (row.merged_character_external_id) ids.add(row.merged_character_external_id);
        }
        return ids;
      })
      .catch(() => null);
    castCache.set(workId, pending);
  }
  return pending;
}

// Cap on how many started works are read for one comparison.
const MAX_CAST_WORKS = 12;

/** Every character id cast in any of `workIds`, or null when one of those
 *  cast lists is not cached locally. */
export async function loadKnownCastIds(workIds: readonly string[]): Promise<Set<string> | null> {
  if (workIds.length === 0 || workIds.length > MAX_CAST_WORKS) return null;
  const lists = await Promise.all(workIds.map(loadCastIds));
  const known = new Set<string>();
  for (const list of lists) {
    if (list === null) return null;
    for (const id of list) known.add(id);
  }
  return known;
}

if (typeof window !== 'undefined') {
  // A media page visit re-saves its cast; forget what was read before.
  window.addEventListener(MEDIA_PART_CHANGED_EVENT, event => {
    if ((event as CustomEvent<MediaPartChangedDetail>).detail?.part === 'characters') castCache.clear();
  });
}
