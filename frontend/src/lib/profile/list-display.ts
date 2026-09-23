import type { CatalogSummary, ListItemFull, FavoriteCustomImage } from '../tauri';
import { wrapAssetUrl } from '../tauri/bridge';
import { HOF_GRADIENTS } from './hof';

export function fallbackGradient(type: string | null | undefined): string {
  return HOF_GRADIENTS[type ?? 'anime'] ?? 'linear-gradient(160deg,#374151,#1f2937)';
}

export function nextUntitledListName(existingNames: string[], base: string): string {
  const taken = new Set(existingNames);
  if (!taken.has(base)) return base;
  let n = 1;
  while (taken.has(`${base} ${n}`)) n++;
  return `${base} ${n}`;
}

export interface ListItemDisplay {
  cover: string;
  /** The work whose own cover `cover` is (null for a custom image, a
   *  character or an episode) — what the textless-cover swap keys on. */
  coverWorkId: string | null;
  isEpItem: boolean;
  url: string;
  epBadge: string | null;
  title: string;
}

export type ListSortMode = 'custom' | 'alphabetical' | 'release';

export function sortListItems(
  items: ListItemFull[],
  mode: ListSortMode,
  catalogMap: Map<string, CatalogSummary>,
): ListItemFull[] {
  if (mode === 'custom') return items;
  return [...items].sort((a, b) => {
    if (mode === 'alphabetical') {
      return (a.title_main ?? a.external_id).localeCompare(b.title_main ?? b.external_id);
    }

    const aMeta = catalogMap.get(a.external_id);
    const bMeta = catalogMap.get(b.external_id);
    const aDate = aMeta?.release_year
      ? aMeta.release_year * 10000 + (aMeta.release_month ?? 1) * 100 + (aMeta.release_day ?? 1)
      : Number.POSITIVE_INFINITY;
    const bDate = bMeta?.release_year
      ? bMeta.release_year * 10000 + (bMeta.release_month ?? 1) * 100 + (bMeta.release_day ?? 1)
      : Number.POSITIVE_INFINITY;
    return aDate - bDate || a.position - b.position;
  });
}

// Pure derivation from an item + the list's own type/custom-cover overrides
// — used identically by the sortable grid card and its DragOverlay preview,
// so a dragged card doesn't need its own separate "what does this look like"
// logic.
export function resolveListItemDisplay(
  item: ListItemFull, isCharacters: boolean, isEpisodes: boolean, customImagesMap?: Map<string, FavoriteCustomImage>,
): ListItemDisplay {
  const custom = customImagesMap?.get(item.external_id);
  // A character item's cover_url (getListItemsFullLight) is a local file
  // path; media covers are remote URLs that wrapAssetUrl passes through.
  const cover = custom ? wrapAssetUrl(custom.image_url) : wrapAssetUrl(item.cover_url ?? '');
  const isCharItem = item.external_id.startsWith('character:') || isCharacters;
  const isEpItem = item.external_id.startsWith('episode:') || isEpisodes;

  let url = `/media?id=${encodeURIComponent(item.external_id)}`;
  let epBadge: string | null = null;
  const title = item.title_main ?? item.external_id;

  if (isCharItem) {
    url = `/character?id=${encodeURIComponent(item.external_id)}`;
  } else if (isEpItem) {
    const parts = item.external_id.split(':');
    // episode:<type>:<numericId>:<season>:<episode>
    if (parts.length >= 5) {
      const parentId = `${parts[1]}:${parts[2]}`;
      const sNum = parseInt(parts[3], 10);
      const epNum = parts[4];
      url = `/media?id=${encodeURIComponent(parentId)}`;
      epBadge = sNum > 0 ? `T${sNum} E${epNum}` : `Ep. ${epNum}`;
    }
  }
  const coverWorkId = custom || isCharItem || isEpItem ? null : item.external_id;
  return { cover, coverWorkId, isEpItem, url, epBadge, title };
}
