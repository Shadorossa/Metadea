// The IPC-bound loading sequences behind MediaEditorModal's effects. Each
// one takes precomputed params and returns what it read; the component keeps
// every dispatch/setState of its own, except loadAllVersions — whose
// interleaved LOAD_LOG order is itself part of the behaviour.
import { getLibraryEntry, getCatalogEntry } from '../../../lib/tauri';
import type { LibraryEntry } from '../../../lib/tauri';
import { igdbGetLocalizedCovers } from '../../../lib/tauri/igdb';
import { getApiSportsEventMatches } from '../../../lib/tauri/misc-commands';
import { fetchApiSportsSeasonMatches } from '../../../lib/search/providers/apisports';
import { isSeriesSeasonSyntheticId, seriesSeasonExternalId } from '../../../lib/media/mapper-utils';
import { parseDelimitedString } from '../../../lib/shared/string-utils';
import { createEmptyVersionEntry, type EntryAction } from '../../../lib/media/log-state';
import type { MediaPageData, MediaSeasonInfo } from '../../../lib/media/types';
import type { SagaEntry } from '../../../lib/anilist/saga';
import { extractExternalIdFromRelationUrl } from './media-editor-helpers';

export interface CoverCandidate {
  externalId: string;
  title: string;
  cover?: string;
}

export interface SeasonMeta {
  title: string;
  cover?: string;
  totalCount?: number | null;
}

export type MonthMediaInfo = Record<string, { title: string; cover: string }>;

export async function fetchMonthMediaInfo(missing: string[]): Promise<(readonly [string, { title: string; cover: string }])[]> {
  return Promise.all(missing.map(async id => {
    if (isSeriesSeasonSyntheticId(id)) {
      const match = id.match(/^(.*):season:(\d+)$/);
      const baseId = match?.[1];
      const seasonNumber = match?.[2];
      const baseEntry = baseId ? await getCatalogEntry(baseId) : null;
      return [id, {
        title: `${baseEntry?.title_main ?? baseId ?? id} · T${seasonNumber ?? '?'}`,
        cover: baseEntry?.cover_url ?? '',
      }] as const;
    }
    const catalogEntry = await getCatalogEntry(id);
    return [id, {
      title: catalogEntry?.title_main ?? id,
      cover: catalogEntry?.cover_url ?? '',
    }] as const;
  }));
}

export async function fetchCoverCandidates(
  { externalId, baseId, type, titleMain, cover }:
  { externalId: string; baseId: string; type: string; titleMain: string; cover?: string },
): Promise<CoverCandidate[]> {
  const candidates = new Map<string, CoverCandidate>();
  const add = (candidate: CoverCandidate) => {
    if (candidate.cover || candidate.externalId === baseId) candidates.set(candidate.externalId, candidate);
  };

  // Only show the current, visible game here. A blocked work may be
  // opened explicitly in PrEditorModal to manage its block state, but it
  // must not leak into another game's cover picker.
  add({ externalId, title: titleMain, cover });

  if (type === 'game') {
    const gameIds = [...new Set([...candidates.keys()])].filter(id => /^game:\d+$/.test(id));
    const localizedByGame = await Promise.all(gameIds.map(async id => ({
      id,
      covers: await igdbGetLocalizedCovers(Number(id.slice('game:'.length))).catch(() => []),
    })));
    for (const { id, covers } of localizedByGame) {
      const owner = candidates.get(id);
      covers.forEach((localizedCover, index) => add({
        externalId: `${id}:localized-cover:${index}`,
        title: `${owner?.title || id} cover ${index + 1}`,
        cover: localizedCover,
      }));
    }
  }

  return [...candidates.values()];
}

export async function fetchAnimeSeasonChainLogs(chain: SagaEntry[]): Promise<{ id: string; lib: LibraryEntry | null; meta: SeasonMeta }[]> {
  const results = await Promise.all(chain.map(async s => {
    const [lib, cat] = await Promise.all([
      getLibraryEntry(s.externalId).catch(() => null),
      getCatalogEntry(s.externalId).catch(() => null),
    ]);
    return { id: s.externalId, lib, cat, s };
  }));
  return results.map(r => ({
    id: r.id,
    lib: r.lib,
    meta: {
      title: r.cat?.title_main || r.s.title,
      cover: r.cat?.cover_url || r.s.cover || undefined,
      totalCount: r.cat?.total_count ?? null,
    },
  }));
}

export async function fetchEventSeasonLogs(seasons: MediaSeasonInfo[]): Promise<({ id: string; lib: LibraryEntry | null; meta: SeasonMeta } | null)[]> {
  return Promise.all(seasons.map(async season => {
    const id = season.externalId;
    if (!id) return null;
    const [lib, cat, matchCache] = await Promise.all([
      getLibraryEntry(id).catch(() => null),
      getCatalogEntry(id).catch(() => null),
      getApiSportsEventMatches(id).catch(() => ({ syncedAt: null, matches: [] })),
    ]);
    const matchCount = matchCache.syncedAt
      ? matchCache.matches.length
      : cat?.total_count && cat.total_count > 0
        ? cat.total_count
        : (await fetchApiSportsSeasonMatches(id).catch(() => [])).length;
    return {
      id,
      lib,
      meta: {
        title: cat?.title_main || season.name || id,
        cover: cat?.cover_url || season.coverUrl || undefined,
        totalCount: matchCount,
      },
    };
  }));
}

export async function fetchSeriesSeasonLogs(externalId: string, seasons: MediaSeasonInfo[]): Promise<{ id: string; lib: LibraryEntry | null }[]> {
  return Promise.all(seasons.map(async s => {
    const id = seriesSeasonExternalId(externalId, s.seasonNumber);
    const lib = await getLibraryEntry(id).catch(() => null);
    return { id, lib };
  }));
}

export async function loadAllVersions(
  bId: string,
  data: MediaPageData,
  initialActiveLogId: string | undefined,
  dispatchEntry: (action: EntryAction) => void,
): Promise<void> {
  try {
    // 1. Load the base game
    const baseEntry = await getLibraryEntry(bId);
    if (baseEntry) {
      dispatchEntry({ type: 'LOAD_LOG', id: bId, entry: baseEntry });
    }

    // 2. Gather related-id candidates (remakes, remasters, etc.) to look up saved logs for
    const candidates = new Set<string>();
    if (data.parentGame) {
      candidates.add(data.parentGame.externalId);
    }
    for (const rel of (data.relations || [])) {
      const relExternalId = extractExternalIdFromRelationUrl(rel.url);
      if (relExternalId && relExternalId !== bId) {
        candidates.add(relExternalId);
      }
    }

    // 3. Load existing logs for the candidates — in parallel, not one
    // Tauri IPC round-trip at a time.
    await Promise.all([...candidates].map(async candId => {
      const ev = await getLibraryEntry(candId);
      if (ev) {
        dispatchEntry({ type: 'LOAD_LOG', id: candId, entry: ev });
      }
    }));

    // 4. If the base game has versions explicitly linked via
    // selected_version that weren't already loaded as candidates,
    // initialize them empty — also in parallel.
    if (baseEntry && baseEntry.selected_version) {
      await Promise.all(parseDelimitedString(baseEntry.selected_version).map(async versionId => {
        const ev = await getLibraryEntry(versionId);
        dispatchEntry({ type: 'LOAD_LOG', id: versionId, entry: ev ?? createEmptyVersionEntry(versionId) });
      }));
    }
    if (initialActiveLogId) {
      dispatchEntry({ type: 'SWITCH_LOG', id: initialActiveLogId });
    }
  } catch (err) {
    console.error('Failed to load base and versions', err);
  }
}
