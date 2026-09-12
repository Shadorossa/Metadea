import { useEffect, useState, useMemo } from 'react';
import { getMediaCompanies } from '../../../lib/tauri';
import type { StatusEntry } from '../utils/catalogGameLinking';

// Map IGDB platform names (from a catalog entry's shop_links_csv, e.g.
// "steam|url,epic|url") to our own launcher keys.
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

function getLauncherFromShopLinks(shopLinksCsv?: string | null): string | undefined {
  if (!shopLinksCsv) return undefined;
  const platforms = shopLinksCsv.split(',').map(p => p.split('|')[0]?.trim().toLowerCase());
  if (platforms.includes('steam')) return 'steam';
  for (const p of platforms) {
    const mapped = SHOP_LINK_PLATFORM_MAP[p];
    if (mapped) return mapped;
  }
  return undefined;
}

// Which pending (catalog-only, no matched local install) games belong to
// which launcher section — matched first via any already-resolved
// launchGame, then the catalog's own IGDB shop_links_csv, and finally (once
// loaded async below) whether Nintendo/PlayStation is the entry's own
// developer/publisher — same signal GameDetailPanel's "Ver en Nintendo" uses.
// Shared by VideojuegosGrid (to render these into their launcher section)
// and LocalLibrary (to light up that platform's sidebar icon even when it
// has zero actually-installed games).
export function usePendingLaunchers(currentlyEntries: StatusEntry[], planningEntries: StatusEntry[]) {
  const [companiesByExternalId, setCompaniesByExternalId] = useState<Record<string, string[]>>({});

  const externalIdsToCheck = useMemo(() => {
    const ids = new Set<string>();
    for (const entry of currentlyEntries) {
      if (entry.kind === 'catalog' && entry.item.catalogEntry) ids.add(entry.item.externalId);
    }
    for (const entry of planningEntries) {
      if (entry.kind === 'catalog' && entry.item.catalogEntry) ids.add(entry.item.externalId);
    }
    return Array.from(ids).sort().join(',');
  }, [currentlyEntries, planningEntries]);

  useEffect(() => {
    if (!externalIdsToCheck) return;
    const ids = externalIdsToCheck.split(',');
    const promises = ids.map(id =>
      getMediaCompanies(id)
        .then(companies => ({
          id,
          platforms: companies
            .filter(c => (c.role === 'developer' || c.role === 'publisher') && (
              c.name.toLowerCase().includes('nintendo') ||
              c.name.toLowerCase().includes('playstation') ||
              c.name.toLowerCase().includes('sony')
            ))
            .map(c => c.name.toLowerCase().includes('nintendo') ? 'nintendo' : 'playstation'),
        }))
        .catch(() => ({ id, platforms: [] as string[] })),
    );

    let cancelled = false;
    Promise.all(promises).then(results => {
      if (cancelled) return;
      const map: Record<string, string[]> = {};
      for (const { id, platforms } of results) {
        if (platforms.length > 0) map[id] = platforms;
      }
      setCompaniesByExternalId(map);
    });
    return () => { cancelled = true; };
  }, [externalIdsToCheck]);

  return useMemo(() => {
    const pendingByLauncher = new Map<string, StatusEntry[]>();
    const pendingWithLauncherIds = new Set<string>();

    const groupEntries = (entries: StatusEntry[]) => {
      for (const entry of entries) {
        if (entry.kind !== 'catalog') continue;
        const launcher = entry.launchGame?.launcher
          ?? getLauncherFromShopLinks(entry.item.catalogEntry?.shop_links_csv)
          ?? companiesByExternalId[entry.item.externalId]?.[0];
        if (!launcher) continue;
        if (!pendingByLauncher.has(launcher)) pendingByLauncher.set(launcher, []);
        pendingByLauncher.get(launcher)!.push(entry);
        pendingWithLauncherIds.add(entry.item.externalId);
      }
    };
    groupEntries(currentlyEntries);
    groupEntries(planningEntries);

    return { pendingByLauncher, pendingWithLauncherIds };
  }, [currentlyEntries, planningEntries, companiesByExternalId]);
}
