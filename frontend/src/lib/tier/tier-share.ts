// A tier board as the shared share-image input (lib/share-image): rows top
// to bottom with the label colours the editor paints, covers resolved by the
// caller (textless preference, local files) and the pool as a count only.
import type { TierListShareData } from '../share-image/share-image-types';
import type { TierBoard, TierItemMeta } from './tier-board';
import { labelTextColor } from './tier-palette';

export interface TierShareOptions {
  title: string;
  description: string;
  /** Maps a stored cover to the one to draw. Identity when omitted. */
  resolveCover?: (id: string, cover: string) => string;
}

export function tierShareData(board: TierBoard, meta: ReadonlyMap<string, TierItemMeta>, options: TierShareOptions): TierListShareData {
  const { resolveCover } = options;
  return {
    title: options.title,
    description: options.description,
    unplacedCount: board.pool.length,
    tiers: board.rows.map(row => ({
      label: row.label,
      color: row.color,
      textColor: labelTextColor(row.color),
      items: row.items.map(id => {
        const m = meta.get(id);
        const cover = m?.cover ? (resolveCover?.(id, m.cover) ?? m.cover) : null;
        return { title: m?.title || id, coverUrl: cover || null, externalId: id };
      }),
    })),
  };
}
