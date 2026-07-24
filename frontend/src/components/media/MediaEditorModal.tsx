import React, { useReducer, useEffect, useCallback, useMemo, useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { LibraryEntry } from '../../lib/tauri';
import { saveLibraryEntry, getLibraryEntry, deleteLibraryEntry, readMonthlyHistory, writeMonthlyHistory, syncFavorites, getCatalogEntry } from '../../lib/tauri';
import type { MediaPageData } from '../../lib/media/types';
import { RatingInput } from './RatingInput';
import { syncToAniList, fetchAniListLogData, isAniListType } from '../../lib/media/anilist-sync';
import type { Translations } from '../../i18n/index';
import {
  IconStatusPlanning, IconStatusInProgress, IconStatusCompleted,
  IconStatusPaused, IconStatusDropped,
  IconHeart, IconPlatinum, IconCheck, IconAlertCircle, IconDownload,
} from '../local/ui/icons';
import {
  type LogState, type EntryState, type EntryAction, type UiState, type UiAction,
  createDefaultLog, entryInit, libraryEntryToLog, entryReducer, uiReducer, createEmptyVersionEntry,
} from '../../lib/media/log-state';
import { IGDB_TYPES } from '../../lib/constants/media';
import { MODAL_CLOSE_TRANSITION_MS } from '../../lib/shared/useClosingTransition';

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
}

// ── Helpers ───────────────────────────────────────────────────────────────────

// Progress field(s) shown in the header — which label(s) and step apply
// depend on the media type. progLabel matches the raw type (not its
// underscore-stripped base) to preserve each edge case's original mapping.
function getProgressConfig(type: string, tm: Translations['media']): { label: string | null; label2: string | null; step: number } {
  const base = type.split('_')[0];

  let label: string | null;
  if (type === 'game' || type === 'vnovel')            label = tm.progress_hours;
  else if (type === 'anime' || type === 'series')      label = tm.progress_episodes;
  else if (type === 'manga' || type === 'light-novel') label = tm.progress_chapters;
  else if (type === 'books')                           label = tm.progress_percent;
  else                                                 label = tm.editor.progress;

  const label2 =
    base === 'anime' || base === 'series'      ? tm.progress_seasons :
    base === 'manga' || base === 'light-novel' ? tm.progress_volumes :
    base === 'books'                           ? tm.progress_books : null;

  const step = base === 'game' || base === 'vnovel' ? 0.5 : 1;
  return { label, label2, step };
}

// Relation cards link to another media page via "/media?id=<externalId>" —
// pull that id back out to look up/link the related game's own log.
function extractExternalIdFromRelationUrl(url: string | null | undefined): string | undefined {
  const match = url?.match(/id=([^&]+)/);
  return match ? decodeURIComponent(match[1]) : undefined;
}

// Log tab labels show only what's after the title's colon (e.g. "Trails in
// the Sky: 2nd Chapter" → "2nd Chapter") — titles rarely share a common
// prefix with the base game, so diffing against it wasn't reliable.
function editionTabLabel(editionTitle: string): string {
  if (!editionTitle) return 'Edition';
  const idx = editionTitle.indexOf(':');
  return idx === -1 ? editionTitle : editionTitle.slice(idx + 1).trim();
}

// ── Small header-field building blocks ───────────────────────────────────────

function HeaderField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="me-header-field">
      <label className="me-header-field-label">{label}</label>
      {children}
    </div>
  );
}

function NumberField({ label, value, max, step, onChange }: {
  label: string; value: number; max?: number; step: number; onChange: (v: number) => void;
}) {
  return (
    <HeaderField label={label}>
      <div className="me-header-field-row">
        <input type="number" className="me-header-field-input me-header-field-input--number" min={0}
          max={max} step={step}
          value={value || ''}
          onChange={e => {
            let v = parseFloat(e.target.value) || 0;
            if (max !== undefined && v > max) v = max;
            onChange(v);
          }}
          placeholder="0" />
        {max !== undefined && <span className="me-header-field-max">/ {max}</span>}
      </div>
    </HeaderField>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export function MediaEditorModal({ externalId, data, i18n, onClose, onSaved, onDeleted, initialEntry, initialActiveLogId }: Props) {
  const t  = i18n;
  const te = t.editor;
  // Any work whose whole "total" is a single unit (a movie, an anime movie,
  // an OVA/special with just one episode, etc.) gets the same one-shot
  // "viewing date" field as a movie instead of a started/finished range —
  // a range makes no sense when there's nothing to span.
  const isMovie = data.type === 'movie' || (data.type === 'anime' && data.format === 'MOVIE') || data.totalCount === 1;

  const [entry, dispatchEntry] = useReducer(entryReducer, externalId, id => ({ ...entryInit, activeLogId: initialActiveLogId || id }));
  const [ui,    dispatchUi]    = useReducer(uiReducer, {
    // If we already have the entry from the caller, skip loading state entirely
    loading: !initialEntry, saving: false, isClosing: false,
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
    Promise.all(missing.map(id => getCatalogEntry(id).then(e => [id, e] as const))).then(results => {
      setMonthMediaInfo(prev => {
        const next = { ...prev };
        for (const [id, e] of results) next[id] = { title: e?.title_main ?? id, cover: e?.cover_url ?? '' };
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

  const baseId = data.parentGame?.externalId || externalId;
  const baseSelectedVersion = entry.logs[baseId]?.selectedVersion || '';

  // Load base game and edition logs
  useEffect(() => {
    const loadAllVersions = async (bId: string) => {
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
          await Promise.all(baseEntry.selected_version.split(',').filter(Boolean).map(async versionId => {
            const ev = await getLibraryEntry(versionId);
            dispatchEntry({ type: 'LOAD_LOG', id: versionId, entry: ev ?? createEmptyVersionEntry(versionId) });
          }));
        }
        if (initialActiveLogId) {
          dispatchEntry({ type: 'SET_ACTIVE_LOG', id: initialActiveLogId });
        }
      } catch (err) {
        console.error('Failed to load base and versions', err);
      } finally {
        dispatchUi({ type: 'SET_LOADING', value: false });
      }
    };

    if (initialEntry) dispatchEntry({ type: 'LOAD_LOG', id: externalId, entry: initialEntry });
    loadAllVersions(baseId);

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
    dispatchUi({ type: 'SET_CLOSING' });
    setTimeout(onClose, MODAL_CLOSE_TRANSITION_MS);
  }, [onClose]);

  const handleImportFromAniList = useCallback(async () => {
    dispatchUi({ type: 'SET_ANILIST_IMPORT', status: 'syncing' });
    const result = await fetchAniListLogData(externalId, data.type);
    if (!result.ok || !result.data) {
      dispatchUi({ type: 'SET_ANILIST_IMPORT', status: 'error', error: result.error });
      return;
    }
    const { status, rating, progress, progressVolumes, startedAt, finishedAt, notes } = result.data;
    dispatchEntry({
      type: 'UPDATE_LOG',
      updates: { status, rating, progress, progressCount2: progressVolumes, startedAt, finishedAt, notes },
    });
    dispatchUi({ type: 'SET_ANILIST_IMPORT', status: 'ok' });
    setTimeout(() => dispatchUi({ type: 'SET_ANILIST_IMPORT', status: 'idle' }), 3000);
  }, [externalId, data.type]);

  const handleSave = useCallback(async () => {
    dispatchUi({ type: 'SET_SAVING', value: true });
    try {
      const baseId = data.parentGame?.externalId || externalId;

      // Editing a version's own page IS the intent to link it to its base —
      // don't require the user to have clicked through the Log tab switcher
      // for that link to actually get persisted.
      let logsToSave = entry.logs;
      if (data.parentGame && externalId !== baseId) {
        const baseLog = logsToSave[baseId] || createDefaultLog();
        const linkedIds = baseLog.selectedVersion ? baseLog.selectedVersion.split(',') : [];
        if (!linkedIds.includes(externalId)) {
          const nextSelectedVersion = [...linkedIds, externalId].join(',');
          logsToSave = { ...logsToSave, [baseId]: { ...baseLog, selectedVersion: nextSelectedVersion } };
        }
      }

      let primarySaved: LibraryEntry | null = null;

      for (const [logId, entryLog] of Object.entries(logsToSave)) {
        const isBase = logId === baseId;
        const hasLink = isBase && !!entryLog.selectedVersion;

        const isEmpty =
          !entryLog.status &&
          entryLog.rating === 0 &&
          entryLog.progress === 0 &&
          !entryLog.notes &&
          !entryLog.isFavorite &&
          !entryLog.isPlatinum &&
          entryLog.tags.length === 0 &&
          !entryLog.platform &&
          !entryLog.startedAt &&
          !entryLog.finishedAt &&
          !hasLink;

        if (isEmpty && !entryLog.existing) continue;

        const saved = await saveLibraryEntry({
          id:               entryLog.existing?.id ?? '',
          user_id:          'local',
          external_id:      logId,
          type:             data.type,
          status:           entryLog.status || null,
          rating:           entryLog.rating > 0 ? entryLog.rating : null,
          progress:         entryLog.progress,
          progress_2:       entryLog.progressCount2,
          minutes_spent:    entryLog.progress * 60,
          is_favorite:      entryLog.isFavorite ? 1 : 0,
          is_platinum:      entryLog.isPlatinum ? 1 : 0,
          tags:             entryLog.tags.length > 0 ? entryLog.tags : null,
          notes:            entryLog.notes.trim() || null,
          added_at:         entryLog.existing?.added_at ?? null,
          updated_at:       null,
          selected_platform: entryLog.platform || null,
          selected_version:  isBase ? (entryLog.selectedVersion || null) : null,
          started_at:       entryLog.startedAt || null,
          finished_at:      entryLog.finishedAt || null,
        });

        if (logId === externalId) {
          primarySaved = saved;
        }
      }

      await writeMonthlyHistory(entry.monthlyHistory);
      await syncFavorites(data.type, externalId, activeLog.isFavorite)
        .catch(e => console.error('Failed to sync favorites', e));

      try {
        const { logJourneyEvent } = await import('../../lib/profile/journey');
        if (primarySaved) {
          await logJourneyEvent(activeLog.existing, primarySaved, data.type, data.totalCount ?? undefined);
        }
      } catch (e) {
        console.error('Failed to log journey event', e);
      }

      if (primarySaved) {
        onSaved(primarySaved);
      }

      if (isAniListType(data.type)) {
        dispatchUi({ type: 'SET_ANILIST', status: 'syncing' });
        syncToAniList({
          externalId, type: data.type,
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
  }, [entry, activeLog, externalId, data.type, data.parentGame, data.totalCount, onSaved, handleClose]);

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
    () => getProgressConfig(data.type, t),
    [data.type, t],
  );

  // Editions/versions this entry could be linked to (base game + expanded editions
  // from the IGDB relation list) grouped by relation type.
  const editionGroups = useMemo(() => {
    // vnovel is its own `type` value (see IGDB_TYPES), not a variant of
    // 'game' — excluding it here meant visual novels never got the version-
    // log tabs at all, even though they go through the exact same IGDB
    // edition/relation machinery as games.
    if (!IGDB_TYPES.includes(data.type as typeof IGDB_TYPES[number])) {
      return [] as { label: string; options: { externalId: string; label: string; cover?: string }[] }[];
    }

    const groupsMap: Record<string, { externalId: string; label: string; cover?: string }[]> = {};

    if (data.parentGame) {
      groupsMap['Base Game'] = [{ externalId: data.parentGame.externalId, label: data.parentGame.title, cover: data.parentGame.cover }];
    }

    // Every "full edition" relation type (see IS_FULL_EDITION_TYPE in
    // igdb-mapper.ts) belongs here, not just Expanded Edition/Remaster —
    // Remake and Fork are equally their own trackable version. Matched by
    // relationType (a stable canonical key), never typeLabel — the latter is
    // re-derived in the UI's *current* locale on every reload
    // (sortRelationsForDisplay), so a hardcoded English label like "Expanded
    // Edition" only ever matched by coincidence, and never at all once the
    // UI language wasn't English (e.g. Spanish's "Edición expandida").
    const EDITION_RELATION_TYPES = new Set(['EXPANDED_GAME', 'REMASTER', 'REMAKE', 'FORK']);
    for (const rel of (data.relations || [])) {
      if (!rel.relationType || !EDITION_RELATION_TYPES.has(rel.relationType)) continue;
      const relExternalId = extractExternalIdFromRelationUrl(rel.url);
      if (relExternalId) {
        const groupLabel = rel.typeLabel || 'Others';
        if (!groupsMap[groupLabel]) {
          groupsMap[groupLabel] = [];
        }
        groupsMap[groupLabel].push({ externalId: relExternalId, label: rel.title, cover: rel.cover });
      }
    }

    return Object.entries(groupsMap).map(([label, options]) => ({ label, options }));
  }, [data.type, data.parentGame, data.relations]);

  const allAvailableEditions = useMemo(() => {
    const list: { externalId: string; label: string; cover?: string }[] = [];
    for (const group of editionGroups) {
      for (const opt of group.options) {
        if (opt.externalId !== baseId && !list.some(item => item.externalId === opt.externalId)) {
          list.push(opt);
        }
      }
    }
    // Viewing a version's own page: IGDB relations aren't symmetric, so this
    // version rarely lists its own siblings back — add its own tab explicitly
    // so the log switcher looks the same as it does from the base's page.
    if (data.parentGame && !list.some(item => item.externalId === externalId)) {
      list.push({ externalId, label: data.titleMain, cover: data.cover });
    }
    return list;
  }, [editionGroups, baseId, data.parentGame, externalId, data.titleMain, data.cover]);

  // Every id that represents "this same game" for monthly-history purposes —
  // the base game, whichever edition's page is currently open, and every
  // other known sibling edition. A month assigned from any one of these
  // must be recognized (and removable) from all the others.
  const sameGameIds = useMemo(
    () => new Set([baseId, externalId, ...allAvailableEditions.map(e => e.externalId)]),
    [baseId, externalId, allAvailableEditions],
  );

  // Derived instead of stored: recomputing from monthlyHistory + sameGameIds
  // on every render means it self-corrects once allAvailableEditions loads
  // (async, slightly after mount), instead of freezing on whatever the
  // initial exact-externalId-only search found.
  const selectedMonthKey = useMemo(() => {
    for (const [key, ids] of Object.entries(entry.monthlyHistory)) {
      if (ids.some(id => sameGameIds.has(id))) return key;
    }
    return null;
  }, [entry.monthlyHistory, sameGameIds]);

  const handleMonthClick = useCallback((monthIndex: number) => {
    const targetKey = `${entry.selectedYear}-${String(monthIndex).padStart(2, '0')}`;
    const newKey = selectedMonthKey === targetKey ? null : targetKey;
    dispatchEntry({ type: 'SET_MONTH', ids: [...sameGameIds], primaryId: baseId, key: newKey, year: entry.selectedYear });
  }, [sameGameIds, baseId, entry.selectedYear, selectedMonthKey]);

  // Header cover/title follow whichever log tab is active — the base game's
  // own title/cover, the current version's, or another linked edition's.
  const activeLogDisplay = useMemo(() => {
    if (entry.activeLogId === baseId) {
      return {
        title: data.parentGame ? data.parentGame.title : data.titleMain,
        cover: data.parentGame ? data.parentGame.cover : data.cover,
      };
    }
    const found = allAvailableEditions.find(ed => ed.externalId === entry.activeLogId);
    return found
      ? { title: found.label, cover: found.cover }
      : { title: data.titleMain, cover: data.cover };
  }, [entry.activeLogId, baseId, data.parentGame, data.titleMain, data.cover, allAvailableEditions]);

  const modal = (
    <div className={`me-overlay${ui.isClosing ? ' me-overlay--out' : ''}`} onClick={handleClose}>
      <div className="me-modal" onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="me-header">
          <div className="me-header-left">
            {activeLogDisplay.cover && <img src={activeLogDisplay.cover} alt="" className="me-header-cover" />}
            <div className="me-header-col">
              <span className="me-header-title">{activeLogDisplay.title}</span>
              <div className="me-header-bottom-row">
                <div className="me-header-status-row">
                  {statusButtons.map(({ value, label, Icon }) => (
                    <button
                      key={value}
                      type="button"
                      className={`me-header-status-icon${activeLog.status === value ? ' active' : ''}`}
                      onClick={() => {
                        const next = activeLog.status === value ? '' : value;
                        const updates: Partial<LogState> = { status: next };
                        if (value === 'completed' && next === 'completed') {
                          if (data.totalCount   && data.totalCount   > 0) updates.progress = data.totalCount;
                          if (data.totalCount_2 && data.totalCount_2 > 0) updates.progressCount2 = data.totalCount_2;
                        }
                        dispatchEntry({ type: 'UPDATE_LOG', updates });
                      }}
                      title={label}
                    >
                      <Icon />
                    </button>
                  ))}
                </div>

                {/* Progress input */}
                {progLabel && (
                  <div className="me-header-progress-pair">
                    <NumberField label={progLabel} value={activeLog.progress} step={progStep}
                      max={data.totalCount && data.totalCount > 0 ? data.totalCount : undefined}
                      onChange={v => {
                        const updates: Partial<LogState> = { progress: v };
                        // Reaching the known total auto-completes the entry,
                        // the same way picking "Completed" already auto-fills
                        // progress to the total (see the status buttons
                        // above) — this just closes the loop the other way.
                        if (data.totalCount && data.totalCount > 0 && v >= data.totalCount && activeLog.status !== 'completed') {
                          updates.status = 'completed';
                        }
                        dispatchEntry({ type: 'UPDATE_LOG', updates });
                      }} />
                    {label2 && data.totalCount_2 !== undefined && data.totalCount_2 !== null && data.totalCount_2 > 0 && (
                      <NumberField label={label2} value={activeLog.progressCount2} step={1}
                        max={data.totalCount_2}
                        onChange={v => dispatchEntry({ type: 'UPDATE_LOG', updates: { progressCount2: v } })} />
                    )}
                  </div>
                )}

                {/* Rating */}
                <HeaderField label={te.score}>
                  <RatingInput rating={activeLog.rating}
                    onChange={v => dispatchEntry({ type: 'UPDATE_LOG', updates: { rating: v } })} />
                </HeaderField>

                {/* Dates */}
                {isMovie ? (
                  <HeaderField label={te.view_date || 'Fecha de visionado'}>
                    <input type="date" className="me-header-field-input me-header-field-input--date"
                      value={activeLog.startedAt || activeLog.finishedAt}
                      onChange={e => {
                        const val = e.target.value;
                        const updates: Partial<LogState> = { startedAt: val, finishedAt: val };
                        if (val) {
                          updates.status = 'completed';
                          if (data.totalCount && data.totalCount > 0) updates.progress = data.totalCount;
                          if (data.totalCount_2 && data.totalCount_2 > 0) updates.progressCount2 = data.totalCount_2;
                        }
                        dispatchEntry({ type: 'UPDATE_LOG', updates });
                      }} />
                  </HeaderField>
                ) : (
                  <>
                    <HeaderField label={te.started}>
                      <input type="date" className="me-header-field-input me-header-field-input--date"
                        value={activeLog.startedAt}
                        onChange={e => dispatchEntry({ type: 'UPDATE_LOG', updates: { startedAt: e.target.value } })} />
                    </HeaderField>
                    <HeaderField label={te.ended}>
                      <input type="date" className="me-header-field-input me-header-field-input--date"
                        value={activeLog.finishedAt}
                        onChange={e => {
                          const val = e.target.value;
                          const updates: Partial<LogState> = { finishedAt: val };
                          if (val) {
                            updates.status = 'completed';
                            if (data.totalCount && data.totalCount > 0) updates.progress = data.totalCount;
                            if (data.totalCount_2 && data.totalCount_2 > 0) updates.progressCount2 = data.totalCount_2;
                          }
                          dispatchEntry({ type: 'UPDATE_LOG', updates });
                        }} />
                    </HeaderField>
                  </>
                )}
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

                    {/* Show the log switcher whenever there's a base to link to (we're
                        viewing a version) or other editions were found via IGDB relations
                        (we're viewing the base) — the base game itself never shows up in
                        allAvailableEditions since it already has its own fixed tab below. */}
                    {(data.parentGame || allAvailableEditions.length > 0) && (
                      <div className="me-section">
                        <span className="me-label">Log</span>
                        <div className="me-log-tabs">
                          <button
                            type="button"
                            className={`me-log-tab-btn${entry.activeLogId === baseId ? ' active' : ''}`}
                            onClick={() => dispatchEntry({ type: 'SWITCH_LOG', id: baseId })}
                          >
                            Base Game
                          </button>
                          {allAvailableEditions.map(ed => {
                            const isActive = entry.activeLogId === ed.externalId;
                            const cleanLabel = editionTabLabel(ed.label);
                            return (
                              <button
                                key={ed.externalId}
                                type="button"
                                className={`me-log-tab-btn${isActive ? ' active' : ''}`}
                                title={ed.label}
                                onClick={() => {
                                  const baseLogVal = entry.logs[baseId] || createDefaultLog();
                                  const currentVersions = baseLogVal.selectedVersion
                                    ? baseLogVal.selectedVersion.split(',')
                                    : [];
                                  if (!currentVersions.includes(ed.externalId)) {
                                    const nextVersions = [...currentVersions, ed.externalId].join(',');
                                    dispatchEntry({ type: 'SET_VERSION', value: nextVersions, baseId });
                                  }
                                  // Seed an empty log synchronously so the tab's
                                  // first render already matches whatever the
                                  // async fetch below will settle on (real saved
                                  // entry or the same empty shape) — without
                                  // this, activeLog falls back to
                                  // createDefaultLog() for one render, then gets
                                  // swapped for libraryEntryToLog(createEmptyVersionEntry(...))
                                  // once the effect resolves, and those two
                                  // "empty" shapes differ enough to flash visibly.
                                  if (!entry.logs[ed.externalId]) {
                                    dispatchEntry({ type: 'LOAD_LOG', id: ed.externalId, entry: createEmptyVersionEntry(ed.externalId) });
                                  }
                                  dispatchEntry({ type: 'SWITCH_LOG', id: ed.externalId });
                                }}
                              >
                                {cleanLabel}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="me-notes-box-side">
                <span className="me-label">{te.notes}</span>
                <textarea className="me-textarea" rows={12}
                  placeholder={te.notes_ph}
                  value={activeLog.notes}
                  onChange={e => dispatchEntry({ type: 'UPDATE_LOG', updates: { notes: e.target.value } })} />

                <div className="me-month-selector-section">
                  <div className="me-month-header">
                    <span className="me-label">{te.history_month}</span>
                    <div className="me-year-selector">
                      <button type="button" className="me-year-arrow"
                        onClick={() => dispatchEntry({ type: 'SET_YEAR', delta: -1 })}>&lt;</button>
                      <span className="me-year-val">{entry.selectedYear}</span>
                      <button type="button" className="me-year-arrow"
                        onClick={() => dispatchEntry({ type: 'SET_YEAR', delta: 1 })}>&gt;</button>
                    </div>
                  </div>
                  <div className="me-month-grid">
                    {te.months.map((mName, idx) => {
                      const mNumber = idx + 1;
                      const key = `${entry.selectedYear}-${String(mNumber).padStart(2, '0')}`;
                      const isSelected = selectedMonthKey === key;
                      // Only 1 game per month across the whole library — a
                      // month already claimed by a genuinely *different* game
                      // is blocked here instead of letting SET_MONTH silently
                      // pile more than one id into the same slot. Any id that
                      // belongs to *this* game (base or any known edition)
                      // never counts as taken, so the month stays freely
                      // toggleable regardless of which edition tab set it.
                      const monthIds = entry.monthlyHistory[key] ?? [];
                      const takenBy = monthIds.find(id => !sameGameIds.has(id));
                      const occupantId = takenBy ?? monthIds.find(id => sameGameIds.has(id));
                      const occupant = occupantId ? monthMediaInfo[occupantId] : undefined;
                      return (
                        <button key={key} type="button"
                          className={`me-month-btn${isSelected ? ' active' : ''}${takenBy ? ' me-month-btn--taken' : ''}${occupant?.cover ? ' me-month-btn--has-cover' : ''}`}
                          disabled={!!takenBy}
                          title={takenBy ? `${te.month_taken}${occupant ? `: ${occupant.title}` : ''}` : undefined}
                          onClick={() => handleMonthClick(mNumber)}>
                          {occupant?.cover && (
                            <>
                              {/* Blurred, cover-cropped backdrop fills the whole
                                  card (no dead space) — the sharp <img> on top,
                                  sized with object-fit:contain, shows the full
                                  poster undistorted instead of a hard crop,
                                  since posters are portrait and this card is a
                                  short rectangle. */}
                              <div className="me-month-btn-backdrop" style={{ backgroundImage: `url('${occupant.cover}')` }} />
                              <img className="me-month-btn-cover-img" src={occupant.cover} alt="" />
                            </>
                          )}
                          <span className="me-month-btn-label">{mName}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              <div className="me-button-stack-side">
                <button type="button" className="me-btn me-btn--save"
                  onClick={handleSave} disabled={ui.saving}>
                  {ui.saving ? te.saving : te.save}
                </button>
                <button type="button" className="me-btn me-btn--close"
                  onClick={handleClose}>✕</button>
                {activeLog.existing && (
                  <button type="button" className="me-btn me-btn--delete"
                    onClick={handleDelete} title={te.delete}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="3 6 5 6 21 6"></polyline>
                      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                    </svg>
                  </button>
                )}
                {isAniListType(data.type) && ui.anilistStatus !== 'idle' && (
                  <div className={`me-anilist-status me-anilist-status--${ui.anilistStatus}`}>
                    {ui.anilistStatus === 'syncing' && (
                      <><span className="me-anilist-spinner" /><span>AniList…</span></>
                    )}
                    {ui.anilistStatus === 'ok' && (
                      <><IconCheck size={12} strokeWidth={2.5} /><span>AniList</span></>
                    )}
                    {ui.anilistStatus === 'error' && (
                      <><IconAlertCircle size={12} strokeWidth={2.5} /><span title={ui.anilistError ?? ''}>{te.anilist_error}</span></>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );

  return typeof document !== 'undefined'
    ? createPortal(modal, document.body)
    : null;
}
