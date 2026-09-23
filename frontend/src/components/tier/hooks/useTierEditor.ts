import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { getTierList, saveTierList, type TierListDetail } from '../../../lib/tauri/tier-lists';
import { applyCoverPreferences } from '../../../lib/tauri/catalog';
import { boardFromDetail, boardToSaveItems, boardToTierDefs, emptyBoard, type TierItemMeta } from '../../../lib/tier/tier-board';
import {
  initialTierEditorState, tierEditorReducer, tierIsDirty, type TierEditorState,
} from '../../../lib/tier/tier-editor-state';
import { parseTierSettings, serializeTierSettings, DEFAULT_TIER_SETTINGS, type TierSettings } from '../../../lib/tier/tier-settings';
import { errorMessage, formatAppError, parseAppError } from '../../../lib/errors/format-error';
import { getT } from '../../../i18n/runtime';

// Loads one tier list, owns its undoable draft and autosaves it: every
// draft or settings change schedules a save AUTOSAVE_MS later; saves run one
// at a time and a change landing mid-save queues exactly one more. Leaving
// the page (View Transitions navigation or window close) flushes whatever is
// still pending.

const AUTOSAVE_MS = 700;

export type TierLoadStatus = 'loading' | 'ready' | 'missing' | 'error';
export type TierSaveStatus = 'idle' | 'saving' | 'saved' | 'error';

function metaFromDetail(detail: TierListDetail): Map<string, TierItemMeta> {
  // The user's per-work cover choice (media page) applies here too.
  return new Map(applyCoverPreferences(detail.items).map(i => [i.external_id, { title: i.title_main, cover: i.cover_url ?? null, type: i.media_type }]));
}

const EMPTY_STATE = initialTierEditorState({ name: '', description: '', isPublic: false, board: emptyBoard([]) });

export function useTierEditor(listId: string | null) {
  const [status, setStatus] = useState<TierLoadStatus>(listId ? 'loading' : 'missing');
  const [listType, setListType] = useState<'works' | 'characters'>('works');
  const [state, dispatch] = useReducer(tierEditorReducer, EMPTY_STATE);
  const [meta, setMeta] = useState<Map<string, TierItemMeta>>(() => new Map());
  const [settings, setSettingsState] = useState<TierSettings>(DEFAULT_TIER_SETTINGS);
  const [settingsRevision, setSettingsRevision] = useState(0);
  const [saveStatus, setSaveStatus] = useState<TierSaveStatus>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);

  const latest = useRef<{ state: TierEditorState; meta: Map<string, TierItemMeta>; settings: TierSettings; settingsRevision: number }>({
    state, meta, settings, settingsRevision,
  });
  const savedSettingsRevision = useRef(0);
  const inFlight = useRef(false);
  const queued = useRef(false);

  useEffect(() => {
    latest.current = { state, meta, settings, settingsRevision };
  });

  useEffect(() => {
    if (!listId) return;
    let cancelled = false;
    getTierList(listId)
      .then(detail => {
        if (cancelled) return;
        dispatch({
          type: 'load',
          draft: { name: detail.name, description: detail.description, isPublic: detail.is_public, board: boardFromDetail(detail.tiers, detail.items) },
        });
        setMeta(metaFromDetail(detail));
        setSettingsState(parseTierSettings(detail.settings));
        setListType(detail.list_type === 'characters' ? 'characters' : 'works');
        setStatus('ready');
      })
      .catch(err => {
        if (cancelled) return;
        console.error('get_tier_list failed', err);
        setStatus(parseAppError(errorMessage(err))?.code === 'E_TIER_LIST_NOT_FOUND' ? 'missing' : 'error');
      });
    return () => { cancelled = true; };
  }, [listId]);

  const isPending = useCallback(() => {
    const current = latest.current;
    return tierIsDirty(current.state) || current.settingsRevision !== savedSettingsRevision.current;
  }, []);

  const saveNow = useCallback(async () => {
    if (!listId) return;
    if (inFlight.current) { queued.current = true; return; }
    inFlight.current = true;
    try {
      do {
        queued.current = false;
        if (!isPending()) break;
        const { state: snapshot, meta: metaSnapshot, settings: settingsSnapshot, settingsRevision: settingsRev } = latest.current;
        const { draft } = snapshot;
        setSaveStatus('saving');
        try {
          await saveTierList({
            id: listId,
            name: draft.name,
            description: draft.description,
            is_public: draft.isPublic,
            settings: serializeTierSettings(settingsSnapshot),
            tiers: boardToTierDefs(draft.board),
            items: boardToSaveItems(draft.board, metaSnapshot),
          });
          dispatch({ type: 'saved', revision: snapshot.revision });
          savedSettingsRevision.current = settingsRev;
          setSaveError(null);
          setSaveStatus('saved');
        } catch (err) {
          console.error('save_tier_list failed', err);
          setSaveError(formatAppError(err, getT()));
          setSaveStatus('error');
          break;
        }
      } while (queued.current);
    } finally {
      inFlight.current = false;
    }
  }, [listId, isPending]);

  // Debounced autosave on every draft/settings change after the load.
  useEffect(() => {
    if (status !== 'ready' || (state.revision === state.savedRevision && settingsRevision === savedSettingsRevision.current)) return;
    const timer = setTimeout(() => { void saveNow(); }, AUTOSAVE_MS);
    return () => clearTimeout(timer);
  }, [status, state.revision, state.savedRevision, settingsRevision, saveNow]);

  // Flush on leave.
  useEffect(() => {
    const flush = () => { if (isPending()) void saveNow(); };
    document.addEventListener('astro:before-preparation', flush);
    window.addEventListener('beforeunload', flush);
    return () => {
      flush();
      document.removeEventListener('astro:before-preparation', flush);
      window.removeEventListener('beforeunload', flush);
    };
  }, [saveNow, isPending]);

  const setSettings = useCallback((patch: Partial<TierSettings>) => {
    setSettingsState(prev => ({ ...prev, ...patch }));
    setSettingsRevision(r => r + 1);
  }, []);

  const addMeta = useCallback((entries: Iterable<[string, TierItemMeta]>) => {
    setMeta(prev => {
      const next = new Map(prev);
      for (const [id, m] of entries) next.set(id, { ...next.get(id), ...m });
      return next;
    });
  }, []);

  return { status, listType, state, dispatch, meta, addMeta, settings, setSettings, saveStatus, saveError, saveNow };
}
