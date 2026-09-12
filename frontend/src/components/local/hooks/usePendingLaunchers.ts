import { useEffect, useState, useMemo } from 'react';
import { igdbGetGameDetail } from '../../../lib/tauri';
import type { StatusEntry } from '../utils/catalogGameLinking';

// Map IGDB platform names (from a catalog entry's shop_links_csv, e.g.
// "steam|url,epic|url", or a live IGDB detail's store_links) to our own
// launcher keys.
const SHOP_LINK_PLATFORM_MAP: Record<string, string> = {
  steam:                 'steam',
  'epic games store':    'epic',
  epic:                  'epic',
  gog:                   'gog',
  xbox:                  'xbox',
  'xbox game pass':      'xbox',
  ea:                    'ea',
  'ea app':              'ea',
  origin:                'ea',
  nintendo:              'nintendo',
  'nintendo eshop':      'nintendo',
  playstation:           'playstation',
  'playstation store':   'playstation',
};

function launcherFromPlatformName(name?: string | null): string | undefined {
  if (!name) return undefined;
  return SHOP_LINK_PLATFORM_MAP[name.trim().toLowerCase()];
}

function getLauncherFromShopLinks(shopLinksCsv?: string | null): string | undefined {
  if (!shopLinksCsv) return undefined;
  const platforms = shopLinksCsv.split(',').map(p => p.split('|')[0]);
  if (platforms.some(p => p?.trim().toLowerCase() === 'steam')) return 'steam';
  for (const p of platforms) {
    const mapped = launcherFromPlatformName(p);
    if (mapped) return mapped;
  }
  return undefined;
}

// Same signal GameDetailPanel's "Ver en Steam"/"Ver en Nintendo" already
// uses (IGDB's own store_links + involved_companies) — a LIVE fetch, not a
// local-DB read, since shop_links_csv/companies only ever get persisted
// locally once the user has actually opened this entry's own /media page at
// least once (see mediaService.ts's persistToCatalog). Most "Pendiente"
// entries never had that happen, so relying on local data alone left them
// stuck without a launcher (e.g. a Steam-only game staying in "Pendientes"
// instead of moving into the Steam section) even though IGDB has the answer.
function launcherFromIgdbDetail(detail: Record<string, unknown> | null): string | undefined {
  if (!detail) return undefined;
  const links = detail.store_links as { platform?: string }[] | undefined;
  if (links?.some(l => l.platform?.trim().toLowerCase() === 'steam')) return 'steam';
  for (const l of links ?? []) {
    const mapped = launcherFromPlatformName(l.platform);
    if (mapped) return mapped;
  }
  const companies = detail.involved_companies as { company?: { name?: string }; developer?: boolean; publisher?: boolean }[] | undefined;
  for (const c of companies ?? []) {
    if (!(c.developer || c.publisher)) continue;
    const name = c.company?.name?.toLowerCase() ?? '';
    if (name.includes('nintendo')) return 'nintendo';
    if (name.includes('playstation') || name.includes('sony')) return 'playstation';
  }
  return undefined;
}

// Which pending (catalog-only, no matched local install) games belong to
// which launcher section — matched first via any already-resolved
// launchGame, then the catalog's own (locally cached) shop_links_csv, and
// finally a live IGDB lookup for whatever's left unresolved. Shared by
// VideojuegosGrid (to render these into their launcher section) and
// LocalLibrary (to light up that platform's sidebar icon even when it has
// zero actually-installed games).
export function usePendingLaunchers(currentlyEntries: StatusEntry[], planningEntries: StatusEntry[]) {
  const [remoteByExternalId, setRemoteByExternalId] = useState<Record<string, string | undefined>>({});

  // Only entries that can't already be resolved from local data, and that
  // look like a real IGDB game id ("game:<n>", not "vnovel:<n>") — no point
  // spending a live API call otherwise.
  const idsNeedingRemoteCheck = useMemo(() => {
    const ids = new Set<string>();
    const consider = (entries: StatusEntry[]) => {
      for (const entry of entries) {
        if (entry.kind !== 'catalog') continue;
        if (entry.launchGame?.launcher) continue;
        if (getLauncherFromShopLinks(entry.item.catalogEntry?.shop_links_csv)) continue;
        if (!entry.item.externalId.startsWith('game:')) continue;
        ids.add(entry.item.externalId);
      }
    };
    consider(currentlyEntries);
    consider(planningEntries);
    return Array.from(ids).sort().join(',');
  }, [currentlyEntries, planningEntries]);

  useEffect(() => {
    if (!idsNeedingRemoteCheck) { setRemoteByExternalId({}); return; }
    const ids = idsNeedingRemoteCheck.split(',');
    let cancelled = false;
    Promise.all(ids.map(id => {
      const igdbId = Number(id.split(':')[1]);
      if (!igdbId) return Promise.resolve({ id, launcher: undefined as string | undefined });
      return igdbGetGameDetail(igdbId)
        .then(detail => ({ id, launcher: launcherFromIgdbDetail(detail) }))
        .catch(() => ({ id, launcher: undefined as string | undefined }));
    })).then(results => {
      if (cancelled) return;
      const map: Record<string, string | undefined> = {};
      for (const { id, launcher } of results) {
        if (launcher) map[id] = launcher;
      }
      setRemoteByExternalId(map);
    });
    return () => { cancelled = true; };
  }, [idsNeedingRemoteCheck]);

  return useMemo(() => {
    const pendingByLauncher = new Map<string, StatusEntry[]>();
    const pendingWithLauncherIds = new Set<string>();

    const groupEntries = (entries: StatusEntry[]) => {
      for (const entry of entries) {
        if (entry.kind !== 'catalog') continue;
        const launcher = entry.launchGame?.launcher
          ?? getLauncherFromShopLinks(entry.item.catalogEntry?.shop_links_csv)
          ?? remoteByExternalId[entry.item.externalId];
        if (!launcher) continue;
        if (!pendingByLauncher.has(launcher)) pendingByLauncher.set(launcher, []);
        pendingByLauncher.get(launcher)!.push(entry);
        pendingWithLauncherIds.add(entry.item.externalId);
      }
    };
    groupEntries(currentlyEntries);
    groupEntries(planningEntries);

    return { pendingByLauncher, pendingWithLauncherIds };
  }, [currentlyEntries, planningEntries, remoteByExternalId]);
}
