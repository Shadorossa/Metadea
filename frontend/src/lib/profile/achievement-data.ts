import {
  getCatalogEntriesFullByIds,
  getMediaRelationsForIds,
  getSagaNames,
  raGetGameProgress,
  raGetLink,
  readMetadataIndex,
  steamGetCachedAchievements,
  steamGetOwnedGames,
  wrapAssetUrl,
  type CatalogSummary,
  type DbMediaRelation,
  type LocalGame,
  type RaGameProgress,
  type SteamPlayerAchievements,
} from '../tauri';
import { getCachedLibraryAndCatalog } from './library-data-cache';
import { steamAppIdFromUrl } from '../media/ggdeals-link';
import { toMediumCover } from '../media/small-cover';
import { loadLocalSteamAchievements } from '../local/local-read-cache';
import { findSteamLegacyVariant } from '../local/steam-legacy';
import { mergeSteamEditionAchievements } from '../local/steam-achievements-merge';
import { compareByReleaseDate } from '../media/mappers/mapper-utils';
import { reconstructSagaOrder } from '../media/saga/saga-grouping';

export interface AchievementGame {
  id: string;
  externalId: string | null;
  title: string;
  cover: string;
  coverFallbacks: string[];
  steam: Awaited<ReturnType<typeof steamGetCachedAchievements>>;
  legacySteam?: SteamPlayerAchievements | null;
  retro: RaGameProgress | null;
}

interface AchievementCandidate {
  id: string;
  externalId: string | null;
  title: string;
  cover: string;
  steamIds: number[];
}

function steamIdFromCatalogLinks(links: string | null | undefined): string | null {
  for (const pair of (links ?? '').split(',')) {
    const separator = pair.indexOf('|');
    if (separator < 0 || pair.slice(0, separator).trim().toLowerCase() !== 'steam') continue;
    const appId = steamAppIdFromUrl(pair.slice(separator + 1));
    if (appId) return appId;
  }
  return null;
}

function gameSteamIds(links: string | null | undefined): number[] {
  const linked = steamIdFromCatalogLinks(links);
  const id = linked ? Number(linked) : 0;
  return Number.isSafeInteger(id) && id > 0 ? [id] : [];
}

export async function loadAchievements(): Promise<AchievementGame[]> {
  const { items, catalog } = await getCachedLibraryAndCatalog();
  const libraryGames = items.filter(item => item.type === 'game' || item.type === 'vnovel');
  const catalogById = new Map<string, CatalogSummary>(catalog.map(entry => [entry.external_id, entry]));
  const fullRows = await getCatalogEntriesFullByIds(libraryGames.map(game => game.external_id)).catch(() => []);
  const fullById = new Map(fullRows.map(entry => [entry.external_id, entry]));

  const candidates: AchievementCandidate[] = libraryGames.map(game => {
    const meta = fullById.get(game.external_id);
    const catalogMeta = catalogById.get(game.external_id);
    return {
      id: game.external_id,
      externalId: game.external_id,
      title: meta?.title_main || catalogMeta?.title_main || game.external_id,
      cover: toMediumCover(meta?.cover_url || catalogMeta?.cover_url),
      steamIds: gameSteamIds(meta?.shop_links_csv),
    };
  });

  // Include Steam-owned games too: many aren't explicitly registered in the
  // Metadea catalog, so a catalog-only pass silently misses their achievements.
  const ownedSteamGames = await steamGetOwnedGames().catch(() => null);
  const candidateBySteamId = new Map<number, AchievementCandidate>();
  const candidateByTitle = new Map(candidates.map(candidate => [normalizeGameTitle(candidate.title), candidate]));
  for (const candidate of candidates) {
    for (const steamId of candidate.steamIds) candidateBySteamId.set(steamId, candidate);
  }
  for (const owned of ownedSteamGames?.games ?? []) {
    if (owned.playtime_forever <= 0 && (owned.rtime_last_played ?? 0) <= 0) continue;
    const appId = Number(owned.appid);
    if (!Number.isSafeInteger(appId) || appId <= 0) continue;
    let candidate = candidateBySteamId.get(appId) ?? candidateByTitle.get(normalizeGameTitle(owned.name));
    if (candidate) {
      if (!candidate.steamIds.includes(appId)) candidate.steamIds.push(appId);
      candidateBySteamId.set(appId, candidate);
      continue;
    }
    candidate = {
      id: `steam:${appId}`,
      externalId: null,
      title: owned.name,
      cover: `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/library_600x900_2x.jpg`,
      steamIds: [appId],
    };
    candidates.push(candidate);
    candidateBySteamId.set(appId, candidate);
  }

  // Local's Steam cards use the app-id keyed cover downloaded into the
  // metadata cache. Prefer that same asset here: Steam's public library art
  // URLs are not present for every title and can fail even when Local has a
  // working cover on disk.
  const metadataIndex = await readMetadataIndex().catch(() => ({} as Awaited<ReturnType<typeof readMetadataIndex>>));
  for (const candidate of candidates) {
    const localCoverPath = candidate.steamIds
      .map(appId => metadataIndex[String(appId)]?.cover_path)
      .find((coverPath): coverPath is string => !!coverPath);
    if (localCoverPath) candidate.cover = wrapAssetUrl(localCoverPath);
  }

  const catalogIds = [...new Set(candidates.flatMap(candidate => candidate.externalId ? [candidate.externalId] : []))];
  const [sagaNames, sagaRelations] = await Promise.all([
    getSagaNames(catalogIds).catch(() => ({} as Record<string, string>)),
    getMediaRelationsForIds(catalogIds, ['RECOMMENDATION', 'PREQUEL', 'SEQUEL', 'PRECUELA', 'SECUELA', 'REMAKE']).catch(() => [] as DbMediaRelation[]),
  ]);
  const ownedByAppId = new Map((ownedSteamGames?.games ?? []).map(game => [game.appid, game]));
  const localSteamGames: LocalGame[] = [];
  const candidateByAppId = new Map<number, AchievementCandidate>();
  for (const candidate of candidates) {
    for (const appId of candidate.steamIds) {
      if (candidateByAppId.has(appId)) continue;
      candidateByAppId.set(appId, candidate);
      localSteamGames.push({
        name: ownedByAppId.get(appId)?.name ?? candidate.title,
        launcher: 'steam',
        app_id: String(appId),
      });
    }
  }
  const isRemakePair = (current: LocalGame, secondary: LocalGame) => {
    const currentId = candidateByAppId.get(Number(current.app_id))?.externalId;
    const secondaryId = candidateByAppId.get(Number(secondary.app_id))?.externalId;
    if ([currentId, secondaryId].some(id => id && fullById.get(id)?.format?.toUpperCase() === 'REMAKE')) return true;
    return sagaRelations.some(relation => relation.relation_type.toUpperCase() === 'REMAKE' && !!relation.media_external_id && !!relation.related_media_external_id && (
      (relation.media_external_id === currentId && relation.related_media_external_id === secondaryId) ||
      (relation.media_external_id === secondaryId && relation.related_media_external_id === currentId)
    ));
  };
  const legacyPairByCurrent = new Map<number, number>();
  const legacyAppIds = new Set<number>();
  for (const current of localSteamGames) {
    const secondary = findSteamLegacyVariant(current, localSteamGames, isRemakePair);
    if (!secondary?.app_id) continue;
    const currentAppId = Number(current.app_id);
    const secondaryAppId = Number(secondary.app_id);
    legacyPairByCurrent.set(currentAppId, secondaryAppId);
    legacyAppIds.add(secondaryAppId);
  }

  const loadedByCandidate = new Map<string, { steam: SteamPlayerAchievements | null; legacySteam?: SteamPlayerAchievements | null; retro: RaGameProgress | null }>();
  let cursor = 0;
  const worker = async () => {
    while (cursor < candidates.length) {
      const candidate = candidates[cursor++];
      const [steamResults, retroResult] = await Promise.all([
        Promise.all(candidate.steamIds.map(async id => {
          let result = await steamGetCachedAchievements(id).catch(() => null);
          await loadLocalSteamAchievements(id, fresh => { if (fresh) result = fresh; }).catch(() => {});
          return result;
        })),
        candidate.externalId
          ? raGetLink(candidate.externalId).then(link => link ? raGetGameProgress(link.raGameId).then(result => result.data) : null).catch(() => null)
          : Promise.resolve(null),
      ]);
      const steam = steamResults.find(result => !!result && result.total > 0 && result.list.length > 0) ?? null;
      const retro = retroResult && retroResult.total > 0 && retroResult.achievements.length > 0 ? retroResult : null;
      loadedByCandidate.set(candidate.id, { steam, retro });
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, candidates.length) }, worker));

  for (const [currentAppId, secondaryAppId] of legacyPairByCurrent) {
    const currentCandidate = candidateByAppId.get(currentAppId);
    const secondaryCandidate = candidateByAppId.get(secondaryAppId);
    if (!currentCandidate || !secondaryCandidate || currentCandidate.id === secondaryCandidate.id) continue;
    const currentData = loadedByCandidate.get(currentCandidate.id);
    const secondaryData = loadedByCandidate.get(secondaryCandidate.id);
    if (!currentData || !secondaryData) continue;
    currentData.legacySteam = secondaryData.steam;
    if (!currentData.retro) currentData.retro = secondaryData.retro;
    legacyAppIds.add(secondaryAppId);
  }

  const rows: AchievementGame[] = [];
  const consumed = new Set<string>();
  for (const candidate of candidates) {
    if (consumed.has(candidate.id)) continue;
    const data = loadedByCandidate.get(candidate.id);
    if (!data) continue;
    if (candidate.steamIds.length && candidate.steamIds.every(appId => legacyAppIds.has(appId))) continue;
    const legacyAppId = candidate.steamIds.map(appId => legacyPairByCurrent.get(appId)).find((id): id is number => id !== undefined);
    if (legacyAppId) {
      const legacyCandidate = candidateByAppId.get(legacyAppId);
      if (legacyCandidate && legacyCandidate.id !== candidate.id) consumed.add(legacyCandidate.id);
    }
    const steam = data.steam;
    const legacySteam = data.legacySteam ?? null;
    const retro = data.retro;
    const mergedUnlocked = mergeSteamEditionAchievements(steam, legacySteam).unlocked;
    if (mergedUnlocked + (retro?.unlocked ?? 0) === 0) continue;
    const coverFallbacks = candidate.steamIds.flatMap(appId => {
      const highResolution = `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/library_600x900_2x.jpg`;
      return [highResolution, highResolution.replace('_2x.jpg', '.jpg')];
    }).filter((cover, index, covers) => cover !== candidate.cover && covers.indexOf(cover) === index);
    rows.push({ id: candidate.id, externalId: candidate.externalId, title: candidate.title, cover: candidate.cover, coverFallbacks, steam, legacySteam, retro });
  }

  return sortAchievementGames(rows, sagaNames, sagaRelations, catalogById);
}

function normalizeGameTitle(title: string): string {
  return title.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function sortAchievementGames(
  rows: AchievementGame[],
  sagaNames: Record<string, string>,
  relations: DbMediaRelation[],
  catalogById: Map<string, CatalogSummary>,
): AchievementGame[] {
  const visibleIds = new Set(rows.flatMap(row => row.externalId ? [row.externalId] : []));
  const parent = new Map<string, string>();
  const find = (id: string): string => {
    const known = parent.get(id);
    if (!known) { parent.set(id, id); return id; }
    if (known === id) return id;
    const root = find(known);
    parent.set(id, root);
    return root;
  };
  const union = (a: string, b: string) => {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) parent.set(rootB, rootA);
  };

  for (const id of visibleIds) find(id);
  for (const relation of relations) {
    const type = relation.relation_type.toUpperCase();
    if (!['PREQUEL', 'SEQUEL', 'PRECUELA', 'SECUELA'].includes(type)) continue;
    const mediaId = relation.media_external_id;
    const relatedId = relation.related_media_external_id;
    if (mediaId && relatedId && visibleIds.has(mediaId) && visibleIds.has(relatedId)) {
      union(mediaId, relatedId);
    }
  }
  const idBySagaName = new Map<string, string>();
  for (const id of visibleIds) {
    const name = sagaNames[id]?.trim();
    if (!name) continue;
    const key = name.toLocaleLowerCase();
    const existing = idBySagaName.get(key);
    if (existing) union(existing, id);
    else idBySagaName.set(key, id);
  }

  const grouped = new Map<string, AchievementGame[]>();
  for (const row of rows) {
    const root = row.externalId ? find(row.externalId) : `standalone:${row.id}`;
    const group = grouped.get(root) ?? [];
    group.push(row);
    grouped.set(root, group);
  }

  const groups = Array.from(grouped.values()).map(group => {
    const ids = [...new Set(group.flatMap(row => row.externalId ? [row.externalId] : []))];
    const dateOrderedIds = ids.sort((a, b) =>
      compareByReleaseDate(catalogById.get(a) ?? {}, catalogById.get(b) ?? {}) ||
      (catalogById.get(a)?.title_main ?? '').localeCompare(catalogById.get(b)?.title_main ?? '', undefined, { sensitivity: 'base' }),
    );
    const relsById = new Map<string, DbMediaRelation[]>();
    for (const relation of relations) {
      if (!relation.media_external_id || !dateOrderedIds.includes(relation.media_external_id)) continue;
      const owned = relsById.get(relation.media_external_id) ?? [];
      owned.push(relation);
      relsById.set(relation.media_external_id, owned);
    }
    const orderedIds = reconstructSagaOrder(dateOrderedIds, dateOrderedIds.map(id => relsById.get(id) ?? []));
    const orderById = new Map(orderedIds.map((id, index) => [id, index]));
    const sorted = group.slice().sort((a, b) => {
      if (a.externalId && b.externalId && a.externalId !== b.externalId) {
        return (orderById.get(a.externalId) ?? Number.MAX_SAFE_INTEGER) - (orderById.get(b.externalId) ?? Number.MAX_SAFE_INTEGER);
      }
      return a.title.localeCompare(b.title, undefined, { sensitivity: 'base' });
    });
    const sagaName = ids.map(id => sagaNames[id]?.trim()).find(Boolean);
    const sagaLabel = sagaName ?? (orderedIds.length > 1 ? catalogById.get(orderedIds[0])?.title_main : undefined);
    return { sorted, label: sagaLabel ?? sorted[0]?.title ?? '' };
  });

  groups.sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }) ||
    (a.sorted[0]?.title.localeCompare(b.sorted[0]?.title ?? '', undefined, { sensitivity: 'base' }) ?? 0));
  return groups.flatMap(group => group.sorted);
}

