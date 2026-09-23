// Pure derivations behind MediaEditorModal's version tabs and its unified
// "general" tab aggregates — all of them functions of already-computed
// values, none of them touching component state.
import { CONTAINS_RELATION_TYPES } from '../../../lib/media/saga/saga-relation-types';
import type { LogState } from '../../../lib/media/editor/library-log-state';
import type { MediaRelation } from '../../../lib/media/types';
import type { SagaEntry } from '../../../lib/anilist/saga';
import { extractExternalIdFromRelationUrl, isFutureDate } from './media-editor-helpers';

export interface AvailableEdition {
  externalId: string;
  label: string;
  cover?: string;
  relationType?: string;
  isBundleChild?: boolean;
  isSeasonTab?: boolean;
}

export function buildAvailableEditions(
  { baseId, externalId, titleMain, cover, relations, animeSeasonChain, isUnifiedAnime, sagaUsesOnlySeasonMedia }: {
    baseId: string;
    externalId: string;
    titleMain: string;
    cover?: string;
    relations: MediaRelation[] | undefined;
    animeSeasonChain: SagaEntry[];
    isUnifiedAnime: boolean;
    sagaUsesOnlySeasonMedia: boolean;
  },
): AvailableEdition[] {
  const list: AvailableEdition[] = [];
  // A saga edge is authoritative for chronology. Some IGDB records also
  // expose the same work through a broad remakes/remasters array, which
  // must not turn a PREQUEL/SEQUEL into an edition tab (FFVII Rebirth and
  // Revelation are examples of this false overlap).
  const sagaRelatedIds = new Set(
    (relations || [])
      .filter(rel => rel.relationType === 'PREQUEL' || rel.relationType === 'SEQUEL')
      .map(rel => rel.relatedExternalId ?? extractExternalIdFromRelationUrl(rel.url))
      .filter((id): id is string => !!id),
  );
  for (const rel of (relations || [])) {
    if (rel.relationType && ['EXPANDED_GAME', 'REMASTER', 'REMAKE', 'FORK', 'PORT'].includes(rel.relationType)) {
      const relExternalId = rel.relatedExternalId ?? extractExternalIdFromRelationUrl(rel.url);
      if (relExternalId && !sagaRelatedIds.has(relExternalId) && relExternalId !== baseId && !list.some(item => item.externalId === relExternalId)) {
        list.push({ externalId: relExternalId, label: rel.title, cover: rel.cover, relationType: rel.relationType });
      }
    }
  }
  // A bundle's own "editar" should let the user track each contained work
  // separately — Final Fantasy VII Remake Intergrade's base game AND its
  // INTERmission DLC — instead of only the bundle as one lump. Labeled by
  // its own real title, same as every other edition tab above (the
  // generic Juego/DLC/Part-N shorthand belongs to NeighborsRow's compact
  // thumbnail row instead — see bundleLabels.ts).
  const bundleRels = (relations || []).filter(rel => rel.relationType && CONTAINS_RELATION_TYPES.includes(rel.relationType));
  bundleRels.forEach(rel => {
    const relExternalId = rel.relatedExternalId ?? extractExternalIdFromRelationUrl(rel.url);
    if (relExternalId && relExternalId !== baseId && !list.some(item => item.externalId === relExternalId)) {
      list.push({ externalId: relExternalId, label: rel.title, cover: rel.cover, relationType: rel.relationType, isBundleChild: true });
    }
  });
  // Viewing a version's own page: IGDB relations aren't symmetric, so this
  // version rarely lists its own siblings back — add its own tab explicitly
  // so the log switcher looks the same as it does from the base's page.
  if (baseId !== externalId && !list.some(item => item.externalId === externalId)) {
    list.push({ externalId, label: titleMain, cover });
  }
  // Every OTHER season in the chain — "T{n}" (not the season's own title:
  // it's usually just "Título 2nd Season", already redundant once labeled
  // by position, see stripSeasonSuffix) matching Temporadas' own badges,
  // numbered by real chain position so it still reads correctly regardless
  // of which season this editor happens to be open on. The one this editor
  // IS already open on is the "Original" tab (baseId === externalId here,
  // since anime has no parentGame), so it's excluded from this list.
  if (!isUnifiedAnime && sagaUsesOnlySeasonMedia) {
    animeSeasonChain.forEach((seasonEntry, i) => {
      if (seasonEntry.externalId === baseId || seasonEntry.externalId === externalId) return;
      list.push({ externalId: seasonEntry.externalId, label: `T${i + 1}`, cover: seasonEntry.cover ?? undefined, isSeasonTab: true });
    });
  }
  return list;
}

// Both rating slots aggregate identically: the mean of whatever seasons have
// a rating, falling back to the competition's own row when an Event has no
// season logs at all yet.
export function computeGeneralAverageRating(
  slot: 'rating' | 'rating2',
  { unifiedSeasonIds, logs, isUnifiedEvent, externalId }: {
    unifiedSeasonIds: string[];
    logs: Record<string, LogState>;
    isUnifiedEvent: boolean;
    externalId: string;
  },
): number {
  const ratings = unifiedSeasonIds
    .map(id => logs[id]?.[slot])
    .filter((r): r is number => typeof r === 'number' && r > 0);
  if (ratings.length === 0) {
    const hasSeasonLogs = unifiedSeasonIds.some(id => !!logs[id]);
    return isUnifiedEvent && !hasSeasonLogs ? logs[externalId]?.[slot] ?? 0 : 0;
  }
  return ratings.reduce((a, b) => a + b, 0) / ratings.length;
}

// The chain's own outer bounds: the first season's start (or the earliest
// logged start) and the last season's end (or the latest logged end).
export function computeChainBoundaryDate(
  edge: 'start' | 'end',
  animeSeasonChain: SagaEntry[],
  logs: Record<string, LogState>,
): string {
  const field = edge === 'start' ? 'startedAt' : 'finishedAt';
  const anchor = edge === 'start' ? animeSeasonChain[0] : animeSeasonChain[animeSeasonChain.length - 1];
  const anchorValue = logs[anchor?.externalId]?.[field];
  if (anchorValue) return anchorValue;
  const all = animeSeasonChain.map(s => logs[s.externalId]?.[field]).filter(Boolean) as string[];
  const sorted = all.sort();
  return (edge === 'start' ? sorted[0] : sorted.reverse()[0]) || '';
}

// "Not out yet" for whichever tab is active: a season tab answers for its own
// season, the general tab for the work itself.
export function computeIsUpcoming(
  { activeAnimeSeasonEntry, activeSeriesSeasonInfo, activeEventSeasonInfo, status, releaseYear, releaseMonth, releaseDay }: {
    activeAnimeSeasonEntry: SagaEntry | undefined;
    activeSeriesSeasonInfo: { airDate?: string | null } | undefined;
    activeEventSeasonInfo: { airDate?: string | null } | undefined;
    status?: string | null;
    releaseYear?: number | null;
    releaseMonth?: number | null;
    releaseDay?: number | null;
  },
): boolean {
  if (activeAnimeSeasonEntry) {
    return isFutureDate(activeAnimeSeasonEntry.year, activeAnimeSeasonEntry.month, activeAnimeSeasonEntry.day);
  }
  if (activeSeriesSeasonInfo) {
    if (!activeSeriesSeasonInfo.airDate) return false;
    const d = new Date(activeSeriesSeasonInfo.airDate);
    return !isNaN(d.getTime()) && d.getTime() > Date.now();
  }
  if (activeEventSeasonInfo?.airDate) {
    const d = new Date(activeEventSeasonInfo.airDate);
    return !isNaN(d.getTime()) && d.getTime() > Date.now();
  }
  return status === 'NOT_YET_RELEASED' || isFutureDate(releaseYear, releaseMonth, releaseDay);
}

export interface ActiveLogDisplay {
  title: string;
  cover?: string;
  year?: number;
}

// Header cover/title/year follow whichever log tab is active - the base game's
// own title/cover, the current version's, or another linked edition's.
export function computeActiveLogDisplay(
  { isGeneralTab, isUnifiedAnime, generalBaseTitle, animeSeasonChain, seasonMetaMap, activeLogId,
    activeAnimeSeasonEntry, activeSeriesSeasonInfo, activeEventSeasonInfo, allAvailableEditions,
    baseId, baseRelation, coverPreferenceId, data }: {
    isGeneralTab: boolean;
    isUnifiedAnime: boolean;
    generalBaseTitle: string;
    animeSeasonChain: SagaEntry[];
    seasonMetaMap: Record<string, { title: string; cover?: string }>;
    activeLogId: string;
    activeAnimeSeasonEntry: SagaEntry | undefined;
    activeSeriesSeasonInfo: { name?: string | null; seasonNumber: number; coverUrl?: string | null; airDate?: string | null } | undefined;
    activeEventSeasonInfo: { name?: string | null; coverUrl?: string | null; airDate?: string | null } | undefined;
    allAvailableEditions: AvailableEdition[];
    baseId: string;
    baseRelation: { title?: string; cover?: string; releaseYear?: number | null } | undefined;
    coverPreferenceId: string | null;
    data: { titleMain: string; cover?: string; releaseYear?: number; parentGame?: { title: string; cover?: string } | null };
  },
): ActiveLogDisplay {
  const preferredCover = coverPreferenceId ?? undefined;
  if (isGeneralTab) {
    return {
      title: generalBaseTitle,
      cover: animeSeasonChain[0]?.cover || data.cover,
      year: animeSeasonChain[0]?.year ?? data.releaseYear,
    };
  }
  if (isUnifiedAnime && seasonMetaMap[activeLogId]) {
    const meta = seasonMetaMap[activeLogId];
    return {
      title: meta.title,
      cover: meta.cover || data.cover,
      year: activeAnimeSeasonEntry?.year ?? data.releaseYear,
    };
  }
  if (activeSeriesSeasonInfo) {
    const sYear = activeSeriesSeasonInfo.airDate ? new Date(activeSeriesSeasonInfo.airDate).getFullYear() : undefined;
    return {
      title: activeSeriesSeasonInfo.name || `T${activeSeriesSeasonInfo.seasonNumber}`,
      cover: activeSeriesSeasonInfo.coverUrl || data.cover,
      year: !isNaN(sYear as number) ? sYear : data.releaseYear,
    };
  }
  if (activeLogId === baseId) {
    return {
      title: data.parentGame?.title || baseRelation?.title || data.titleMain,
      cover: preferredCover || data.parentGame?.cover || baseRelation?.cover || data.cover,
      year: data.parentGame ? data.releaseYear : (baseRelation?.releaseYear ?? data.releaseYear),
    };
  }
  if (activeEventSeasonInfo) {
    const meta = seasonMetaMap[activeLogId];
    return {
      title: meta?.title || activeEventSeasonInfo.name || data.titleMain,
      cover: meta?.cover || activeEventSeasonInfo.coverUrl || data.cover,
      year: activeEventSeasonInfo.airDate ? new Date(activeEventSeasonInfo.airDate).getFullYear() : data.releaseYear,
    };
  }
  const found = allAvailableEditions.find(ed => ed.externalId === activeLogId);
  return found
    ? { title: found.label, cover: preferredCover || found.cover, year: data.releaseYear }
    : { title: data.titleMain, cover: preferredCover || data.cover, year: data.releaseYear };
}
