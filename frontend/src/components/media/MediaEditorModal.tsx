import React, { useReducer, useEffect, useCallback, useMemo, useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { LibraryEntry } from '../../lib/tauri';
import { getLibraryEntry, deleteLibraryEntry, readMonthlyHistory, syncFavorites, saveImageFile } from '../../lib/tauri';
import { getActiveRatingSystem } from '../../lib/media/rating-utils';
import { generateShareImage } from '../../lib/media/share-image';
import type { MediaPageData } from '../../lib/media/types';
import { RatingInput } from './RatingInput';
import { syncToAniList, fetchAniListLogData, isAniListType } from '../../lib/media/anilist-sync';
import type { Translations } from '../../i18n/index';
import {
  IconStatusPlanning, IconStatusInProgress, IconStatusCompleted,
  IconStatusPaused, IconStatusDropped,
  IconHeart, IconPlatinum, IconCheck, IconDownload,
} from '../local/ui/icons';
import {
  type LogState,
  createDefaultLog, entryInit, entryReducer, uiReducer, createEmptyVersionEntry,
} from '../../lib/media/log-state';
import { pickAggregateStatus } from '../../lib/constants/media';
import { motion } from 'motion/react';
import { getRatingName2, getRating2System, getRating2Min, getRating2Max, isUnifySeasonsEnabled, type RatingSlot } from '../../lib/settings/preferences';
import { loadSagaChain } from '../../lib/media/sagaData';
import type { SagaEntry } from '../../lib/anilist/saga';
import { stripSeasonSuffix, seriesSeasonExternalId } from '../../lib/media/mapper-utils';
import { getCoverPreference } from '../../lib/media/cover-preferences';
import { getProgressConfig, isFutureDate } from './media-editor/media-editor-helpers';
import { HeaderField, HoursField, NumberField } from './media-editor/MediaEditorFields';
import {
  fetchMonthMediaInfo, fetchCoverCandidates, fetchAnimeSeasonChainLogs,
  fetchEventSeasonLogs, fetchSeriesSeasonLogs, loadAllVersions,
  type CoverCandidate, type SeasonMeta,
} from './media-editor/media-editor-load';
import { saveMediaEditorLogs } from './media-editor/media-editor-save';
import { importLogsFromAniList } from './media-editor/media-editor-anilist-import';
import {
  buildAvailableEditions, computeGeneralAverageRating, computeChainBoundaryDate,
  computeIsUpcoming, computeActiveLogDisplay,
} from './media-editor/media-editor-derived';
import { MediaEditorVersionTabs } from './media-editor/MediaEditorVersionTabs';
import { MediaEditorCoverSlot } from './media-editor/MediaEditorCoverSlot';
import { MediaEditorMonthGrid } from './media-editor/MediaEditorMonthGrid';
import { MediaEditorActions } from './media-editor/MediaEditorActions';
import { MediaEditorStatusRow } from './media-editor/MediaEditorStatusRow';
import { MediaEditorDateFields } from './media-editor/MediaEditorDateFields';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Props {
  externalId: string;
  data: MediaPageData;
  i18n: Translations['media'];
  onClose: () => void;
  onSaved: (entry: LibraryEntry) => void;
  onDeleted: () => void;
  initialEntry?: LibraryEntry;
  initialActiveLogId?: string;
  // Which rating this editor session edits — always 'rating' (the default,
  // app-wide-system one) except when opened from the profile library with
  // its own "doble calificación" selector on rating_2 (see LibraryCard's
  // open-profile-editor dispatch). Every other entry point (media page,
  // local library, search) always means the primary rating.
  activeRatingSlot?: RatingSlot;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function MediaEditorModal({ externalId, data, i18n, onClose, onSaved, onDeleted, initialEntry, initialActiveLogId, activeRatingSlot = 'rating' }: Props) {
  const t  = i18n;
  const te = t.editor;
  // rating_2's own name/system are read once at mount — this modal's whole
  // lifetime is one edit session, no need to react to a settings change
  // happening in a different window/tab mid-edit.
  const isSecondaryRating = activeRatingSlot === 'rating_2';
  const ratingLabel = isSecondaryRating ? getRatingName2(te.score) : te.score;
  const rating2System = useMemo(() => getRating2System(), []);
  // Custom range only matters for '10-dec'/'10' — getRating2Min/Max default
  // to 0/10 anyway, so passing them unconditionally for every system is
  // harmless (5-star/3-emoji never read these props).
  const rating2Min = useMemo(() => getRating2Min(), []);
  const rating2Max = useMemo(() => getRating2Max(), []);
  const [entry, dispatchEntry] = useReducer(entryReducer, externalId, id => ({ ...entryInit, activeLogId: initialActiveLogId || id }));
  const [ui,    dispatchUi]    = useReducer(uiReducer, {
    // Version tabs and the editor shell can render from `data` immediately;
    // the caller's saved log is hydrated asynchronously below.
    loading: false, saving: false, isClosing: false,
    tagInput: '', anilistStatus: 'idle', anilistError: null,
    anilistImportStatus: 'idle', anilistImportError: null,
  });

  // Cover/title lookup for whichever media occupies each month slot in the
  // history grid, so a blocked (or one's own) month shows *which* entry it
  // belongs to instead of just a bare "taken" state.
  const [monthMediaInfo, setMonthMediaInfo] = useState<Record<string, { title: string; cover: string }>>({});
  useEffect(() => {
    const ids = new Set<string>();
    for (const occupants of Object.values(entry.monthlyHistory)) {
      for (const id of occupants) ids.add(id);
    }
    const missing = [...ids].filter(id => !(id in monthMediaInfo));
    if (missing.length === 0) return;
    fetchMonthMediaInfo(missing).then(results => {
      setMonthMediaInfo(prev => {
        const next = { ...prev };
        for (const [id, info] of results) next[id] = info;
        return next;
      });
    });
  }, [entry.monthlyHistory]); // eslint-disable-line react-hooks/exhaustive-deps

  // The single source of truth for whatever log tab is currently active —
  // everything in the form reads/writes through this instead of a mirrored
  // copy on EntryState.
  const activeLog = useMemo(
    () => entry.logs[entry.activeLogId] || createDefaultLog(),
    [entry.logs, entry.activeLogId],
  );

  // A remaster/remake can be a fully editable entry without a parentGame
  // object. In that case its persisted BASE_EDITION relation is the source of
  // truth for the root log; otherwise the editor incorrectly treated the
  // remaster itself as the base and had no Original/version tabs.
  const relationBaseId = data.relations?.find(rel =>
    rel.relationType === 'BASE_EDITION' &&
    rel.relatedExternalId &&
    rel.relatedExternalId !== externalId,
  )?.relatedExternalId;
  const baseId = data.parentGame?.externalId || relationBaseId || externalId;
  const baseRelation = data.relations?.find(rel =>
    rel.relationType === 'BASE_EDITION' && rel.relatedExternalId === baseId,
  );
  const baseSelectedVersion = entry.logs[baseId]?.selectedVersion || '';
  const [coverCandidates, setCoverCandidates] = useState<CoverCandidate[]>([]);
  const [coverPreferenceId, setCoverPreferenceId] = useState<string | null>(() => getCoverPreference(baseId));
  const [coverPickerOpen, setCoverPickerOpen] = useState(false);

  useEffect(() => {
    setCoverPreferenceId(getCoverPreference(baseId));
    setCoverPickerOpen(false);
    let cancelled = false;

    fetchCoverCandidates({ externalId, baseId, type: data.type, titleMain: data.titleMain, cover: data.cover })
      .then(candidates => { if (!cancelled) setCoverCandidates(candidates); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [baseId, externalId, data.parentGame, data.titleMain, data.cover]);

  // "Unificar temporadas" (Settings > Preferencias) — every other season in
  // the chain gets its own tab here too, same as the edition/version tabs
  // below, so a status/rating/progress can be logged per season without
  // closing this editor and reopening it on each season's own page. Reuses
  // loadSagaChain (sagaData.ts), same source MediaPage.tsx's own Temporadas
  // tab reads, so this is normally an instant cache hit.
  const [animeSeasonChain, setAnimeSeasonChain] = useState<SagaEntry[]>([]);
  const [seasonMetaMap, setSeasonMetaMap] = useState<Record<string, SeasonMeta>>({});

  const sagaUsesOnlySeasonMedia = animeSeasonChain.length <= 1 || animeSeasonChain.every(
    season => season.mediaType === 'anime' || season.mediaType === 'series',
  );
  const isUnifiedAnime = data.type === 'anime' && isUnifySeasonsEnabled()
    && animeSeasonChain.length > 1 && sagaUsesOnlySeasonMedia;
  const isUnifiedEvent = data.type === 'event'
    && isUnifySeasonsEnabled()
    && /^event:apisports:(football|basketball):\d+$/.test(externalId)
    && (data.seasons?.length ?? 0) > 0;
  const eventSeasons = isUnifiedEvent ? data.seasons ?? [] : [];
  const GENERAL_LOG_ID = isUnifiedAnime && animeSeasonChain[0] ? `general:${animeSeasonChain[0].externalId}` : '';
  const isGeneralTab = (isUnifiedAnime && entry.activeLogId === GENERAL_LOG_ID)
    || (isUnifiedEvent && entry.activeLogId === externalId);

  // A standalone movie (or a one-unit work) has one viewing date. The
  // synthetic general tab of a unified season chain is different: it
  // represents the whole chain, so it must always expose the aggregate start
  // and end dates, even when every member of that chain is a movie.
  const isMovie = !isGeneralTab && (
    data.type === 'movie' ||
    (data.type === 'anime' && data.format === 'MOVIE') ||
    data.totalCount === 1
  );

  useEffect(() => {
    if (data.type !== 'anime' || !isUnifySeasonsEnabled()) {
      setAnimeSeasonChain([]);
      return;
    }
    let cancelled = false;
    loadSagaChain(externalId).then(chain => {
      if (!cancelled) setAnimeSeasonChain(chain.ok && chain.entries.length > 1 ? chain.entries : []);
    }).catch(() => { if (!cancelled) setAnimeSeasonChain([]); });
    return () => { cancelled = true; };
  }, [data.type, externalId]);

  useEffect(() => {
    if (animeSeasonChain.length === 0) return;
    let cancelled = false;
    fetchAnimeSeasonChainLogs(animeSeasonChain).then(results => {
      if (cancelled) return;
      const meta: Record<string, SeasonMeta> = {};
      results.forEach(r => {
        meta[r.id] = r.meta;
        if (r.lib) {
          dispatchEntry({ type: 'LOAD_LOG', id: r.id, entry: r.lib });
        } else {
          dispatchEntry({ type: 'LOAD_LOG', id: r.id, entry: createEmptyVersionEntry(r.id, 'anime') });
        }
      });
      setSeasonMetaMap(meta);

      if (animeSeasonChain[0]) {
        const gId = `general:${animeSeasonChain[0].externalId}`;
        const savedGenRating = localStorage.getItem(`general_rating:${animeSeasonChain[0].externalId}`);
        const initialRating = savedGenRating ? parseFloat(savedGenRating) : 0;
        const emptyGen = createEmptyVersionEntry(gId, 'anime');
        if (initialRating > 0) {
          emptyGen.rating = initialRating;
        }
        dispatchEntry({ type: 'LOAD_LOG', id: gId, entry: emptyGen });
      }
    });
    return () => { cancelled = true; };
  }, [animeSeasonChain]);

  // API-Sports competitions use a distinct catalog entry as their general
  // page, while each season has its own real entry and its own match list.
  // Load those season logs into the same editor session so the general tab
  // can aggregate progress/status/ratings without merging the match entries.
  useEffect(() => {
    if (!isUnifiedEvent) return;
    let cancelled = false;
    const seasons = data.seasons ?? [];
    fetchEventSeasonLogs(seasons).then(results => {
      if (cancelled) return;
      const meta: Record<string, SeasonMeta> = {};
      for (const result of results) {
        if (!result) continue;
        meta[result.id] = result.meta;
        dispatchEntry({
          type: 'LOAD_LOG',
          id: result.id,
          entry: result.lib ?? createEmptyVersionEntry(result.id, 'event'),
        });
      }
      setSeasonMetaMap(meta);
    }).catch(() => {
      if (!cancelled) setSeasonMetaMap({});
    });
    return () => { cancelled = true; };
  }, [isUnifiedEvent, data.seasons]);

  // Same "Unificar temporadas" toggle, for TMDB series — but unlike anime,
  // a series' own base entry already covers "the whole show" exactly like
  // it always has (its own real, independently-editable status/rating/
  // progress — see the general-tab question this was built to answer), so
  // there's no derived/aggregate general tab to build here. Season tabs are
  // the only new thing: each gets its own synthetic per-season log
  // (seriesSeasonExternalId) since a series has no per-season catalog row to
  // key a real one off of. data.seasons is already fetched (TMDB's own
  // detail response), so unlike anime this needs no extra chain lookup.
  const isUnifiedSeries = data.type === 'series' && isUnifySeasonsEnabled() && (data.seasons?.length ?? 0) > 0;
  const seriesSeasons = isUnifiedSeries ? data.seasons ?? [] : [];

  useEffect(() => {
    if (!isUnifiedSeries) return;
    let cancelled = false;
    fetchSeriesSeasonLogs(externalId, seriesSeasons).then(results => {
      if (cancelled) return;
      results.forEach(r => {
        dispatchEntry({ type: 'LOAD_LOG', id: r.id, entry: r.lib ?? createEmptyVersionEntry(r.id, 'series') });
      });
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isUnifiedSeries, externalId]);

  // Load base game and edition logs
  useEffect(() => {
    if (initialEntry) dispatchEntry({ type: 'LOAD_LOG', id: externalId, entry: initialEntry });
    loadAllVersions(baseId, data, initialActiveLogId, dispatchEntry)
      .finally(() => dispatchUi({ type: 'SET_LOADING', value: false }));
    // The version tabs are derived from `data.relations` and do not need to
    // wait for the user's saved logs. Let the editor render immediately while
    // the IPC reads below hydrate the individual version fields in place.
    dispatchUi({ type: 'SET_LOADING', value: false });

    readMonthlyHistory()
      .then(history => {
        let foundKey: string | null = null;
        for (const [key, ids] of Object.entries(history)) {
          if (ids.includes(externalId)) { foundKey = key; break; }
        }
        dispatchEntry({ type: 'LOAD_HISTORY', history, foundKey });
      })
      .catch(() => {});
  }, [externalId, data.parentGame, data.type, data.relations]); // eslint-disable-line react-hooks/exhaustive-deps

  // Kept in sync every render so the effect below can check "is this id
  // already loaded" without listing entry.logs as a dependency — that would
  // re-run the effect (and refetch every linked version over IPC) on every
  // single log edit, not just when a new version gets linked.
  const logsRef = useRef(entry.logs);
  logsRef.current = entry.logs;

  // Dynamically load newly selected edition. The tab-switch click handler
  // already seeds a synchronous LOAD_LOG for the version it just linked, so
  // this only needs to fetch ids that aren't in entry.logs yet — refetching
  // every already-loaded version on each edit to `selectedVersion` (its
  // whole CSV string changes identity whenever one more id is appended) was
  // a redundant Tauri IPC round-trip per tab switch, and the perceptible
  // source of "tarda un pelín" lag reported after the earlier flicker fix.
  useEffect(() => {
    if (!baseSelectedVersion) return;
    for (const versionId of baseSelectedVersion.split(',').filter(Boolean)) {
      if (logsRef.current[versionId]) continue;
      getLibraryEntry(versionId)
        .then(ev => dispatchEntry({ type: 'LOAD_LOG', id: versionId, entry: ev ?? createEmptyVersionEntry(versionId) }));
    }
  }, [baseSelectedVersion]);

  const handleClose = useCallback(() => {
    onClose();
  }, [onClose]);

  const handleImportFromAniList = useCallback(
    () => importLogsFromAniList({
      isGeneralTab, animeSeasonChain, mediaType: data.type,
      activeLogId: entry.activeLogId, externalId, dispatchEntry, dispatchUi,
    }),
    [isGeneralTab, animeSeasonChain, data.type, entry.activeLogId, externalId],
  );

  const handleSave = useCallback(async () => {
    dispatchUi({ type: 'SET_SAVING', value: true });
    try {
      const primarySaved = await saveMediaEditorLogs({
        logs: entry.logs,
        monthlyHistory: entry.monthlyHistory,
        activeLog,
        externalId,
        baseId,
        type: data.type,
        totalCount: data.totalCount,
        animeSeasonChain,
      });

      if (primarySaved) {
        onSaved(primarySaved);
      }

      if (isAniListType(data.type)) {
        dispatchUi({ type: 'SET_ANILIST', status: 'syncing' });
        syncToAniList({
          // Must be the active tab's own id, not the modal's base externalId
          // — a season tab (isSeasonTab) is its own independent AniList
          // entry (e.g. Bleach TYBW vs. base Bleach 2004), and activeLog's
          // values already belong to whichever tab is open, so syncing them
          // against the wrong mediaId would silently write this season's
          // progress onto the base work's AniList list entry instead.
          externalId: entry.activeLogId || externalId, type: data.type,
          status:          activeLog.status,
          rating:          activeLog.rating,
          progress:        activeLog.progress,
          progressVolumes: activeLog.progressCount2,
          startedAt:       activeLog.startedAt,
          finishedAt:      activeLog.finishedAt,
          notes:           activeLog.notes,
        }).then(result => {
          if (result.ok) {
            if (!result.skipped) {
              dispatchUi({ type: 'SET_ANILIST', status: 'ok' });
              setTimeout(() => dispatchUi({ type: 'SET_ANILIST', status: 'idle' }), 3000);
            } else {
              dispatchUi({ type: 'SET_ANILIST', status: 'idle' });
            }
          } else {
            dispatchUi({ type: 'SET_ANILIST', status: 'error', error: result.error });
          }
        });
      }

      handleClose();
    } catch (e) {
      console.error('save_library_entry error', e);
    } finally {
      dispatchUi({ type: 'SET_SAVING', value: false });
    }
  }, [entry, activeLog, externalId, baseId, data.type, data.parentGame, data.totalCount, onSaved, handleClose]);

  const handleDelete = useCallback(async () => {
    const activeId = entry.activeLogId || externalId;
    const existing = entry.logs[activeId]?.existing;
    if (!existing) { onClose(); return; }
    try {
      await deleteLibraryEntry(activeId);
      await syncFavorites(data.type, activeId, false)
        .catch(e => console.error('Failed to sync favorites', e));
      onDeleted();
    } catch (e) {
      console.error('delete_library_entry error', e);
    }
    onClose();
  }, [entry.logs, entry.activeLogId, externalId, data.type, onDeleted, onClose]);

  // No API lets a desktop app post directly to Instagram Stories (that's
  // mobile-only, Business account, Meta app review) — this generates the
  // Letterboxd-style share image and puts up a save dialog so the user
  // shares it themselves. Only enabled once finished/rated (see the button
  // below) since "just started watching" has nothing worth sharing yet.
  const [sharing, setSharing] = useState(false);

  const handleTagKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      const tag = ui.tagInput.trim();
      if (tag) {
        if (activeLog.tags.length < 5 && !activeLog.tags.includes(tag)) {
          dispatchEntry({ type: 'UPDATE_LOG', updates: { tags: [...activeLog.tags, tag] } });
        }
        dispatchUi({ type: 'SET_TAG_INPUT', value: '' });
      }
    } else if (e.key === 'Backspace' && !ui.tagInput && activeLog.tags.length > 0) {
      dispatchEntry({ type: 'UPDATE_LOG', updates: { tags: activeLog.tags.slice(0, -1) } });
    }
  }, [ui.tagInput, activeLog.tags]);

  const statusButtons = useMemo(() => [
    { value: 'planning',          label: te.status_planning,    Icon: IconStatusPlanning    },
    { value: data.progressStatus, label: te.status_in_progress, Icon: IconStatusInProgress  },
    { value: 'completed',         label: te.status_completed,   Icon: IconStatusCompleted   },
    { value: 'paused',            label: te.status_paused,      Icon: IconStatusPaused      },
    { value: 'dropped',           label: te.status_dropped,     Icon: IconStatusDropped     },
  ], [te, data.progressStatus]);

  const { label: progLabel, label2, step: progStep } = useMemo(
    () => getProgressConfig(data.type, data.format, t),
    [data.type, data.format, t],
  );


  const allAvailableEditions = useMemo(
    () => buildAvailableEditions({
      baseId, externalId, titleMain: data.titleMain, cover: data.cover,
      relations: data.relations, animeSeasonChain, isUnifiedAnime, sagaUsesOnlySeasonMedia,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [baseId, data.parentGame, externalId, data.titleMain, data.cover, data.relations, animeSeasonChain, isUnifiedAnime],
  );

  // A bundle (Final Fantasy VII Remake Intergrade) is never itself
  // trackable — there's no meaningful "progress" on the bundle as a lump,
  // only on what it actually contains — so its own "Original" tab never
  // renders (see the tab bar below) and, if this editor was opened directly
  // on one and hasn't already been steered to a specific content tab, this
  // jumps straight to the first one instead of leaving the user stuck on a
  // tab that doesn't exist. Only fires while activeLogId is still sitting on
  // baseId/externalId — a user who already switched tabs (or a reopen that
  // remembers a previous selection) is left alone.
  const isBundle = allAvailableEditions.some(ed => ed.isBundleChild);
  useEffect(() => {
    if (!isBundle) return;
    if (entry.activeLogId !== baseId && entry.activeLogId !== externalId) return;
    const firstChild = allAvailableEditions.find(ed => ed.isBundleChild);
    if (!firstChild) return;
    if (!entry.logs[firstChild.externalId]) {
      dispatchEntry({ type: 'LOAD_LOG', id: firstChild.externalId, entry: createEmptyVersionEntry(firstChild.externalId) });
    }
    dispatchEntry({ type: 'SWITCH_LOG', id: firstChild.externalId });
    // entry.activeLogId/entry.logs intentionally excluded — re-read fresh
    // above on every run this WOULD fire on, and including them would refire
    // this every time the user's own tab switch changes activeLogId.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isBundle, allAvailableEditions, baseId, externalId]);

  // Every id that represents "this same game" for monthly-history purposes —
  // the base game, whichever edition's page is currently open, and every
  // other known sibling edition. A month assigned from any one of these
  // must be recognized (and removable) from all the others.
  const sameGameIds = useMemo(
    () => new Set([baseId, externalId, ...allAvailableEditions.map(e => e.externalId)]),
    [baseId, externalId, allAvailableEditions],
  );

  // Which season (if any) the currently active tab is — undefined on the
  // series' own general tab or when the season tabs aren't active at all.
  const activeSeriesSeasonInfo = useMemo(() => {
    if (!isUnifiedSeries) return undefined;
    return seriesSeasons.find(s => seriesSeasonExternalId(externalId, s.seasonNumber) === entry.activeLogId);
  }, [isUnifiedSeries, seriesSeasons, externalId, entry.activeLogId]);

  const activeEventSeasonInfo = useMemo(() => {
    if (!isUnifiedEvent) return undefined;
    return eventSeasons.find(season => season.externalId === entry.activeLogId);
  }, [isUnifiedEvent, eventSeasons, entry.activeLogId]);

  // Same "which season (if any) is the active tab" lookup as
  // activeSeriesSeasonInfo above, for anime's own unified season tabs —
  // animeSeasonChain's own SagaEntry already carries its own year/month/day
  // (unlike seasonMetaMap, which only has title/cover/totalCount), so no
  // extra fetch is needed to know a specific season's own release date.
  const activeAnimeSeasonEntry = useMemo(() => {
    if (!isUnifiedAnime) return undefined;
    return animeSeasonChain.find(s => s.externalId === entry.activeLogId);
  }, [isUnifiedAnime, animeSeasonChain, entry.activeLogId]);

  // Track monthly history per active season instead of collapsing every
  // unified-season tab into the same general work id.
  const activeUnifiedSeasonId = activeAnimeSeasonEntry?.externalId
    ?? activeEventSeasonInfo?.externalId
    ?? (activeSeriesSeasonInfo
      ? seriesSeasonExternalId(externalId, activeSeriesSeasonInfo.seasonNumber)
      : undefined);
  useEffect(() => {
    if (!activeUnifiedSeasonId) return;
    const existingKey = Object.entries(entry.monthlyHistory)
      .find(([, ids]) => ids.includes(activeUnifiedSeasonId))?.[0];
    const year = existingKey ? Number(existingKey.split('-')[0]) : 0;
    if (year && year !== entry.selectedYear) {
      dispatchEntry({ type: 'SET_SELECTED_YEAR', year });
    }
  }, [activeUnifiedSeasonId, entry.monthlyHistory, entry.selectedYear]);

  const monthlyHistoryIds = useMemo(
    () => activeUnifiedSeasonId ? new Set([activeUnifiedSeasonId]) : sameGameIds,
    [activeUnifiedSeasonId, sameGameIds],
  );

  const selectedMonthKey = useMemo(() => {
    for (const [key, ids] of Object.entries(entry.monthlyHistory)) {
      if (ids.some(id => monthlyHistoryIds.has(id))) return key;
    }
    return null;
  }, [entry.monthlyHistory, monthlyHistoryIds]);

  const handleMonthClick = useCallback((monthIndex: number) => {
    const targetKey = `${entry.selectedYear}-${String(monthIndex).padStart(2, '0')}`;
    const newKey = selectedMonthKey === targetKey ? null : targetKey;
    dispatchEntry({
      type: 'SET_MONTH',
      ids: activeUnifiedSeasonId ? [activeUnifiedSeasonId] : [...sameGameIds],
      primaryId: activeUnifiedSeasonId ?? baseId,
      key: newKey,
      year: entry.selectedYear,
    });
  }, [activeUnifiedSeasonId, sameGameIds, baseId, entry.selectedYear, selectedMonthKey]);

  // Nothing not yet out can honestly be completed/dropped/paused/in-progress
  // — checked per *active tab*, not just the modal's own top-level data:
  // opening the editor from a season that hasn't aired must not also lock
  // every OTHER season's tab (already released) out of its own real status.
  // data.status is the canonical, already-cross-provider-normalized signal
  // (media-status.ts's CanonicalStatus) for the base/general case — checked
  // first since it accounts for things a bare date can't (e.g. TMDB's "In
  // Production" with no date at all yet); the release-date check is a
  // fallback/belt-and-braces for a catalog row whose status hasn't been
  // resynced recently but whose date clearly hasn't arrived.
  const isUpcoming = useMemo(
    () => computeIsUpcoming({
      activeAnimeSeasonEntry, activeSeriesSeasonInfo, activeEventSeasonInfo,
      status: data.status, releaseYear: data.releaseYear, releaseMonth: data.releaseMonth, releaseDay: data.releaseDay,
    }),
    [activeAnimeSeasonEntry, activeSeriesSeasonInfo, activeEventSeasonInfo, data.status, data.releaseYear, data.releaseMonth, data.releaseDay],
  );

  const generalBaseTitle = useMemo(() => {
    if (isUnifiedEvent) return data.titleMain;
    return stripSeasonSuffix(animeSeasonChain[0]?.title || data.titleMain);
  }, [isUnifiedEvent, animeSeasonChain, data.titleMain]);

  const unifiedSeasonIds = useMemo(() => {
    if (isUnifiedAnime) return animeSeasonChain.map(season => season.externalId);
    if (isUnifiedEvent) return eventSeasons.map(season => season.externalId).filter((id): id is string => !!id);
    return [];
  }, [isUnifiedAnime, isUnifiedEvent, animeSeasonChain, eventSeasons]);

  const generalTotalCount = useMemo(() => {
    if (!isUnifiedAnime && !isUnifiedEvent) return data.totalCount;
    return unifiedSeasonIds.reduce((sum, id) => sum + (seasonMetaMap[id]?.totalCount ?? 0), 0);
  }, [isUnifiedAnime, isUnifiedEvent, unifiedSeasonIds, seasonMetaMap, data.totalCount]);

  const generalProgress = useMemo(() => {
    if (!isUnifiedAnime && !isUnifiedEvent) return activeLog.progress;
    const seasonsProgress = unifiedSeasonIds.reduce((sum, id) => sum + (entry.logs[id]?.progress ?? 0), 0);
    const hasSeasonLogs = unifiedSeasonIds.some(id => !!entry.logs[id]);
    return seasonsProgress || (isUnifiedEvent && !hasSeasonLogs ? entry.logs[externalId]?.progress ?? 0 : 0);
  }, [isUnifiedAnime, isUnifiedEvent, unifiedSeasonIds, entry.logs, activeLog.progress, externalId]);

  // The general tab's own "seasons watched" count — auto-derived from how
  // many chain members are actually marked completed, same read-only
  // aggregate treatment as generalProgress/generalStatus above. AniList
  // gives no "this show has N seasons" field the way TMDB does for series
  // (data.totalCount_2 stays empty for anime), so animeSeasonChain.length
  // is the real total here instead.
  const generalSeasonsCompleted = useMemo(() => {
    if (!isUnifiedAnime && !isUnifiedEvent) return 0;
    return unifiedSeasonIds.filter(id => entry.logs[id]?.status === 'completed').length;
  }, [isUnifiedAnime, isUnifiedEvent, unifiedSeasonIds, entry.logs]);

  const activeTotalCount = useMemo(() => {
    if (isUnifiedAnime || isUnifiedEvent) {
      if (isGeneralTab) return (generalTotalCount ?? 0) > 0 ? generalTotalCount : null;
      return seasonMetaMap[entry.activeLogId]?.totalCount ?? null;
    }
    // A series' general tab keeps using data.totalCount exactly as before
    // (its own real total, not derived) — only a season tab needs its own
    // episodeCount instead.
    if (activeSeriesSeasonInfo) return activeSeriesSeasonInfo.episodeCount ?? null;
    return data.totalCount;
  }, [isUnifiedAnime, isUnifiedEvent, isGeneralTab, generalTotalCount, seasonMetaMap, entry.activeLogId, data.totalCount, activeSeriesSeasonInfo]);

  const generalStartDate = useMemo(
    () => isUnifiedAnime ? computeChainBoundaryDate('start', animeSeasonChain, entry.logs) : '',
    [isUnifiedAnime, animeSeasonChain, entry.logs],
  );

  const generalEndDate = useMemo(
    () => isUnifiedAnime ? computeChainBoundaryDate('end', animeSeasonChain, entry.logs) : '',
    [isUnifiedAnime, animeSeasonChain, entry.logs],
  );

  const generalAverageRating = useMemo(
    () => computeGeneralAverageRating('rating', { unifiedSeasonIds, logs: entry.logs, isUnifiedEvent, externalId }),
    [isUnifiedEvent, externalId, unifiedSeasonIds, entry.logs],
  );

  const generalAverageRating2 = useMemo(
    () => computeGeneralAverageRating('rating2', { unifiedSeasonIds, logs: entry.logs, isUnifiedEvent, externalId }),
    [isUnifiedEvent, externalId, unifiedSeasonIds, entry.logs],
  );

  // Auto-derived, never persisted onto any single season's own row — a
  // season's real status stays whatever the user actually set it to (you may
  // have completed season 1 and dropped season 3, and that must survive
  // toggling this view off again). Only exception: manually marking the
  // general tab "completed" is a genuine bulk action (see the status button
  // handler below), because "I finished the whole thing" really does mean
  // every season is done.
  const generalStatus = useMemo(() => {
    if (!isUnifiedAnime && !isUnifiedEvent) return '';
    const aggregate = pickAggregateStatus(unifiedSeasonIds.map(id => entry.logs[id]?.status));
    if (aggregate || !isUnifiedEvent || unifiedSeasonIds.some(id => !!entry.logs[id])) return aggregate;
    return entry.logs[externalId]?.status ?? '';
  }, [isUnifiedAnime, isUnifiedEvent, unifiedSeasonIds, entry.logs, externalId]);

  const activeLogDisplay = useMemo(
    () => computeActiveLogDisplay({
      isGeneralTab, isUnifiedAnime, generalBaseTitle, animeSeasonChain, seasonMetaMap,
      activeLogId: entry.activeLogId, activeAnimeSeasonEntry, activeSeriesSeasonInfo,
      activeEventSeasonInfo, allAvailableEditions, baseId, baseRelation, coverPreferenceId, data,
    }),
    [isGeneralTab, isUnifiedAnime, generalBaseTitle, animeSeasonChain, data, seasonMetaMap, entry.activeLogId, activeAnimeSeasonEntry, baseId, baseRelation, allAvailableEditions, activeSeriesSeasonInfo, activeEventSeasonInfo, coverPreferenceId],
  );

  const hasCoverCandidates = coverCandidates.length > 1 && data.type === 'game';

  const handleShare = useCallback(async () => {
    setSharing(true);
    try {
      const dataUrl = await generateShareImage({
        title:        activeLogDisplay.title,
        cover:        activeLogDisplay.cover ?? null,
        rating:       activeLog.rating,
        ratingSystem: getActiveRatingSystem(),
        year:         activeLogDisplay.year,
      });
      const fileName = `${activeLogDisplay.title.replace(/[\\/:*?"<>|]/g, '')}.png`;
      await saveImageFile(dataUrl, fileName);
    } catch (e) {
      console.error('Failed to generate share image', e);
    } finally {
      setSharing(false);
    }
  }, [activeLogDisplay.title, activeLogDisplay.cover, activeLogDisplay.year, activeLog.rating]);

  const modal = (
    <motion.div
      className="me-overlay"
      onClick={onClose}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18, ease: 'easeOut' }}
    >
      <motion.div
        className="me-modal"
        onClick={e => e.stopPropagation()}
        initial={{ opacity: 0, scale: 0.97, y: 14 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.97, y: 14 }}
        transition={{ duration: 0.22, ease: [0.25, 0, 0.15, 1] }}
      >

        {/* Header */}
        <div className="me-header">
          <div className="me-header-left">
            <MediaEditorCoverSlot
              cover={activeLogDisplay.cover}
              hasCoverCandidates={hasCoverCandidates}
              coverCandidates={coverCandidates}
              coverPreferenceId={coverPreferenceId}
              coverPickerOpen={coverPickerOpen}
              baseId={baseId}
              editionsLabel={te.editions}
              setCoverPreferenceId={setCoverPreferenceId}
              setCoverPickerOpen={setCoverPickerOpen}
            />
            <div className="me-header-col">
              <span className="me-header-title">{activeLogDisplay.title}</span>
              <div className="me-header-bottom-row">
                <MediaEditorStatusRow
                  statusButtons={statusButtons}
                  status={activeLog.status}
                  isGeneralTab={isGeneralTab}
                  generalStatus={generalStatus}
                  isUpcoming={isUpcoming}
                  unifiedSeasonIds={unifiedSeasonIds}
                  seasonMetaMap={seasonMetaMap}
                  activeTotalCount={activeTotalCount}
                  totalCount2={data.totalCount_2}
                  dispatchEntry={dispatchEntry}
                />

                {/* Progress input — game/vnovel is hours logged as "H:MM"
                    (see HoursField), every other type is a plain count. */}
                {progLabel && (
                  <div className="me-header-progress-pair">
                    {data.type === 'game' || data.type === 'vnovel' ? (
                      <HoursField label={progLabel} value={activeLog.progress}
                        max={activeTotalCount && activeTotalCount > 0 ? activeTotalCount : undefined}
                        onChange={v => {
                          const updates: Partial<LogState> = { progress: v };
                          if (!isUpcoming && activeTotalCount && activeTotalCount > 0 && v >= activeTotalCount && activeLog.status !== 'completed') {
                            updates.status = 'completed';
                          }
                          dispatchEntry({ type: 'UPDATE_LOG', updates });
                        }} />
                    ) : (
                    <NumberField label={progLabel} value={isGeneralTab ? generalProgress : activeLog.progress} step={progStep}
                      max={activeTotalCount && activeTotalCount > 0 ? activeTotalCount : undefined}
                      unknownMax={data.status === 'RELEASING' && !(activeTotalCount && activeTotalCount > 0)}
                      disabled={isGeneralTab}
                      onChange={v => {
                        const updates: Partial<LogState> = { progress: v };
                        if (!isUpcoming && activeTotalCount && activeTotalCount > 0 && v >= activeTotalCount && activeLog.status !== 'completed') {
                          updates.status = 'completed';
                        }
                        dispatchEntry({ type: 'UPDATE_LOG', updates });

                        // A series' general tab is the real, continuously-
                        // numbered episode count across every season (unlike
                        // anime's, this one isn't auto-derived) — so moving
                        // it has to redistribute into each season's own log
                        // too: fill season 1 up to its own episode count,
                        // then season 2, and so on, recomputed from scratch
                        // every time so decreasing the count shrinks seasons
                        // back down the same way.
                        if (isUnifiedSeries && entry.activeLogId === baseId) {
                          const updatesById: Record<string, Partial<LogState>> = {};
                          let remaining = v;
                          for (const season of seriesSeasons) {
                            const seasonId = seriesSeasonExternalId(externalId, season.seasonNumber);
                            const seasonTotal = season.episodeCount ?? 0;
                            const watched = seasonTotal > 0 ? Math.max(0, Math.min(seasonTotal, remaining)) : 0;
                            remaining = Math.max(0, remaining - watched);
                            const su: Partial<LogState> = { progress: watched };
                            const seasonReleased = !season.airDate || new Date(season.airDate).getTime() <= Date.now();
                            if (seasonReleased && seasonTotal > 0 && watched >= seasonTotal) su.status = 'completed';
                            updatesById[seasonId] = su;
                          }
                          dispatchEntry({ type: 'UPDATE_LOGS_BULK', updatesById });
                        }
                      }} />
                    )}
                    {/* Unified anime/event general tabs show how many of the
                        available seasons are completed. For Events this is
                        the competition's season count; match progress stays
                        independent and is aggregated from each season. */}
                    {label2 && !activeSeriesSeasonInfo && (
                      (data.type === 'manga' || data.type === 'lnovel') && data.format !== 'ISSUE'
                        ? true
                        : isGeneralTab
                          ? (isUnifiedEvent ? eventSeasons.length : animeSeasonChain.length) > 0
                          : (data.totalCount_2 !== undefined && data.totalCount_2 !== null && data.totalCount_2 > 0)
                    ) && (
                      <NumberField label={label2}
                        value={isGeneralTab ? generalSeasonsCompleted : activeLog.progressCount2}
                        step={1}
                        max={isGeneralTab
                          ? (isUnifiedEvent ? eventSeasons.length : animeSeasonChain.length)
                          : (data.totalCount_2 ?? undefined)}
                        unknownMax={data.status === 'RELEASING' && !isGeneralTab && !(data.totalCount_2 && data.totalCount_2 > 0)}
                        disabled={isGeneralTab}
                        onChange={v => dispatchEntry({ type: 'UPDATE_LOG', updates: { progressCount2: v } })} />
                    )}
                  </div>
                )}

                {/* Rating — rating_2 (its own name/system) only when this
                    session was opened from the profile library with that
                    slot selected; every other entry point always edits the
                    primary rating. */}
                <HeaderField label={ratingLabel}>
                  {isSecondaryRating ? (
                    <RatingInput rating={isGeneralTab ? (isUnifiedEvent ? generalAverageRating2 : activeLog.rating2 > 0 ? activeLog.rating2 : generalAverageRating2) : activeLog.rating2} system={rating2System} min={rating2Min} max={rating2Max}
                      onChange={v => {
                        if (isUnifiedEvent && isGeneralTab) {
                          const updatesById = Object.fromEntries(unifiedSeasonIds.map(id => [id, { rating2: v }])) as Record<string, Partial<LogState>>;
                          dispatchEntry({ type: 'UPDATE_LOGS_BULK', updatesById });
                        } else {
                          dispatchEntry({ type: 'UPDATE_LOG', updates: { rating2: v } });
                        }
                      }} />
                  ) : (
                    <RatingInput rating={isGeneralTab ? (isUnifiedEvent ? generalAverageRating : activeLog.rating > 0 ? activeLog.rating : generalAverageRating) : activeLog.rating}
                      onChange={v => {
                        if (isUnifiedEvent && isGeneralTab) {
                          const updatesById = Object.fromEntries(unifiedSeasonIds.map(id => [id, { rating: v }])) as Record<string, Partial<LogState>>;
                          dispatchEntry({ type: 'UPDATE_LOGS_BULK', updatesById });
                        } else {
                          dispatchEntry({ type: 'UPDATE_LOG', updates: { rating: v } });
                        }
                      }} />
                  )}
                </HeaderField>

                {/* Dates */}
                <MediaEditorDateFields
                  te={te}
                  isMovie={isMovie}
                  isGeneralTab={isGeneralTab}
                  isUpcoming={isUpcoming}
                  startedAt={activeLog.startedAt}
                  finishedAt={activeLog.finishedAt}
                  generalStartDate={generalStartDate}
                  generalEndDate={generalEndDate}
                  activeTotalCount={activeTotalCount}
                  totalCount2={data.totalCount_2}
                  dispatchEntry={dispatchEntry}
                />
              </div>
            </div>
          </div>
          <div className="me-header-right">
            <button type="button"
              className={`me-header-icon-btn${activeLog.isFavorite ? ' active' : ''}`}
              onClick={() => dispatchEntry({ type: 'UPDATE_LOG', updates: { isFavorite: !activeLog.isFavorite } })}
              title={te.favorite}>
              <IconHeart filled={activeLog.isFavorite} size={18} />
            </button>
            {(data.type === 'game' || data.type === 'vnovel') && (
              <button type="button"
                className={`me-header-icon-btn${activeLog.isPlatinum ? ' active' : ''}`}
                onClick={() => dispatchEntry({ type: 'UPDATE_LOG', updates: { isPlatinum: !activeLog.isPlatinum } })}
                title={te.platinum}>
                <IconPlatinum filled={activeLog.isPlatinum} size={18} />
              </button>
            )}
            {isAniListType(data.type) && (
              <button type="button"
                className={`me-header-icon-btn${ui.anilistImportStatus === 'error' ? ' me-header-icon-btn--error' : ''}${ui.anilistImportStatus === 'syncing' ? ' me-header-icon-btn--spinning' : ''}`}
                onClick={handleImportFromAniList}
                disabled={ui.anilistImportStatus === 'syncing'}
                title={ui.anilistImportStatus === 'error' ? (ui.anilistImportError ?? te.anilist_error) : te.import_from_anilist}>
                {ui.anilistImportStatus === 'ok' ? <IconCheck size={16} strokeWidth={2.5} /> : <IconDownload />}
              </button>
            )}
          </div>
        </div>

        <MediaEditorVersionTabs
          te={te}
          activeLogId={entry.activeLogId}
          logs={entry.logs}
          dispatchEntry={dispatchEntry}
          externalId={externalId}
          baseId={baseId}
          titleMain={data.titleMain}
          parentGame={data.parentGame}
          isUnifiedAnime={isUnifiedAnime}
          isUnifiedEvent={isUnifiedEvent}
          isUnifiedSeries={isUnifiedSeries}
          isBundle={isBundle}
          generalLogId={GENERAL_LOG_ID}
          generalBaseTitle={generalBaseTitle}
          animeSeasonChain={animeSeasonChain}
          eventSeasons={eventSeasons}
          seriesSeasons={seriesSeasons}
          seasonMetaMap={seasonMetaMap}
          allAvailableEditions={allAvailableEditions}
        />

        {ui.loading ? (
          <div className="me-loading"><div className="spinner" /></div>
        ) : (
          <div className="me-body">
            <div className="me-content-wrapper">
              <div className="me-main-box">
                <div className="me-grid">
                  <div className="me-col">
                    <div className="me-section">
                      <span className="me-label">
                        {te.tags}
                        <span className="me-label-hint">{activeLog.tags.length}/5</span>
                      </span>
                      <div className="me-tags-box">
                        {activeLog.tags.map(tag => (
                          <span key={tag} className="me-tag">
                            {tag}
                            <button type="button" className="me-tag-remove"
                              onClick={() => dispatchEntry({ type: 'UPDATE_LOG', updates: { tags: activeLog.tags.filter(t => t !== tag) } })}>×</button>
                          </span>
                        ))}
                        {activeLog.tags.length < 5 && (
                          <input type="text" className="me-tag-input"
                            placeholder={te.add_tag}
                            value={ui.tagInput}
                            onChange={e => dispatchUi({ type: 'SET_TAG_INPUT', value: e.target.value })}
                            onKeyDown={handleTagKeyDown} />
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="me-notes-box-side">
                <span className="me-label">{te.notes}</span>
                <textarea className="me-textarea" rows={12}
                  placeholder={te.notes_ph}
                  value={activeLog.notes}
                  onChange={e => dispatchEntry({ type: 'UPDATE_LOG', updates: { notes: e.target.value } })} />

                <MediaEditorMonthGrid
                  te={te}
                  selectedYear={entry.selectedYear}
                  monthlyHistory={entry.monthlyHistory}
                  monthlyHistoryIds={monthlyHistoryIds}
                  monthMediaInfo={monthMediaInfo}
                  selectedMonthKey={selectedMonthKey}
                  dispatchEntry={dispatchEntry}
                  handleMonthClick={handleMonthClick}
                />
              </div>

              <MediaEditorActions
                te={te}
                saving={ui.saving}
                sharing={sharing}
                status={activeLog.status}
                existingEntry={activeLog.existing}
                isAniListTypeValue={isAniListType(data.type)}
                anilistStatus={ui.anilistStatus}
                anilistError={ui.anilistError}
                handleSave={handleSave}
                handleDelete={handleDelete}
                handleShare={handleShare}
              />
            </div>
          </div>
        )}
      </motion.div>
    </motion.div>
  );

  return typeof document !== 'undefined'
    ? createPortal(modal, document.body)
    : null;
}
