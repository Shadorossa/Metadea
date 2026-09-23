import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import { getCatalogEntry, getLibraryEntry, saveLibraryEntry } from '../../../lib/tauri';
import type { LibraryEntry } from '../../../lib/tauri';
import type { MediaPageData, MediaSeasonInfo } from '../../../lib/media/types';
import { getApiSportsEventMatches, getApiSportsEventSeasons } from '../../../lib/tauri/episodes';
import { fetchApiSportsSeasonMatches, type EventMatch } from '../../../lib/search/providers/apisports';
import { pickAggregateStatus } from '../../../lib/media/media-types';
import { useKeyedState } from '../../shared/hooks/useKeyedState';

const EMPTY_MATCHES: EventMatch[] = [];

interface Params {
  currentId: string;
  previewMode: boolean;
  dataType: string | undefined;
  dataSeasons: MediaSeasonInfo[] | undefined;
  isEventCompetition: boolean;
  unifySeasonsEnabled: boolean;
  showEditor: boolean;
  setData: Dispatch<SetStateAction<MediaPageData | null>>;
  libStatus: string;
  libRating: number;
  inLibrary: boolean;
}

// API-Sports competitions: the season match list, the stored competition
// season tabs, and — with the unify-seasons preference on — the per-season
// library entries that the hero widget aggregates into one status/rating.
export function useEventMatches({
  currentId,
  previewMode,
  dataType,
  dataSeasons,
  isEventCompetition,
  unifySeasonsEnabled,
  showEditor,
  setData,
  libStatus,
  libRating,
  inLibrary,
}: Params) {
  // Empty again for every navigation; the match effect below refills it.
  const [matches,            setMatches]            = useKeyedState<EventMatch[]>(`${previewMode}\n${currentId}\n${dataType}`, EMPTY_MATCHES);
  const [eventSeasonEntries, setEventSeasonEntries] = useState<Record<string, LibraryEntry | null>>({});

  // Season relationships are stored locally after the first successful
  // provider fetch. Load them independently of the API response so an
  // already-synced competition still has its season tabs when offline.
  useEffect(() => {
    if (previewMode || !isEventCompetition) return;
    let cancelled = false;
    getApiSportsEventSeasons(currentId).then(storedRows => {
      if (cancelled || storedRows.length === 0) return;
      const storedSeasons: MediaSeasonInfo[] = storedRows.map(row => ({
        externalId: row.externalId,
        seasonNumber: row.seasonNumber,
        name: row.name,
        coverUrl: row.coverUrl,
        airDate: row.airDate,
      }));
      setData(previous => {
        if (!previous || previous.externalId !== currentId || previous.type !== 'event') return previous;
        const byId = new Map<string, MediaSeasonInfo>();
        for (const season of storedSeasons) {
          if (season.externalId) byId.set(season.externalId, season);
        }
        for (const season of previous.seasons ?? []) {
          if (season.externalId) byId.set(season.externalId, season);
        }
        const seasons = [...byId.values()].sort((a, b) => {
          const year = (season: MediaSeasonInfo) => Number(
            season.airDate?.slice(0, 4) || season.name?.match(/\b(?:19|20|21)\d{2}\b/)?.[0] || 0,
          );
          return year(b) - year(a) || b.seasonNumber - a.seasonNumber;
        });
        return { ...previous, seasons };
      });
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [previewMode, isEventCompetition, currentId, setData]);

  useEffect(() => {
    if (previewMode || !isEventCompetition || !unifySeasonsEnabled) {
      setEventSeasonEntries({});
      return;
    }
    let cancelled = false;
    const seasons = dataSeasons ?? [];
    Promise.all(seasons.map(async season => {
      if (!season.externalId) return null;
      const entry = await getLibraryEntry(season.externalId).catch(() => null);
      return [season.externalId, entry] as const;
    })).then(rows => {
      if (cancelled) return;
      setEventSeasonEntries(Object.fromEntries(rows.filter((row): row is readonly [string, LibraryEntry | null] => !!row)));
    });
    return () => { cancelled = true; };
  }, [previewMode, isEventCompetition, unifySeasonsEnabled, dataSeasons, showEditor]);

  const eventSeasonIds = (dataSeasons ?? []).map(season => season.externalId).filter((id): id is string => !!id);
  const eventSeasonEntriesLoaded = eventSeasonIds.length > 0 && eventSeasonIds.every(id => id in eventSeasonEntries);
  const currentEventSeasonEntries = eventSeasonIds.map(id => eventSeasonEntries[id] ?? null);
  const eventAggregateStatus = isEventCompetition && unifySeasonsEnabled
    ? (pickAggregateStatus(currentEventSeasonEntries.map(entry => entry?.status)) || (eventSeasonEntriesLoaded ? '' : libStatus))
    : libStatus;
  const eventSeasonRatings = isEventCompetition && unifySeasonsEnabled
    ? currentEventSeasonEntries.map(entry => entry?.rating ?? 0).filter(rating => rating > 0)
    : [];
  const eventAggregateRating = eventSeasonRatings.length > 0
    ? eventSeasonRatings.reduce((sum, rating) => sum + rating, 0) / eventSeasonRatings.length
    : (isEventCompetition && unifySeasonsEnabled && eventSeasonEntriesLoaded ? 0 : libRating);
  const mediaInLibrary = (isEventCompetition && unifySeasonsEnabled
    && currentEventSeasonEntries.some(entry => !!entry?.status)) || inLibrary;

  const saveEventSeasonUpdates = useCallback(async (updates: Partial<LibraryEntry>) => {
    if (!isEventCompetition || !unifySeasonsEnabled) return false;
    const seasons = (dataSeasons ?? []).filter(season => !!season.externalId);
    // Seasons do not depend on each other, so the per-season reads and the
    // save run together; rows keep season order because map() does.
    const rows: Array<readonly [string, LibraryEntry]> = await Promise.all(seasons.map(async season => {
      const id = season.externalId!;
      const existing = eventSeasonEntries[id] ?? await getLibraryEntry(id).catch(() => null);
      const seasonUpdates = { ...updates };
      if (seasonUpdates.status === 'completed') {
        const [catalog, matchCache] = await Promise.all([
          getCatalogEntry(id).catch(() => null),
          getApiSportsEventMatches(id).catch(() => ({ syncedAt: null, matches: [] })),
        ]);
        let totalCount = matchCache.syncedAt ? matchCache.matches.length : (catalog?.total_count ?? 0);
        if (!matchCache.syncedAt && totalCount <= 0) {
          totalCount = (await fetchApiSportsSeasonMatches(id).catch(() => [])).length;
        }
        if (totalCount > 0) seasonUpdates.progress = totalCount;
      }
      const draft: LibraryEntry = {
        id: '', user_id: 'local',
        status: null, rating: null, rating_2: null, progress: 0, progress_2: 0, minutes_spent: 0,
        is_favorite: 0, is_platinum: 0, tags: null, notes: null,
        added_at: null, updated_at: null, selected_platform: null, selected_version: null,
        started_at: null, finished_at: null,
        ...existing,
        ...seasonUpdates,
        external_id: id,
        type: 'event',
      };
      return [id, await saveLibraryEntry(draft)] as const;
    }));
    setEventSeasonEntries(previous => ({ ...previous, ...Object.fromEntries(rows) }));
    return true;
  }, [isEventCompetition, unifySeasonsEnabled, dataSeasons, eventSeasonEntries]);

  useEffect(() => {
    if (previewMode || dataType !== 'event' || !currentId) return;
    let cancelled = false;
    fetchApiSportsSeasonMatches(currentId)
      .then(rows => { if (!cancelled) setMatches(rows); })
      .catch(() => { if (!cancelled) setMatches([]); });
    return () => { cancelled = true; };
  }, [previewMode, currentId, dataType, setMatches]);

  return {
    matches,
    eventAggregateStatus,
    eventAggregateRating,
    mediaInLibrary,
    saveEventSeasonUpdates,
  };
}
