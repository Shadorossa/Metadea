import React, { useReducer, useEffect, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import type { LibraryEntry } from '../../lib/tauri';
import { saveLibraryEntry, getLibraryEntry, deleteLibraryEntry, readMonthlyHistory, writeMonthlyHistory, syncFavorites } from '../../lib/tauri';
import type { MediaPageData } from '../../lib/media/types';
import { RatingInput } from './RatingInput';
import { syncToAniList, isAniListType } from '../../lib/media/anilist-sync';
import { getT } from '../../i18n/client';
import {
  IconStatusPlanning, IconStatusInProgress, IconStatusCompleted,
  IconStatusPaused, IconStatusDropped,
  IconHeart, IconPlatinum, IconCheck, IconAlertCircle,
} from '../local/ui/icons';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Props {
  externalId: string;
  data: MediaPageData;
  onClose: () => void;
  onSaved: (entry: LibraryEntry) => void;
  onDeleted: () => void;
  initialEntry?: LibraryEntry;
}

type AniListStatus = 'idle' | 'syncing' | 'ok' | 'error';

// Log specific values
interface LogState {
  existing:        LibraryEntry | null;
  status:          string;
  rating:          number;
  progress:        number;
  progressCount2:  number;
  notes:           string;
  startedAt:       string;
  finishedAt:      string;
  isFavorite:      boolean;
  isPlatinum:      boolean;
  tags:            string[];
  platform:        string;
  selectedVersion: string;
}

// Entry state holds every log keyed by external_id (one per version/edition)
// plus the switching bookkeeping. The active log's own values are read
// straight out of `logs` (see the `activeLog` derivation below) instead of
// being duplicated onto this type — a single source of truth per log.
interface EntryState {
  monthlyHistory:   Record<string, string[]>;
  selectedMonthKey: string | null;
  selectedYear:     number;
  activeLogId:      string;
  logs:             Record<string, LogState>;
}

type EntryAction =
  | { type: 'LOAD_LOG';     id: string; entry: LibraryEntry }
  | { type: 'SWITCH_LOG';   id: string }
  | { type: 'UPDATE_LOG';   updates: Partial<LogState> }
  | { type: 'SET_VERSION';  value: string; baseId: string }
  | { type: 'LOAD_HISTORY'; history: Record<string, string[]>; foundKey: string | null }
  | { type: 'SET_MONTH';    externalId: string; key: string | null; year: number }
  | { type: 'SET_YEAR';     delta: 1 | -1 };

// UI state: loading flags, tag input, anilist feedback
interface UiState {
  loading:       boolean;
  saving:        boolean;
  isClosing:     boolean;
  tagInput:      string;
  anilistStatus: AniListStatus;
  anilistError:  string | null;
}

type UiAction =
  | { type: 'SET_LOADING';   value: boolean }
  | { type: 'SET_SAVING';    value: boolean }
  | { type: 'SET_CLOSING' }
  | { type: 'SET_TAG_INPUT'; value: string }
  | { type: 'SET_ANILIST';   status: AniListStatus; error?: string };

// ── Reducers ──────────────────────────────────────────────────────────────────

// Blank LogState, used whenever a log is referenced (switched to, initialized,
// linked as a version) before it's ever been loaded or saved.
function createDefaultLog(status = ''): LogState {
  return {
    existing: null, status, rating: 0, progress: 0, progressCount2: 0,
    notes: '', startedAt: '', finishedAt: '', isFavorite: false, isPlatinum: false,
    tags: [], platform: '', selectedVersion: '',
  };
}

const entryInit: EntryState = {
  monthlyHistory: {}, selectedMonthKey: null,
  selectedYear: new Date().getFullYear(),
  activeLogId: '',
  logs: {},
};

// Maps a saved LibraryEntry (snake_case DB row) to the editor's LogState
// (camelCase, non-null defaults) — used whenever a log is loaded from disk.
function libraryEntryToLog(e: LibraryEntry): LogState {
  return {
    existing: e,
    status:        e.status        ?? '',
    rating:        e.rating        ?? 0,
    progress:      e.progress      ?? 0,
    progressCount2: e.progress_2 ?? 0,
    notes:         e.notes         ?? '',
    startedAt:     e.started_at    ?? '',
    finishedAt:    e.finished_at   ?? '',
    isFavorite:    e.is_favorite   === 1,
    isPlatinum:    e.is_platinum   === 1,
    tags:          e.tags          ?? [],
    platform:      e.selected_platform ?? '',
    selectedVersion: e.selected_version ?? '',
  };
}

function entryReducer(state: EntryState, action: EntryAction): EntryState {
  switch (action.type) {
    case 'LOAD_LOG':
      return { ...state, logs: { ...state.logs, [action.id]: libraryEntryToLog(action.entry) } };
    case 'SWITCH_LOG':
      return { ...state, activeLogId: action.id };
    case 'UPDATE_LOG': {
      const id = state.activeLogId;
      const current = state.logs[id] || createDefaultLog();
      return { ...state, logs: { ...state.logs, [id]: { ...current, ...action.updates } } };
    }
    case 'SET_STATUS': {
      const id = state.activeLogId;
      const current = state.logs[id] || createDefaultLog();
      return { ...state, logs: { ...state.logs, [id]: { ...current, status: action.value } } };
    }
    case 'SET_RATING': {
      const id = state.activeLogId;
      const current = state.logs[id] || createDefaultLog();
      return { ...state, logs: { ...state.logs, [id]: { ...current, rating: action.value } } };
    }
    case 'SET_PROGRESS': {
      const id = state.activeLogId;
      const current = state.logs[id] || createDefaultLog();
      return { ...state, logs: { ...state.logs, [id]: { ...current, progress: action.value } } };
    }
    case 'SET_PROGRESS2': {
      const id = state.activeLogId;
      const current = state.logs[id] || createDefaultLog();
      return { ...state, logs: { ...state.logs, [id]: { ...current, progressCount2: action.value } } };
    }
    case 'SET_NOTES': {
      const id = state.activeLogId;
      const current = state.logs[id] || createDefaultLog();
      return { ...state, logs: { ...state.logs, [id]: { ...current, notes: action.value } } };
    }
    case 'SET_STARTED': {
      const id = state.activeLogId;
      const current = state.logs[id] || createDefaultLog();
      return { ...state, logs: { ...state.logs, [id]: { ...current, startedAt: action.value } } };
    }
    case 'SET_FINISHED': {
      const id = state.activeLogId;
      const current = state.logs[id] || createDefaultLog();
      return { ...state, logs: { ...state.logs, [id]: { ...current, finishedAt: action.value } } };
    }
    case 'TOGGLE_FAVORITE': {
      const id = state.activeLogId;
      const current = state.logs[id] || createDefaultLog();
      return { ...state, logs: { ...state.logs, [id]: { ...current, isFavorite: !current.isFavorite } } };
    }
    case 'TOGGLE_PLATINUM': {
      const id = state.activeLogId;
      const current = state.logs[id] || createDefaultLog();
      return { ...state, logs: { ...state.logs, [id]: { ...current, isPlatinum: !current.isPlatinum } } };
    }
    case 'ADD_TAG': {
      const id = state.activeLogId;
      const current = state.logs[id] || createDefaultLog();
      if (current.tags.includes(action.tag)) return state;
      return { ...state, logs: { ...state.logs, [id]: { ...current, tags: [...current.tags, action.tag] } } };
    }
    case 'REMOVE_TAG': {
      const id = state.activeLogId;
      const current = state.logs[id] || createDefaultLog();
      return { ...state, logs: { ...state.logs, [id]: { ...current, tags: current.tags.filter(t => t !== action.tag) } } };
    }
    case 'SET_PLATFORM': {
      const id = state.activeLogId;
      const current = state.logs[id] || createDefaultLog();
      return { ...state, logs: { ...state.logs, [id]: { ...current, platform: action.value } } };
    }
    case 'SET_VERSION': {
      // Only updates the base's own link list — SWITCH_LOG (always dispatched
      // right after this by the caller) handles which tab becomes active.
      const baseLog = state.logs[action.baseId] || createDefaultLog('');
      return { ...state, logs: { ...state.logs, [action.baseId]: { ...baseLog, selectedVersion: action.value } } };
    }
    case 'LOAD_HISTORY': {
      const year = action.foundKey ? Number(action.foundKey.split('-')[0]) : state.selectedYear;
      return { ...state, monthlyHistory: action.history, selectedMonthKey: action.foundKey, selectedYear: year };
    }
    case 'SET_YEAR':
      return { ...state, selectedYear: state.selectedYear + action.delta };
    case 'SET_MONTH': {
      const { externalId, key: newKey, year } = action;
      const next = { ...state.monthlyHistory };
      for (const k of Object.keys(next)) {
        next[k] = next[k].filter(id => id !== externalId);
        if (next[k].length === 0) delete next[k];
      }
      if (newKey) {
        if (!next[newKey]) next[newKey] = [];
        if (!next[newKey].includes(externalId)) next[newKey].push(externalId);
      }
      return { ...state, monthlyHistory: next, selectedMonthKey: newKey, selectedYear: year };
    }
    default: return state;
  }
}

function uiReducer(state: UiState, action: UiAction): UiState {
  switch (action.type) {
    case 'SET_LOADING':   return { ...state, loading: action.value };
    case 'SET_SAVING':    return { ...state, saving: action.value };
    case 'SET_CLOSING':   return { ...state, isClosing: true };
    case 'SET_TAG_INPUT': return { ...state, tagInput: action.value };
    case 'SET_ANILIST':   return { ...state, anilistStatus: action.status, anilistError: action.error ?? null };
    default: return state;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

// Progress field(s) shown in the header — which label(s) and step apply
// depend on the media type. progLabel matches the raw type (not its
// underscore-stripped base) to preserve each edge case's original mapping.
function getProgressConfig(type: string, tm: ReturnType<typeof getT>['media']): { label: string | null; label2: string | null; step: number } {
  const base = type.split('_')[0];

  let label: string | null;
  if (type === 'game' || type === 'vnovel')            label = tm.progress_hours;
  else if (type === 'anime' || type === 'series')      label = tm.progress_episodes;
  else if (type === 'manga' || type === 'light-novel') label = tm.progress_chapters;
  else if (type === 'books')                           label = tm.progress_percent;
  else if (type === 'movies')                          label = null;
  else                                                 label = tm.editor.progress;

  const label2 =
    base === 'anime' || base === 'series'      ? tm.progress_seasons :
    base === 'manga' || base === 'light-novel' ? tm.progress_volumes :
    base === 'books'                           ? tm.progress_books : null;

  const step = base === 'game' || base === 'vnovel' ? 0.5 : 1;
  return { label, label2, step };
}

// Placeholder LibraryEntry for a version the user has linked but never
// actually logged (no save has happened for that version's external_id yet).
function createEmptyVersionEntry(versionId: string): LibraryEntry {
  return {
    id: '', user_id: 'local', external_id: versionId, type: 'game',
    status: '', rating: null, progress: 0, progress_2: 0, minutes_spent: 0,
    is_favorite: 0, is_platinum: 0, tags: null, notes: null, added_at: null, updated_at: null,
    selected_platform: null, selected_version: null, started_at: null, finished_at: null,
  };
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

export function MediaEditorModal({ externalId, data, onClose, onSaved, onDeleted, initialEntry }: Props) {
  const t  = getT();
  const te = t.media.editor;

  const [entry, dispatchEntry] = useReducer(entryReducer, externalId, id => ({ ...entryInit, activeLogId: id }));
  const [ui,    dispatchUi]    = useReducer(uiReducer, {
    // If we already have the entry from the caller, skip loading state entirely
    loading: !initialEntry, saving: false, isClosing: false,
    tagInput: '', anilistStatus: 'idle', anilistError: null,
  });

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
        // 1. Cargar el juego base
        const baseEntry = await getLibraryEntry(bId, 'game');
        if (baseEntry) {
          dispatchEntry({ type: 'LOAD_LOG', id: bId, entry: baseEntry });
        }

        // 2. Reunir candidatos de ids relacionados (remakes, remasters, etc.) para buscar logs guardados
        const candidates = new Set<string>();
        if (data.parentGame) {
          candidates.add(data.parentGame.externalId);
        }
        for (const rel of (data.relations || [])) {
          const match = rel.url?.match(/id=([^&]+)/);
          const relExternalId = match ? decodeURIComponent(match[1]) : undefined;
          if (relExternalId && relExternalId !== bId) {
            candidates.add(relExternalId);
          }
        }

        // 3. Cargar logs existentes para los candidatos
        for (const candId of candidates) {
          const ev = await getLibraryEntry(candId, 'game');
          if (ev) {
            dispatchEntry({ type: 'LOAD_LOG', id: candId, entry: ev });
          }
        }

        // 4. Si el juego base tiene versiones enlazadas explícitamente en selected_version
        // que no se cargaron como existentes, inicializarlas vacías
        if (baseEntry && baseEntry.selected_version) {
          for (const versionId of baseEntry.selected_version.split(',')) {
            const ev = await getLibraryEntry(versionId, 'game');
            dispatchEntry({ type: 'LOAD_LOG', id: versionId, entry: ev ?? createEmptyVersionEntry(versionId) });
          }
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

  // Dynamically load newly selected edition
  useEffect(() => {
    if (!baseSelectedVersion) return;
    for (const versionId of baseSelectedVersion.split(',')) {
      getLibraryEntry(versionId, 'game')
        .then(ev => dispatchEntry({ type: 'LOAD_LOG', id: versionId, entry: ev ?? createEmptyVersionEntry(versionId) }));
    }
  }, [baseSelectedVersion]);

  const handleClose = useCallback(() => {
    dispatchUi({ type: 'SET_CLOSING' });
    setTimeout(onClose, 180);
  }, [onClose]);

  const handleMonthClick = useCallback((monthIndex: number) => {
    const targetKey = `${entry.selectedYear}-${String(monthIndex).padStart(2, '0')}`;
    const newKey = entry.selectedMonthKey === targetKey ? null : targetKey;
    dispatchEntry({ type: 'SET_MONTH', externalId, key: newKey, year: entry.selectedYear });
  }, [externalId, entry.selectedYear, entry.selectedMonthKey]);

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
      await deleteLibraryEntry(activeId, data.type);
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
    () => getProgressConfig(data.type, t.media),
    [data.type, t.media],
  );

  // Editions/versions this entry could be linked to (base game + expansions/
  // remakes/etc. from the IGDB relation list) grouped by relation type.
  const editionGroups = useMemo(() => {
    if (data.type !== 'game') return [] as { label: string; options: { externalId: string; label: string; cover?: string }[] }[];

    const groupsMap: Record<string, { externalId: string; label: string; cover?: string }[]> = {};

    if (data.parentGame) {
      groupsMap['Base Game'] = [{ externalId: data.parentGame.externalId, label: data.parentGame.title, cover: data.parentGame.cover }];
    }

    for (const rel of (data.relations || [])) {
      if (
        rel.typeLabel === 'Standalone' ||
        rel.typeLabel === 'Expansion' ||
        rel.typeLabel === 'DLC'
      ) continue;
      const match = rel.url?.match(/id=([^&]+)/);
      const relExternalId = match ? decodeURIComponent(match[1]) : undefined;
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
                      onChange={v => dispatchEntry({ type: 'UPDATE_LOG', updates: { progress: v } })} />
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
                <HeaderField label={te.started}>
                  <input type="date" className="me-header-field-input me-header-field-input--date"
                    value={activeLog.startedAt}
                    onChange={e => dispatchEntry({ type: 'UPDATE_LOG', updates: { startedAt: e.target.value } })} />
                </HeaderField>
                <HeaderField label={te.ended}>
                  <input type="date" className="me-header-field-input me-header-field-input--date"
                    value={activeLog.finishedAt}
                    onChange={e => dispatchEntry({ type: 'UPDATE_LOG', updates: { finishedAt: e.target.value } })} />
                </HeaderField>
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
                      return (
                        <button key={key} type="button"
                          className={`me-month-btn${entry.selectedMonthKey === key ? ' active' : ''}`}
                          onClick={() => handleMonthClick(mNumber)}>
                          {mName}
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
                      <><IconAlertCircle size={12} strokeWidth={2.5} /><span title={ui.anilistError ?? ''}>AniList error</span></>
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
