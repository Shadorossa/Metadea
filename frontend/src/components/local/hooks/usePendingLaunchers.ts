import { useEffect, useState, useMemo } from 'react';
import type { StatusEntry } from '../../../lib/local/catalog-game-linking';
import { getLauncherFromShopLinks, resolvePendingLauncher } from '../../../lib/local/pending-launcher-memo';
import { readLocalIgdbGameDetail } from '../../../lib/local/local-read-cache';

// Which pending ("Planeando", catalog-only, no matched local install) games
// belong to which launcher section — matched first via any already-resolved
// launchGame, then the catalog's own (locally cached) shop_links_csv, and
// finally IGDB's verdict for whatever's left unresolved: remembered for a
// week per game (lib/local/pending-launcher-memo.ts) and, within a visit,
// asked at most once (local-read-cache.ts) — this used to be one live
// igdb_get_game_detail request per such game on EVERY grid rebuild and
// rescan. Shared by GamesGrid (to render these into their launcher section)
// and LocalLibrary (to light up that platform's sidebar icon even when it
// has zero actually-installed games). "En progreso" entries are
// deliberately NOT considered here — that section stays one general list
// regardless of platform (same reasoning statusBuckets applies to installed
// games: only an in-progress status is a deliberate enough signal to
// surface in one place instead of splitting it per platform).
export function usePendingLaunchers(planningEntries: StatusEntry[]) {
  const [remoteByExternalId, setRemoteByExternalId] = useState<Record<string, string | undefined>>({});
  // Ids whose live IGDB check has actually finished (found a launcher or
  // not) — separate from remoteByExternalId itself, which only records the
  // ones that DID resolve to a launcher, so "no entry yet" can't be told
  // apart from "checked, and it's genuinely not on any known platform".
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());

  // Only entries that can't already be resolved from local data, and that
  // look like a real IGDB game id ("game:<n>", not "vnovel:<n>") — no point
  // spending a live API call otherwise.
  const idsNeedingRemoteCheck = useMemo(() => {
    const ids = new Set<string>();
    for (const entry of planningEntries) {
      if (entry.kind !== 'catalog') continue;
      if (entry.launchGame?.launcher) continue;
      if (getLauncherFromShopLinks(entry.item.catalogEntry?.shop_links_csv)) continue;
      if (!entry.item.externalId.startsWith('game:')) continue;
      ids.add(entry.item.externalId);
    }
    return Array.from(ids).sort().join(',');
  }, [planningEntries]);

  useEffect(() => {
    if (!idsNeedingRemoteCheck) { setRemoteByExternalId({}); setCheckedIds(new Set()); return; }
    const ids = idsNeedingRemoteCheck.split(',');
    // Reset to "still checking" for this exact id set right away — without
    // this, an id that was already checked+cleared under a PREVIOUS id set
    // (e.g. it briefly left the pending list and came back) would render as
    // "known, no launcher" for one frame before the fetch below redoes the
    // check, which is exactly the Pendientes-then-Nintendo flash this hook
    // exists to prevent.
    setCheckedIds(new Set());
    let cancelled = false;
    Promise.all(ids.map(id =>
      resolvePendingLauncher(id, readLocalIgdbGameDetail)
        .then(launcher => ({ id, launcher }))
        .catch(() => ({ id, launcher: undefined as string | undefined })),
    )).then(results => {
      if (cancelled) return;
      const map: Record<string, string | undefined> = {};
      for (const { id, launcher } of results) {
        if (launcher) map[id] = launcher;
      }
      setRemoteByExternalId(map);
      setCheckedIds(new Set(ids));
    });
    return () => { cancelled = true; };
  }, [idsNeedingRemoteCheck]);

  return useMemo(() => {
    const pendingByLauncher = new Map<string, StatusEntry[]>();

    const idsStillChecking = new Set(idsNeedingRemoteCheck ? idsNeedingRemoteCheck.split(',') : []);

    for (const entry of planningEntries) {
      if (entry.kind !== 'catalog') continue;
      const resolved = entry.launchGame?.launcher
        ?? getLauncherFromShopLinks(entry.item.catalogEntry?.shop_links_csv)
        ?? remoteByExternalId[entry.item.externalId];

      if (resolved) {
        if (!pendingByLauncher.has(resolved)) pendingByLauncher.set(resolved, []);
        pendingByLauncher.get(resolved)!.push(entry);
        continue;
      }

      // An entry whose live check hasn't finished yet is held out of every
      // launcher section until it resolves, so a Nintendo/Steam-bound game
      // never visibly sits in the wrong one for a frame.
      if (idsStillChecking.has(entry.item.externalId) && !checkedIds.has(entry.item.externalId)) continue;

      // Si no pertenece a otra plataforma específica, se asigna a Steam
      const fallbackLauncher = 'steam';
      if (!pendingByLauncher.has(fallbackLauncher)) pendingByLauncher.set(fallbackLauncher, []);
      pendingByLauncher.get(fallbackLauncher)!.push(entry);
    }

    return { pendingByLauncher };
  }, [planningEntries, remoteByExternalId, checkedIds, idsNeedingRemoteCheck]);
}
