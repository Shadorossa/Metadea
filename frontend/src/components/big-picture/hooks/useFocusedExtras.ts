import { useEffect, useState } from 'react';
import type { LocalGame } from '../../../lib/tauri';
import { raGetGameProgress, raGetLink } from '../../../lib/tauri/retro-achievements';
import { memoLocalRead, readLocalFullCatalogEntries, readLocalSteamCachedAchievements } from '../../../lib/local/local-read-cache';
import { firstCsvUrl } from '../../../lib/media/mappers/mapper-utils';
import type { BigPictureItem } from '../../../lib/big-picture/categories';

// Rapid D-pad scrolling must not fire a read per card passed over.
const SETTLE_MS = 350;

export interface FocusedAchievements {
  source: 'steam' | 'retro';
  unlocked: number;
  total: number;
  points?: { unlocked: number; total: number };
}

export interface FocusedExtras {
  key: string;
  achievements: FocusedAchievements | null;
  /** Wide banner art for a work (the grid only has its portrait cover). */
  banner: string | null;
}

async function loadAchievements(item: BigPictureItem, game: LocalGame | undefined): Promise<FocusedAchievements | null> {
  if (!game) return null;
  if (game.launcher === 'steam' && game.app_id) {
    // Disk only (the last merged Steam result) — browsing stays offline.
    const cached = await readLocalSteamCachedAchievements(Number(game.app_id)).catch(() => null);
    return cached && cached.total > 0 ? { source: 'steam', unlocked: cached.unlocked, total: cached.total } : null;
  }
  if (item.romPlatform && item.externalId) {
    const externalId = item.externalId;
    const progress = await memoLocalRead('big-picture-retro', externalId, async () => {
      const link = await raGetLink(externalId);
      return link ? raGetGameProgress(link.raGameId) : null;
    }).catch(() => null);
    const data = progress?.data;
    return data && data.total > 0
      ? { source: 'retro', unlocked: data.unlocked, total: data.total, points: { unlocked: data.pointsUnlocked, total: data.pointsTotal } }
      : null;
  }
  return null;
}

async function loadBanner(item: BigPictureItem): Promise<string | null> {
  if (item.kind !== 'media' || !item.externalId) return null;
  const rows = await readLocalFullCatalogEntries([item.externalId]).catch(() => null);
  return firstCsvUrl(rows?.get(item.externalId)?.banners_csv) ?? null;
}

/** Achievements summary and banner of the focused item, read once focus
 *  has settled. Results for a previous item are ignored (keyed). */
export function useFocusedExtras(item: BigPictureItem | null, game: LocalGame | undefined): FocusedExtras | null {
  const [extras, setExtras] = useState<FocusedExtras | null>(null);
  useEffect(() => {
    if (!item) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      Promise.all([loadAchievements(item, game), loadBanner(item)]).then(([achievements, banner]) => {
        if (!cancelled) setExtras({ key: item.key, achievements, banner });
      });
    }, SETTLE_MS);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [item, game]);
  return extras && item && extras.key === item.key ? extras : null;
}
