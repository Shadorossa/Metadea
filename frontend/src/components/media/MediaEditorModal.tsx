import React, { useReducer, useEffect, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import type { LibraryEntry } from '../../lib/tauri';
import { saveLibraryEntry, getLibraryEntry, deleteLibraryEntry, readMonthlyHistory, writeMonthlyHistory, syncFavorites } from '../../lib/tauri';
import type { MediaPageData } from '../../lib/media/types';
import { RatingInput } from './RatingInput';
import { syncToAniList, isAniListType } from '../../lib/media/anilist-sync';
import { es } from '../../i18n/es';
import { en } from '../../i18n/en';
import {
  IconStatusPlanning, IconStatusInProgress, IconStatusCompleted,
  IconStatusPaused, IconStatusDropped,
  IconHeart, IconPlatinum, IconCheck, IconAlertCircle,
} from '../local/ui/icons';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Props {
  externalId: string;
  data: MediaPageData;
  lang: string;
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

// Entry state: mirrors the fields saved to the library
interface EntryState {
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
  monthlyHistory:  Record<string, string[]>;
  selectedMonthKey: string | null;
  selectedYear:    number;
  activeLogId:     string;
  logs:            Record<string, LogState>;
}

type EntryAction =
  | { type: 'LOAD_ENTRY'; entry: LibraryEntry }
  | { type: 'LOAD_HISTORY'; history: Record<string, string[]>; foundKey: string | null }
  | { type: 'SET_STATUS';   value: string }
  | { type: 'SET_RATING';   value: number }
  | { type: 'SET_PROGRESS'; value: number }
  | { type: 'SET_PROGRESS2'; value: number }
  | { type: 'SET_NOTES';    value: string }
  | { type: 'SET_STARTED';  value: string }
  | { type: 'SET_FINISHED'; value: string }
  | { type: 'TOGGLE_FAVORITE' }
  | { type: 'TOGGLE_PLATINUM' }
  | { type: 'ADD_TAG';      tag: string }
  | { type: 'REMOVE_TAG';   tag: string }
  | { type: 'SET_PLATFORM'; value: string }
  | { type: 'SET_VERSION';  value: string; baseId: string }
  | { type: 'SET_MONTH';    externalId: string; key: string | null; year: number }
  | { type: 'SET_YEAR';     delta: 1 | -1 }
  | { type: 'LOAD_LOG';     id: string; entry: LibraryEntry }
  | { type: 'SWITCH_LOG';   id: string }
  | { type: 'INITIALIZE_LOGS'; activeLogId: string };

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

const entryInit: EntryState = {
  existing: null, status: 'planning', rating: 0, progress: 0, progressCount2: 0,
  notes: '', startedAt: '', finishedAt: '', isFavorite: false, isPlatinum: false,
  tags: [], platform: '', selectedVersion: '', monthlyHistory: {}, selectedMonthKey: null,
  selectedYear: new Date().getFullYear(),
  activeLogId: '',
  logs: {},
};

function updateActiveLog(state: EntryState, updates: Partial<LogState>): EntryState {
  const activeId = state.activeLogId || 'active';
  const current = state.logs[activeId] || {
    existing: null, status: 'planning', rating: 0, progress: 0, progressCount2: 0,
    notes: '', startedAt: '', finishedAt: '', isFavorite: false, isPlatinum: false,
    tags: [], platform: '', selectedVersion: '',
  };
  const updatedLog = { ...current, ...updates };
  return {
    ...state,
    ...updates,
    logs: { ...state.logs, [activeId]: updatedLog },
  };
}

function entryReducer(state: EntryState, action: EntryAction): EntryState {
  switch (action.type) {
    case 'LOAD_ENTRY': {
      const e = action.entry;
      const logVal: LogState = {
        existing: e,
        status:        e.status        ?? 'planning',
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
      const activeId = state.activeLogId || e.external_id;
      return {
        ...state,
        activeLogId: activeId,
        logs: { ...state.logs, [e.external_id]: logVal },
        ...(activeId === e.external_id ? logVal : {}),
      };
    }
    case 'LOAD_LOG': {
      const e = action.entry;
      const logVal: LogState = {
        existing: e,
        status:        e.status        ?? 'planning',
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
      const isCurrentlyActive = state.activeLogId === action.id;
      return {
        ...state,
        logs: { ...state.logs, [action.id]: logVal },
        ...(isCurrentlyActive ? logVal : {}),
      };
    }
    case 'SWITCH_LOG': {
      const targetId = action.id;
      const log = state.logs[targetId];
      if (!log) return state;
      return {
        ...state,
        activeLogId: targetId,
        existing:        log.existing,
        status:          log.status,
        rating:          log.rating,
        progress:        log.progress,
        progressCount2:  log.progressCount2,
        notes:           log.notes,
        startedAt:       log.startedAt,
        finishedAt:      log.finishedAt,
        isFavorite:      log.isFavorite,
        isPlatinum:      log.isPlatinum,
        tags:            log.tags,
        platform:        log.platform,
        selectedVersion: log.selectedVersion,
      };
    }
    case 'INITIALIZE_LOGS': {
      const id = action.activeLogId;
      const defaultLog: LogState = {
        existing: null, status: 'planning', rating: 0, progress: 0, progressCount2: 0,
        notes: '', startedAt: '', finishedAt: '', isFavorite: false, isPlatinum: false,
        tags: [], platform: '', selectedVersion: '',
      };
      return {
        ...state,
        activeLogId: id,
        logs: { ...state.logs, [id]: state.logs[id] || defaultLog },
      };
    }
    case 'LOAD_HISTORY': {
      const year = action.foundKey ? Number(action.foundKey.split('-')[0]) : state.selectedYear;
      return { ...state, monthlyHistory: action.history, selectedMonthKey: action.foundKey, selectedYear: year };
    }
    case 'SET_STATUS':    return updateActiveLog(state, { status: action.value });
    case 'SET_RATING':    return updateActiveLog(state, { rating: action.value });
    case 'SET_PROGRESS':  return updateActiveLog(state, { progress: action.value });
    case 'SET_PROGRESS2': return updateActiveLog(state, { progressCount2: action.value });
    case 'SET_NOTES':     return updateActiveLog(state, { notes: action.value });
    case 'SET_STARTED':   return updateActiveLog(state, { startedAt: action.value });
    case 'SET_FINISHED':  return updateActiveLog(state, { finishedAt: action.value });
    case 'TOGGLE_FAVORITE': return updateActiveLog(state, { isFavorite: !state.isFavorite });
    case 'TOGGLE_PLATINUM': return updateActiveLog(state, { isPlatinum: !state.isPlatinum });
    case 'ADD_TAG':
      if (state.tags.length >= 5 || state.tags.includes(action.tag)) return state;
      return updateActiveLog(state, { tags: [...state.tags, action.tag] });
    case 'REMOVE_TAG':
      return updateActiveLog(state, { tags: state.tags.filter(t => t !== action.tag) });
    case 'SET_PLATFORM':  return updateActiveLog(state, { platform: action.value });
    case 'SET_VERSION': {
      const baseId = action.baseId;
      const currentBaseLog = state.logs[baseId] || {
        existing: null, status: 'planning', rating: 0, progress: 0, progressCount2: 0,
        notes: '', startedAt: '', finishedAt: '', isFavorite: false, isPlatinum: false,
        tags: [], platform: '', selectedVersion: '',
      };
      const updatedBaseLog = { ...currentBaseLog, selectedVersion: action.value };
      
      const nextActiveLogId = action.value || baseId;
      const targetLog = state.logs[nextActiveLogId] || {
        existing: null, status: 'planning', rating: 0, progress: 0, progressCount2: 0,
        notes: '', startedAt: '', finishedAt: '', isFavorite: false, isPlatinum: false,
        tags: [], platform: '', selectedVersion: '',
      };

      return {
        ...state,
        activeLogId: nextActiveLogId,
        selectedVersion: action.value,
        existing:        targetLog.existing,
        status:          targetLog.status,
        rating:          targetLog.rating,
        progress:        targetLog.progress,
        progressCount2:  targetLog.progressCount2,
        notes:           targetLog.notes,
        startedAt:       targetLog.startedAt,
        finishedAt:      targetLog.finishedAt,
        isFavorite:      targetLog.isFavorite,
        isPlatinum:      targetLog.isPlatinum,
        tags:            targetLog.tags,
        platform:        targetLog.platform,
        logs: { 
          ...state.logs, 
          [baseId]: updatedBaseLog,
          [nextActiveLogId]: state.logs[nextActiveLogId] || targetLog
        },
      };
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

function progressLabel(type: string, te: typeof es.media): string | null {
  switch (type) {
    case 'game':
    case 'vnovel':       return te.progress_hours;
    case 'anime':
    case 'series':       return te.progress_episodes;
    case 'manga':
    case 'light-novel':  return te.progress_chapters;
    case 'books':        return te.progress_percent;
    case 'movies':       return null;
    default:             return te.editor.progress;
  }
}

function progressStep(type: string): number {
  const base = type.split('_')[0];
  return base === 'game' || base === 'vnovel' ? 0.5 : 1;
}

function progressLabel2(type: string, tm: typeof es.media): string {
  const base = type.split('_')[0];
  if (base === 'anime' || base === 'series')          return tm.progress_seasons;
  if (base === 'manga' || base === 'light-novel')     return tm.progress_volumes;
  if (base === 'books')                               return tm.progress_books;
  return 'Count 2';
}

function getNameDifference(baseTitle: string, editionTitle: string): string {
  if (!editionTitle) return 'Edition';
  const cleanBase = baseTitle.trim().toLowerCase();
  const cleanEdition = editionTitle.trim().toLowerCase();
  
  if (cleanEdition.startsWith(cleanBase)) {
    let diff = editionTitle.slice(baseTitle.length).trim();
    if (diff.startsWith(':') || diff.startsWith('-')) {
      diff = diff.slice(1).trim();
    }
    if (diff) return diff;
  }
  return editionTitle;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function MediaEditorModal({ externalId, data, lang, onClose, onSaved, onDeleted, initialEntry }: Props) {
  const t  = lang === 'en' ? en : es;
  const te = t.media.editor;

  const [entry, dispatchEntry] = useReducer(entryReducer, entryInit);
  const [ui,    dispatchUi]    = useReducer(uiReducer, {
    // If we already have the entry from the caller, skip loading state entirely
    loading: !initialEntry, saving: false, isClosing: false,
    tagInput: '', anilistStatus: 'idle', anilistError: null,
  });

  const baseId = data.parentGame?.externalId || externalId;
  const baseLog = entry.logs[baseId];
  const baseSelectedVersion = baseLog?.selectedVersion || '';

  // Load base game and edition logs
  useEffect(() => {

    dispatchEntry({ type: 'INITIALIZE_LOGS', activeLogId: externalId });

    if (initialEntry) {
      dispatchEntry({ type: 'LOAD_ENTRY', entry: initialEntry });
      if (initialEntry.selected_version) {
        for (const versionId of initialEntry.selected_version.split(',')) {
          getLibraryEntry(versionId, 'game')
            .then(ev => {
              if (ev) dispatchEntry({ type: 'LOAD_LOG', id: versionId, entry: ev });
            });
        }
      }
    } else {
      getLibraryEntry(baseId, 'game')
        .then(e => {
          if (e) {
            dispatchEntry({ type: 'LOAD_LOG', id: baseId, entry: e });
            if (e.selected_version) {
              for (const versionId of e.selected_version.split(',')) {
                getLibraryEntry(versionId, 'game')
                  .then(ev => {
                    if (ev) dispatchEntry({ type: 'LOAD_LOG', id: versionId, entry: ev });
                  });
              }
            }
          }
          dispatchUi({ type: 'SET_LOADING', value: false });
        })
        .catch(() => dispatchUi({ type: 'SET_LOADING', value: false }));
    }

    if (data.parentGame) {
      getLibraryEntry(externalId, 'game')
        .then(e => {
          if (e) dispatchEntry({ type: 'LOAD_LOG', id: externalId, entry: e });
        });
    }

    readMonthlyHistory()
      .then(history => {
        let foundKey: string | null = null;
        for (const [key, ids] of Object.entries(history)) {
          if (ids.includes(externalId)) { foundKey = key; break; }
        }
        dispatchEntry({ type: 'LOAD_HISTORY', history, foundKey });
      })
      .catch(() => {});
  }, [externalId, data.parentGame, data.type]); // eslint-disable-line react-hooks/exhaustive-deps

  // Dynamically load newly selected edition
  useEffect(() => {
    if (baseSelectedVersion) {
      for (const versionId of baseSelectedVersion.split(',')) {
        getLibraryEntry(versionId, 'game')
          .then(ev => {
            if (ev) {
              dispatchEntry({ type: 'LOAD_LOG', id: versionId, entry: ev });
            } else {
              dispatchEntry({
                type: 'LOAD_LOG',
                id: versionId,
                entry: {
                  id: '', user_id: 'local', external_id: versionId, type: 'game',
                  status: 'planning', rating: null, progress: 0, progress_2: 0, minutes_spent: 0,
                  is_favorite: 0, is_platinum: 0, tags: null, notes: null, added_at: null, updated_at: null,
                  selected_platform: null, selected_version: null, started_at: null, finished_at: null
                }
              });
            }
          });
      }
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
      let primarySaved: LibraryEntry | null = null;

      for (const [logId, log] of Object.entries(entry.logs)) {
        const isEmpty =
          log.status === 'planning' &&
          log.rating === 0 &&
          log.progress === 0 &&
          !log.notes &&
          !log.isFavorite &&
          !log.isPlatinum &&
          log.tags.length === 0 &&
          !log.platform &&
          !log.startedAt &&
          !log.finishedAt;

        if (isEmpty && !log.existing && logId !== externalId) continue;

        const saved = await saveLibraryEntry({
          id:               log.existing?.id ?? '',
          user_id:          'local',
          external_id:      logId,
          type:             data.type,
          status:           log.status || null,
          rating:           log.rating > 0 ? log.rating : null,
          progress:         log.progress,
          progress_2:       log.progressCount2,
          minutes_spent:    log.progress * 60,
          is_favorite:      log.isFavorite ? 1 : 0,
          is_platinum:      log.isPlatinum ? 1 : 0,
          tags:             log.tags.length > 0 ? log.tags : null,
          notes:            log.notes.trim() || null,
          added_at:         log.existing?.added_at ?? null,
          updated_at:       null,
          selected_platform: log.platform || null,
          selected_version:  logId === baseId ? (entry.selectedVersion || null) : null,
          started_at:       log.startedAt || null,
          finished_at:      log.finishedAt || null,
        });

        if (logId === externalId) {
          primarySaved = saved;
        }
      }

      const activeLog = entry.logs[entry.activeLogId] || entry;

      await writeMonthlyHistory(entry.monthlyHistory);
      await syncFavorites(data.type, externalId, activeLog.isFavorite)
        .catch(e => console.error('Failed to sync favorites', e));

      try {
        const { logJourneyEvent } = await import('../../lib/profile/journey');
        if (primarySaved) {
          await logJourneyEvent(entry.existing, primarySaved, data.type, data.totalCount ?? undefined);
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
  }, [entry, externalId, data.type, data.parentGame, onSaved, handleClose]);

  const handleDelete = useCallback(async () => {
    const activeId = entry.activeLogId || externalId;
    const existing = entry.logs[activeId]?.existing || entry.existing;
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
  }, [entry.existing, entry.logs, entry.activeLogId, externalId, data.type, onDeleted, onClose]);

  const handleTagKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      const tag = ui.tagInput.trim();
      if (tag) {
        dispatchEntry({ type: 'ADD_TAG', tag });
        dispatchUi({ type: 'SET_TAG_INPUT', value: '' });
      }
    } else if (e.key === 'Backspace' && !ui.tagInput && entry.tags.length > 0) {
      dispatchEntry({ type: 'REMOVE_TAG', tag: entry.tags[entry.tags.length - 1] });
    }
  }, [ui.tagInput, entry.tags]);

  const statusButtons = useMemo(() => [
    { value: 'planning',          label: te.status_planning,    Icon: IconStatusPlanning    },
    { value: data.progressStatus, label: te.status_in_progress, Icon: IconStatusInProgress  },
    { value: 'completed',         label: te.status_completed,   Icon: IconStatusCompleted   },
    { value: 'paused',            label: te.status_paused,      Icon: IconStatusPaused      },
    { value: 'dropped',           label: te.status_dropped,     Icon: IconStatusDropped     },
  ], [te, data.progressStatus]);

  const progLabel = progressLabel(data.type, t.media);



  // Editions/versions this entry could be linked to (base game + expansions/
  // remakes/etc. from the IGDB relation list) grouped by relation type.
  const editionGroups = useMemo(() => {
    if (data.type !== 'game') return [] as { label: string; options: { externalId: string; label: string }[] }[];

    const groupsMap: Record<string, { externalId: string; label: string }[]> = {};

    if (data.parentGame) {
      groupsMap['Base Game'] = [{ externalId: data.parentGame.externalId, label: data.parentGame.title }];
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
        groupsMap[groupLabel].push({ externalId: relExternalId, label: rel.title });
      }
    }

    return Object.entries(groupsMap).map(([label, options]) => ({ label, options }));
  }, [data.type, data.parentGame, data.relations]);

  const allAvailableEditions = useMemo(() => {
    const list: { externalId: string; label: string }[] = [];
    for (const group of editionGroups) {
      for (const opt of group.options) {
        if (opt.externalId !== baseId && !list.some(item => item.externalId === opt.externalId)) {
          list.push(opt);
        }
      }
    }
    return list;
  }, [editionGroups, baseId]);

  const modal = (
    <div className={`me-overlay${ui.isClosing ? ' me-overlay--out' : ''}`} onClick={handleClose}>
      <div className="me-modal" onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="me-header">
          <div className="me-header-left">
            {data.cover && <img src={data.cover} alt="" className="me-header-cover" />}
            <div className="me-header-col">
              <span className="me-header-title">{data.titleMain}</span>
              <div className="me-header-bottom-row">
                <div className="me-header-status-row">
                  {statusButtons.map(({ value, label, Icon }) => (
                    <button
                      key={value}
                      type="button"
                      className={`me-header-status-icon${entry.status === value ? ' active' : ''}`}
                      onClick={() => {
                        const next = entry.status === value ? '' : value;
                        dispatchEntry({ type: 'SET_STATUS', value: next });
                        if (value === 'completed' && next === 'completed') {
                          if (data.totalCount   && data.totalCount   > 0) dispatchEntry({ type: 'SET_PROGRESS',  value: data.totalCount   });
                          if (data.totalCount_2 && data.totalCount_2 > 0) dispatchEntry({ type: 'SET_PROGRESS2', value: data.totalCount_2 });
                        }
                      }}
                      title={label}
                    >
                      <Icon />
                    </button>
                  ))}
                </div>

                {/* Progress input */}
                {progLabel && (() => {
                  const maxVal   = data.totalCount   && data.totalCount   > 0 ? data.totalCount   : undefined;
                  const max2Val  = data.totalCount_2 && data.totalCount_2 > 0 ? data.totalCount_2 : undefined;
                  const label2   = progressLabel2(data.type, t.media);
                  const hasSecondary = label2 !== 'Count 2';
                  return (
                    <div style={{ display: 'flex', gap: '1.5rem', alignItems: 'flex-end' }}>
                      <div className="me-header-field">
                        <label className="me-header-field-label">{progLabel}</label>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                          <input type="number" className="me-header-field-input" min={0}
                            max={maxVal} step={progressStep(data.type)}
                            value={entry.progress || ''}
                            onChange={e => {
                              let v = parseFloat(e.target.value) || 0;
                              if (maxVal !== undefined && v > maxVal) v = maxVal;
                              dispatchEntry({ type: 'SET_PROGRESS', value: v });
                            }}
                            placeholder="0" style={{ width: '60px', order: 1 }} />
                          {maxVal !== undefined && (
                            <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)', fontWeight: 600, order: 2 }}>/ {maxVal}</span>
                          )}
                        </div>
                      </div>
                      {hasSecondary && (
                        <div className="me-header-field">
                          <label className="me-header-field-label">{label2}</label>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                            <input type="number" className="me-header-field-input" min={0}
                              max={max2Val} step={1}
                              value={entry.progressCount2 || ''}
                              onChange={e => {
                                let v = parseInt(e.target.value) || 0;
                                if (max2Val !== undefined && v > max2Val) v = max2Val;
                                dispatchEntry({ type: 'SET_PROGRESS2', value: v });
                              }}
                              placeholder="0" style={{ width: '60px', order: 1 }} />
                            {max2Val !== undefined && (
                              <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)', fontWeight: 600, order: 2 }}>/ {max2Val}</span>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })()}

                {/* Rating */}
                <div className="me-header-field">
                  <label className="me-header-field-label">{te.score}</label>
                  <RatingInput rating={entry.rating}
                    onChange={v => dispatchEntry({ type: 'SET_RATING', value: v })} />
                </div>

                {/* Dates */}
                <div className="me-header-field">
                  <label className="me-header-field-label">{te.started}</label>
                  <input type="date" className="me-header-field-input me-header-field-input--date"
                    value={entry.startedAt}
                    onChange={e => dispatchEntry({ type: 'SET_STARTED', value: e.target.value })} />
                </div>
                <div className="me-header-field">
                  <label className="me-header-field-label">{te.ended}</label>
                  <input type="date" className="me-header-field-input me-header-field-input--date"
                    value={entry.finishedAt}
                    onChange={e => dispatchEntry({ type: 'SET_FINISHED', value: e.target.value })} />
                </div>


              </div>
            </div>
          </div>
          <div className="me-header-right">
            <button type="button"
              className={`me-header-icon-btn${entry.isFavorite ? ' active' : ''}`}
              onClick={() => dispatchEntry({ type: 'TOGGLE_FAVORITE' })}
              title={te.favorite}>
              <IconHeart filled={entry.isFavorite} size={18} />
            </button>
            {(data.type === 'game' || data.type === 'vnovel') && (
              <button type="button"
                className={`me-header-icon-btn${entry.isPlatinum ? ' active' : ''}`}
                onClick={() => dispatchEntry({ type: 'TOGGLE_PLATINUM' })}
                title={te.platinum}>
                <IconPlatinum filled={entry.isPlatinum} size={18} />
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
                        <span className="me-label-hint">{entry.tags.length}/5</span>
                      </span>
                      <div className="me-tags-box">
                        {entry.tags.map(tag => (
                          <span key={tag} className="me-tag">
                            {tag}
                            <button type="button" className="me-tag-remove"
                              onClick={() => dispatchEntry({ type: 'REMOVE_TAG', tag })}>×</button>
                          </span>
                        ))}
                        {entry.tags.length < 5 && (
                          <input type="text" className="me-tag-input"
                            placeholder={te.add_tag}
                            value={ui.tagInput}
                            onChange={e => dispatchUi({ type: 'SET_TAG_INPUT', value: e.target.value })}
                            onKeyDown={handleTagKeyDown} />
                        )}
                      </div>
                    </div>

                    {allAvailableEditions.length > 0 && (
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
                            const cleanLabel = getNameDifference(
                              data.parentGame ? data.parentGame.title : data.titleMain,
                              ed.label
                            );
                            return (
                              <button
                                key={ed.externalId}
                                type="button"
                                className={`me-log-tab-btn${isActive ? ' active' : ''}`}
                                onClick={() => {
                                  const baseLogVal = entry.logs[baseId] || entry;
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
                  value={entry.notes}
                  onChange={e => dispatchEntry({ type: 'SET_NOTES', value: e.target.value })} />

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
