// State shape and reducers for MediaEditorModal's per-version library-entry
// tracking (status/rating/progress/notes/...) — pure functions with no
// closures over the component, extracted so the modal's own file is just
// UI/orchestration.
import type { LibraryEntry } from '../tauri';

type AniListStatus = 'idle' | 'syncing' | 'ok' | 'error';

// Log specific values
export interface LogState {
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
// straight out of `logs` (see the modal's `activeLog` derivation) instead of
// being duplicated onto this type — a single source of truth per log.
export interface EntryState {
  monthlyHistory:   Record<string, string[]>;
  selectedYear:     number;
  activeLogId:      string;
  logs:             Record<string, LogState>;
}

export type EntryAction =
  | { type: 'LOAD_LOG';     id: string; entry: LibraryEntry }
  | { type: 'SWITCH_LOG';   id: string }
  | { type: 'UPDATE_LOG';   updates: Partial<LogState> }
  | { type: 'SET_VERSION';  value: string; baseId: string }
  | { type: 'LOAD_HISTORY'; history: Record<string, string[]>; foundKey: string | null }
  | { type: 'SET_MONTH';    ids: string[]; primaryId: string; key: string | null; year: number }
  | { type: 'SET_YEAR';     delta: 1 | -1 };

// UI state: loading flags, tag input, anilist feedback
export interface UiState {
  loading:       boolean;
  saving:        boolean;
  isClosing:     boolean;
  tagInput:      string;
  anilistStatus: AniListStatus;
  anilistError:  string | null;
  anilistImportStatus: AniListStatus;
  anilistImportError:  string | null;
}

export type UiAction =
  | { type: 'SET_LOADING';   value: boolean }
  | { type: 'SET_SAVING';    value: boolean }
  | { type: 'SET_CLOSING' }
  | { type: 'SET_TAG_INPUT'; value: string }
  | { type: 'SET_ANILIST';   status: AniListStatus; error?: string }
  | { type: 'SET_ANILIST_IMPORT'; status: AniListStatus; error?: string };

// ── Reducers ──────────────────────────────────────────────────────────────────

// Blank LogState, used whenever a log is referenced (switched to, initialized,
// linked as a version) before it's ever been loaded or saved.
export function createDefaultLog(status = ''): LogState {
  return {
    existing: null, status, rating: 0, progress: 0, progressCount2: 0,
    notes: '', startedAt: '', finishedAt: '', isFavorite: false, isPlatinum: false,
    tags: [], platform: '', selectedVersion: '',
  };
}

export const entryInit: EntryState = {
  monthlyHistory: {},
  selectedYear: new Date().getFullYear(),
  activeLogId: '',
  logs: {},
};

// Maps a saved LibraryEntry (snake_case DB row) to the editor's LogState
// (camelCase, non-null defaults) — used whenever a log is loaded from disk.
export function libraryEntryToLog(e: LibraryEntry): LogState {
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

export function entryReducer(state: EntryState, action: EntryAction): EntryState {
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
    case 'SET_VERSION': {
      // Only updates the base's own link list — SWITCH_LOG (always dispatched
      // right after this by the caller) handles which tab becomes active.
      const baseLog = state.logs[action.baseId] || createDefaultLog('');
      return { ...state, logs: { ...state.logs, [action.baseId]: { ...baseLog, selectedVersion: action.value } } };
    }
    case 'LOAD_HISTORY': {
      const year = action.foundKey ? Number(action.foundKey.split('-')[0]) : state.selectedYear;
      return { ...state, monthlyHistory: action.history, selectedYear: year };
    }
    case 'SET_YEAR':
      return { ...state, selectedYear: state.selectedYear + action.delta };
    case 'SET_MONTH': {
      // `ids` is every external_id that represents this same game (base +
      // every known edition/version) — clearing *all* of them, not just
      // whichever id happens to be open right now, is what makes toggling a
      // month off actually work when it was set from a different edition's
      // tab than the one currently active (previously the base and each
      // edition were treated as unrelated games, so a month assigned via one
      // could never be removed from another's view).
      const { ids, primaryId, key: newKey, year } = action;
      const idSet = new Set(ids);
      const next = { ...state.monthlyHistory };
      for (const k of Object.keys(next)) {
        next[k] = next[k].filter(id => !idSet.has(id));
        if (next[k].length === 0) delete next[k];
      }
      if (newKey) {
        if (!next[newKey]) next[newKey] = [];
        if (!next[newKey].includes(primaryId)) next[newKey].push(primaryId);
      }
      return { ...state, monthlyHistory: next, selectedYear: year };
    }
    default: return state;
  }
}

export function uiReducer(state: UiState, action: UiAction): UiState {
  switch (action.type) {
    case 'SET_LOADING':   return { ...state, loading: action.value };
    case 'SET_SAVING':    return { ...state, saving: action.value };
    case 'SET_CLOSING':   return { ...state, isClosing: true };
    case 'SET_TAG_INPUT': return { ...state, tagInput: action.value };
    case 'SET_ANILIST':   return { ...state, anilistStatus: action.status, anilistError: action.error ?? null };
    case 'SET_ANILIST_IMPORT': return { ...state, anilistImportStatus: action.status, anilistImportError: action.error ?? null };
    default: return state;
  }
}

// Placeholder LibraryEntry for a version the user has linked but never
// actually logged (no save has happened for that version's external_id yet).
export function createEmptyVersionEntry(versionId: string): LibraryEntry {
  return {
    id: '', user_id: 'local', external_id: versionId, type: 'game',
    status: '', rating: null, progress: 0, progress_2: 0, minutes_spent: 0,
    is_favorite: 0, is_platinum: 0, tags: null, notes: null, added_at: null, updated_at: null,
    selected_platform: null, selected_version: null, started_at: null, finished_at: null,
  };
}
