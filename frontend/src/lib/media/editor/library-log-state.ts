// State shape and reducers for MediaEditorModal's per-version library-entry
// tracking (status/rating/progress/notes/...) — pure functions with no
// closures over the component, extracted so the modal's own file is just
// UI/orchestration.
import type { LibraryEntry } from '../../tauri';
import {
  canRedo as historyCanRedo, canUndo as historyCanUndo, createUndoHistory, recordUndoSnapshot, redoSnapshot, undoSnapshot,
  type UndoHistory,
} from '../../shared/state/undo-history';

type AniListStatus = 'idle' | 'syncing' | 'ok' | 'error';

// Log specific values
export interface LogState {
  existing:        LibraryEntry | null;
  status:          string;
  rating:          number;
  // Second, independent rating dimension (Settings > Preferencias' opt-in
  // "doble calificación") — orthogonal to the log/version system itself:
  // each version already has its own row/LogState, this is one more field
  // on it, not a new kind of version.
  rating2:         number;
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
  // Mirrors LibraryEntry.reconsumption_count / reconsuming — see
  // reconsumption-run.ts for the toggle's transitions.
  reconsumptionCount: number;
  reconsuming:     boolean;
  // Mirrors LibraryEntry.skip_filler ("Filler: Watched / Skipped", see
  // lib/anime/filler.ts). Undefined = never loaded/touched: the save omits
  // it and Rust keeps the stored value.
  skipFiller?:     boolean;
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
  // Undo/redo (mod+z / mod+y in the modal) over what the user edits — the
  // logs and the month grid. Loads start a fresh history; tab switches and
  // the year picker are navigation, not edits, so they are not recorded.
  history:          UndoHistory<EntrySnapshot>;
}

export interface EntrySnapshot {
  logs: Record<string, LogState>;
  monthlyHistory: Record<string, string[]>;
}

export type EntryAction =
  | { type: 'LOAD_LOG';     id: string; entry: LibraryEntry }
  | { type: 'SWITCH_LOG';   id: string }
  // `coalesceKey` + `at` (ms) mark a text-field keystroke (notes) so a
  // typing burst is one undo step — see lib/shared/state/undo-history.ts.
  | { type: 'UPDATE_LOG';   updates: Partial<LogState>; coalesceKey?: string; at?: number }
  // Applies its own updates per id, not one shared patch — a "mark whole
  // unified anime as completed" cascade (MediaEditorModal's general tab)
  // needs each season's progress set to ITS OWN episode total, not a single
  // shared number, so UPDATE_LOG's activeLogId-only write can't do this.
  | { type: 'UPDATE_LOGS_BULK'; updatesById: Record<string, Partial<LogState>> }
  | { type: 'SET_VERSION';  value: string; baseId: string }
  | { type: 'LOAD_HISTORY'; history: Record<string, string[]>; foundKey: string | null }
  | { type: 'SET_MONTH';    ids: string[]; primaryId: string; key: string | null; year: number }
  | { type: 'SET_SELECTED_YEAR'; year: number }
  | { type: 'SET_YEAR';     delta: 1 | -1 }
  | { type: 'UNDO' }
  | { type: 'REDO' };

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
    existing: null, status, rating: 0, rating2: 0, progress: 0, progressCount2: 0,
    notes: '', startedAt: '', finishedAt: '', isFavorite: false, isPlatinum: false,
    tags: [], platform: '', selectedVersion: '',
    reconsumptionCount: 0, reconsuming: false,
  };
}

export const entryInit: EntryState = {
  monthlyHistory: {},
  selectedYear: new Date().getFullYear(),
  activeLogId: '',
  logs: {},
  history: createUndoHistory(),
};

export function canUndoEntry(state: EntryState): boolean { return historyCanUndo(state.history); }
export function canRedoEntry(state: EntryState): boolean { return historyCanRedo(state.history); }

const snapshotOf = (state: EntryState): EntrySnapshot => ({ logs: state.logs, monthlyHistory: state.monthlyHistory });

// Records the pre-edit snapshot alongside an edited state.
function withHistory(state: EntryState, next: EntryState, options?: { coalesceKey?: string; at?: number }): EntryState {
  return { ...next, history: recordUndoSnapshot(state.history, snapshotOf(state), options) };
}

// A fixed date string this literally-shaped, rather than any malformed
// value, is specifically the fallout of a since-fixed bug (see
// fuzzyDateToString in anilist-sync.ts) that saved this exact literal to
// started_at/finished_at when AniList synced back a FuzzyDate with every
// field null — sanitized here since rows already written with it predate
// that fix and would otherwise still fail <input type="date">'s value
// format check in MediaEditorModal forever.
function sanitizeDateString(value: string | null | undefined): string {
  return value && value !== 'null-null-null' ? value : '';
}

// Maps a saved LibraryEntry (snake_case DB row) to the editor's LogState
// (camelCase, non-null defaults) — used whenever a log is loaded from disk.
export function libraryEntryToLog(e: LibraryEntry): LogState {
  return {
    existing: e,
    status:        e.status        ?? '',
    rating:        e.rating        ?? 0,
    rating2:       e.rating_2      ?? 0,
    progress:      e.progress      ?? 0,
    progressCount2: e.progress_2 ?? 0,
    notes:         e.notes         ?? '',
    startedAt:     sanitizeDateString(e.started_at),
    finishedAt:    sanitizeDateString(e.finished_at),
    isFavorite:    e.is_favorite   === 1,
    isPlatinum:    e.is_platinum   === 1,
    tags:          e.tags          ?? [],
    platform:      e.selected_platform ?? '',
    selectedVersion: e.selected_version ?? '',
    reconsumptionCount: e.reconsumption_count ?? 0,
    reconsuming:   e.reconsuming === 1,
    skipFiller:    e.skip_filler == null ? undefined : e.skip_filler === 1,
  };
}

export function entryReducer(state: EntryState, action: EntryAction): EntryState {
  switch (action.type) {
    case 'LOAD_LOG':
      return { ...state, logs: { ...state.logs, [action.id]: libraryEntryToLog(action.entry) }, history: createUndoHistory() };
    case 'SWITCH_LOG':
      return { ...state, activeLogId: action.id };
    case 'UPDATE_LOG': {
      const id = state.activeLogId;
      const current = state.logs[id] || createDefaultLog();
      return withHistory(state, { ...state, logs: { ...state.logs, [id]: { ...current, ...action.updates } } }, { coalesceKey: action.coalesceKey, at: action.at });
    }
    case 'UPDATE_LOGS_BULK': {
      const nextLogs = { ...state.logs };
      for (const [id, updates] of Object.entries(action.updatesById)) {
        const current = nextLogs[id] || createDefaultLog();
        nextLogs[id] = { ...current, ...updates };
      }
      return withHistory(state, { ...state, logs: nextLogs });
    }
    case 'SET_VERSION': {
      // Only updates the base's own link list — SWITCH_LOG (always dispatched
      // right after this by the caller) handles which tab becomes active.
      const baseLog = state.logs[action.baseId] || createDefaultLog('');
      return withHistory(state, { ...state, logs: { ...state.logs, [action.baseId]: { ...baseLog, selectedVersion: action.value } } });
    }
    case 'LOAD_HISTORY': {
      const year = action.foundKey ? Number(action.foundKey.split('-')[0]) : state.selectedYear;
      return { ...state, monthlyHistory: action.history, selectedYear: year, history: createUndoHistory() };
    }
    case 'UNDO': {
      const step = undoSnapshot(state.history, snapshotOf(state));
      return step ? { ...state, ...step.snapshot, history: step.history } : state;
    }
    case 'REDO': {
      const step = redoSnapshot(state.history, snapshotOf(state));
      return step ? { ...state, ...step.snapshot, history: step.history } : state;
    }
    case 'SET_YEAR':
      return { ...state, selectedYear: state.selectedYear + action.delta };
    case 'SET_SELECTED_YEAR':
      return { ...state, selectedYear: action.year };
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
      return withHistory(state, { ...state, monthlyHistory: next, selectedYear: year });
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
// type defaults to 'game' (every other caller is the games/editions tab
// system) — MediaEditorModal's own anime season tabs pass 'anime' instead.
export function createEmptyVersionEntry(versionId: string, type = 'game'): LibraryEntry {
  return {
    id: '', user_id: 'local', external_id: versionId, type,
    status: '', rating: null, rating_2: null, progress: 0, progress_2: 0, minutes_spent: 0,
    is_favorite: 0, is_platinum: 0, tags: null, notes: null, added_at: null, updated_at: null,
    selected_platform: null, selected_version: null, started_at: null, finished_at: null,
    reconsumption_count: 0, reconsuming: 0,
  };
}
