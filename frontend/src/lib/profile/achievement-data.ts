import {
  getCatalogEntriesFullByIds,
  getMediaRelationsForIds,
  getSagaNames,
  raGetCachedGameProgress,
  raGetGameProgress,
  raGetLink,
  readMetadataIndex,
  steamGetCachedAchievements,
  steamLang,
  wrapAssetUrl,
  type CatalogSummary,
  type DbMediaRelation,
  type LibraryEntry,
  type LocalGame,
  type MediaCatalogEntry,
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
import { loadSteamOwnedGames, readStoredSteamOwnedGames, type OwnedSteamGame } from '../local/steam-owned-games';

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

// Everything the list needs besides the owned-games list and the
// achievements themselves: local reads only, shared by both phases.
interface AchievementSources {
  libraryGames: LibraryEntry[];
  catalogById: Map<string, CatalogSummary>;
  fullById: Map<string, MediaCatalogEntry>;
  metadataIndex: Awaited<ReturnType<typeof readMetadataIndex>>;
  sagaNames: Record<string, string>;
  sagaRelations: DbMediaRelation[];
}

interface AchievementPlan {
  candidates: AchievementCandidate[];
  candidateByAppId: Map<number, AchievementCandidate>;
  legacyPairByCurrent: Map<number, number>;
  legacyAppIds: Set<number>;
}

interface LoadedAchievements {
  steamByAppId: Map<number, SteamPlayerAchievements | null>;
  raGameIdByExternalId: Map<string, number | null>;
  retroByExternalId: Map<string, RaGameProgress | null>;
}

// Two phases: 'cached' paints from disk only (the persisted Steam copies,
// RA's SQLite rows whatever their age, the stored owned-games list);
// 'live' then refreshes what is due through the network and replaces the
// rows. The live result is kept for ACHIEVEMENTS_LIVE_TTL_MS.
const ACHIEVEMENTS_LIVE_TTL_MS = 5 * 60 * 1000;
const CACHED_READ_CONCURRENCY = 8;
const LIVE_READ_CONCURRENCY = 4;

interface AchievementsCacheEntry {
  language: string;
  sources: Promise<AchievementSources>;
  cached: Promise<AchievementGame[]>;
  latest: Promise<AchievementGame[]>;
  loaded: LoadedAchievements | null;
  live: Promise<AchievementGame[]> | null;
  liveExpiresAt: number;
}

let achievementsCache: AchievementsCacheEntry | null = null;

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

/** The best rows available right now: disk-only on the first call, the
 *  live ones once refreshAchievements has resolved. */
export function loadAchievements(): Promise<AchievementGame[]> {
  return currentEntry().latest;
}

/** Refreshes through the network what is due (stale Steam copies, expired
 *  RA rows, the owned-games list) and resolves with the updated rows. */
export function refreshAchievements(): Promise<AchievementGame[]> {
  const entry = currentEntry();
  if (entry.live && entry.liveExpiresAt > Date.now()) return entry.live;

  const live = Promise.all([entry.sources, entry.cached, loadSteamOwnedGames()]).then(async ([sources, , owned]) => {
    const plan = planCandidates(sources, owned ?? []);
    const loaded = await readAchievementData(plan, 'live', entry.loaded);
    entry.loaded = loaded;
    return buildAchievementRows(sources, plan, loaded);
  });
  entry.live = live;
  entry.liveExpiresAt = Date.now() + ACHIEVEMENTS_LIVE_TTL_MS;
  live.then(
    () => { entry.latest = live; },
    () => { if (entry.live === live) entry.live = null; },
  );
  return live;
}

function currentEntry(): AchievementsCacheEntry {
  const language = steamLang();
  if (achievementsCache?.language === language) return achievementsCache;

  const sources = readAchievementSources();
  const entry: AchievementsCacheEntry = {
    language,
    sources,
    cached: Promise.resolve([]),
    latest: Promise.resolve([]),
    loaded: null,
    live: null,
    liveExpiresAt: 0,
  };
  entry.cached = sources.then(async loadedSources => {
    const plan = planCandidates(loadedSources, readStoredSteamOwnedGames() ?? []);
    const loaded = await readAchievementData(plan, 'cached', null);
    entry.loaded ??= loaded;
    return buildAchievementRows(loadedSources, plan, loaded);
  });
  entry.latest = entry.cached;
  achievementsCache = entry;
  entry.cached.catch(() => {
    if (achievementsCache === entry) achievementsCache = null;
  });
  return entry;
}

function invalidateAchievementsCache() {
  achievementsCache = null;
}

if (typeof window !== 'undefined') {
  window.addEventListener('refresh-profile-library', invalidateAchievementsCache);
  window.addEventListener('media-relations-changed', invalidateAchievementsCache);
  window.addEventListener('profile-achievements-changed', invalidateAchievementsCache);
}

function isPlayedOwnedGame(owned: OwnedSteamGame): boolean {
  return owned.playtime_forever > 0 || (owned.rtime_last_played ?? 0) > 0;
}

async function readAchievementSources(): Promise<AchievementSources> {
  const [{ items, catalog }, metadataIndex] = await Promise.all([
    getCachedLibraryAndCatalog(),
    readMetadataIndex().catch(() => ({} as Awaited<ReturnType<typeof readMetadataIndex>>)),
  ]);
  const libraryGames = items.filter(item => item.type === 'game' || item.type === 'vnovel');
  const catalogIds = [...new Set(libraryGames.map(game => game.external_id))];
  const [fullRows, sagaNames, sagaRelations] = await Promise.all([
    getCatalogEntriesFullByIds(catalogIds).catch(() => [] as MediaCatalogEntry[]),
    getSagaNames(catalogIds).catch(() => ({} as Record<string, string>)),
    getMediaRelationsForIds(catalogIds, ['RECOMMENDATION', 'PREQUEL', 'SEQUEL', 'REMAKE']).catch(() => [] as DbMediaRelation[]),
  ]);
  return {
    libraryGames,
    catalogById: new Map(catalog.map(entry => [entry.external_id, entry])),
    fullById: new Map(fullRows.map(entry => [entry.external_id, entry])),
    metadataIndex,
    sagaNames,
    sagaRelations,
  };
}

function planCandidates(sources: AchievementSources, ownedGames: OwnedSteamGame[]): AchievementPlan {
  const { libraryGames, catalogById, fullById, metadataIndex, sagaRelations } = sources;
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
  const candidateBySteamId = new Map<number, AchievementCandidate>();
  const candidateByTitle = new Map(candidates.map(candidate => [normalizeGameTitle(candidate.title), candidate]));
  for (const candidate of candidates) {
    for (const steamId of candidate.steamIds) candidateBySteamId.set(steamId, candidate);
  }
  for (const owned of ownedGames) {
    if (!isPlayedOwnedGame(owned)) continue;
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
  for (const candidate of candidates) {
    const localCoverPath = candidate.steamIds
      .map(appId => metadataIndex[String(appId)]?.cover_path)
      .find((coverPath): coverPath is string => !!coverPath);
    if (localCoverPath) candidate.cover = wrapAssetUrl(localCoverPath);
  }

  const ownedByAppId = new Map(ownedGames.map(game => [Number(game.appid), game]));
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

  return { candidates, candidateByAppId, legacyPairByCurrent, legacyAppIds };
}

async function runPool(tasks: Array<() => Promise<void>>, concurrency: number): Promise<void> {
  let cursor = 0;
  const worker = async () => {
    while (cursor < tasks.length) await tasks[cursor++]();
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, worker));
}

// 'cached' never touches the network. 'live' starts from `previous` (the
// copies a former phase already read) so each disk copy is read once, and
// only goes to the network for what is due.
async function readAchievementData(
  plan: AchievementPlan,
  mode: 'cached' | 'live',
  previous: LoadedAchievements | null,
): Promise<LoadedAchievements> {
  const loaded: LoadedAchievements = {
    steamByAppId: new Map(),
    raGameIdByExternalId: new Map(),
    retroByExternalId: new Map(),
  };
  const tasks: Array<() => Promise<void>> = [];

  for (const appId of plan.candidateByAppId.keys()) {
    tasks.push(async () => {
      if (mode === 'cached') {
        loaded.steamByAppId.set(appId, await steamGetCachedAchievements(appId).catch(() => null));
        return;
      }
      const cached = previous?.steamByAppId.get(appId);
      let result = cached ?? null;
      await loadLocalSteamAchievements(appId, fresh => { if (fresh) result = fresh; }, { cached }).catch(() => {});
      loaded.steamByAppId.set(appId, result);
    });
  }

  for (const candidate of plan.candidates) {
    const externalId = candidate.externalId;
    if (!externalId) continue;
    tasks.push(async () => {
      const raGameId = previous?.raGameIdByExternalId.has(externalId)
        ? previous.raGameIdByExternalId.get(externalId) ?? null
        : await raGetLink(externalId).then(link => link?.raGameId ?? null).catch(() => null);
      loaded.raGameIdByExternalId.set(externalId, raGameId);
      if (!raGameId) {
        loaded.retroByExternalId.set(externalId, null);
        return;
      }
      const retro = mode === 'cached'
        ? await raGetCachedGameProgress(raGameId).then(result => result?.data ?? null).catch(() => null)
        : await raGetGameProgress(raGameId).then(result => result.data).catch(() => previous?.retroByExternalId.get(externalId) ?? null);
      loaded.retroByExternalId.set(externalId, retro);
    });
  }

  await runPool(tasks, mode === 'cached' ? CACHED_READ_CONCURRENCY : LIVE_READ_CONCURRENCY);
  return loaded;
}

function buildAchievementRows(sources: AchievementSources, plan: AchievementPlan, loaded: LoadedAchievements): AchievementGame[] {
  const { candidates, candidateByAppId, legacyPairByCurrent } = plan;
  const legacyAppIds = new Set(plan.legacyAppIds);

  const loadedByCandidate = new Map<string, { steam: SteamPlayerAchievements | null; legacySteam?: SteamPlayerAchievements | null; retro: RaGameProgress | null }>();
  for (const candidate of candidates) {
    const steam = candidate.steamIds
      .map(appId => loaded.steamByAppId.get(appId) ?? null)
      .find(result => !!result && result.total > 0 && result.list.length > 0) ?? null;
    const retroResult = candidate.externalId ? loaded.retroByExternalId.get(candidate.externalId) ?? null : null;
    const retro = retroResult && retroResult.total > 0 && retroResult.achievements.length > 0 ? retroResult : null;
    loadedByCandidate.set(candidate.id, { steam, retro });
  }

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

  return sortAchievementGames(rows, sources.sagaNames, sources.sagaRelations, sources.catalogById);
}

function normalizeGameTitle(title: string): string {
  return title.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
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
    if (type !== 'PREQUEL' && type !== 'SEQUEL') continue;
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
