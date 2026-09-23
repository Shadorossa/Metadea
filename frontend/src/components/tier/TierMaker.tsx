import { useCallback, useMemo, useRef, useState } from 'react';
import { getT } from '../../i18n/runtime';
import { useTierEditor } from './hooks/useTierEditor';
import { useTierLibraryData } from './hooks/useTierLibraryData';
import { useShortcuts } from '../shared/hooks/useShortcuts';
import { TierBoardView, type BoardUpdate } from './TierBoardView';
import { TierToolbar } from './TierToolbar';
import { TierPoolFiller } from './TierPoolFiller';
import { MediaSearchPopup } from '../search-popups/MediaSearchPopup';
import { CharacterSearchPopup } from '../search-popups/CharacterSearchPopup';
import {
  POOL_ID, addToPool, boardItemIds, moveItems, removeItems, resetBoard, sendToPool, type TierItemMeta,
} from '../../lib/tier/tier-board';
import { tierCanRedo, tierCanUndo, TIER_DESCRIPTION_MAX_LENGTH, TIER_NAME_MAX_LENGTH } from '../../lib/tier/tier-editor-state';
import type { TierCandidate } from '../../lib/tier/tier-candidates';
import { tierShareData } from '../../lib/tier/tier-share';
import { readShareOwner, tierListImageFileName, type ShareImageInput } from '../../lib/share-image';
import { wrapAssetUrl } from '../../lib/tauri/bridge';
import { selectDisplayCover, textlessCoverStore, textlessOf, TEXTLESS_DISABLED } from '../../lib/media/textless-covers';
import { averageScoreSuffix, formatAverageScore, getActiveRatingSystem } from '../../lib/media/rating-utils';
import { showToast } from '../../lib/dom/toast';
import type { SearchResult } from '../../lib/search/types';

// /tier/new?id=… — the TierMaker-style editor. Board logic is pure
// (lib/tier/tier-board.ts); this component wires the reducer (undo/redo,
// autosave via useTierEditor), selection, the add-items dialog and the
// share image (lib/share-image via ShareImageButton in the toolbar).

function readListId(): string | null {
  if (typeof window === 'undefined') return null;
  return new URLSearchParams(window.location.search).get('id');
}

/** Cover for the share image: the textless version when that preference resolved
 *  one, and local character images as asset URLs. */
function exportCover(id: string, cover: string): string {
  const snapshot = textlessCoverStore.snapshot(id);
  if (snapshot !== TEXTLESS_DISABLED) {
    const display = selectDisplayCover({ original: cover, manual: textlessCoverStore.manualCover(id), textless: textlessOf(snapshot), enabled: true });
    if (display.src) return display.src;
  }
  return wrapAssetUrl(cover);
}

export default function TierMaker() {
  const tAll = getT();
  const t = tAll.tier;
  const [listId] = useState(readListId);
  const editor = useTierEditor(listId);
  const { state, dispatch, meta, addMeta, settings, setSettings, listType } = editor;
  const board = state.draft.board;
  const library = useTierLibraryData(editor.status === 'ready');

  const [selection, setSelection] = useState<Set<string>>(() => new Set());
  const [fillerOpen, setFillerOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  const onBoard: BoardUpdate = useCallback((update, coalesceKey) => {
    dispatch({ type: 'board', update, coalesceKey, at: coalesceKey ? Date.now() : undefined });
  }, [dispatch]);

  const onItems = useMemo(() => new Set(boardItemIds(board)), [board]);
  // A selection only means ids still on the board (undo can remove them).
  const liveSelection = useMemo(() => new Set([...selection].filter(id => onItems.has(id))), [selection, onItems]);

  const ratingLabels = useMemo(() => {
    const system = getActiveRatingSystem();
    const labels = new Map<string, string>();
    for (const entry of library.entries) {
      if (entry.rating === null || entry.rating <= 0 || !onItems.has(entry.external_id)) continue;
      labels.set(entry.external_id, t.your_rating.replace('{rating}', formatAverageScore(entry.rating, system) + averageScoreSuffix(system)));
    }
    return labels;
  }, [library.entries, onItems, t.your_rating]);

  const addCandidates = useCallback((candidates: ReadonlyArray<Pick<TierCandidate, 'id' | 'title' | 'cover' | 'type'>>) => {
    const fresh = candidates.filter(c => !onItems.has(c.id));
    if (fresh.length === 0) { showToast(t.nothing_new); return; }
    addMeta(fresh.map(c => [c.id, { title: c.title, cover: c.cover, type: c.type } satisfies TierItemMeta]));
    onBoard(b => addToPool(b, fresh.map(c => c.id)).board);
    showToast(t.added_toast.replace('{count}', String(fresh.length)), 'success');
  }, [onItems, addMeta, onBoard, t]);

  // The multi-select search popup confirms several results in one loop:
  // batch them into one pool addition (and one toast).
  const pendingSearch = useRef<Array<Pick<TierCandidate, 'id' | 'title' | 'cover' | 'type'>>>([]);
  const addSearchResult = (result: SearchResult) => {
    pendingSearch.current.push({ id: result.externalId, title: result.titleMain || null, cover: result.coverUrl, type: result.type });
    if (pendingSearch.current.length > 1) return;
    queueMicrotask(() => {
      const batch = pendingSearch.current;
      pendingSearch.current = [];
      addCandidates(batch);
    });
  };

  useShortcuts('page', [
    { id: 'tier.undo', keys: 'mod+z', description: 'shortcuts.editor_undo', when: () => tierCanUndo(state), handler: () => dispatch({ type: 'undo' }) },
    { id: 'tier.redo', keys: ['mod+y', 'mod+shift+z'], description: 'shortcuts.editor_redo', when: () => tierCanRedo(state), handler: () => dispatch({ type: 'redo' }) },
  ], { enabled: editor.status === 'ready' });

  const { draft } = state;
  const buildShareImage = useCallback(async (): Promise<ShareImageInput> => ({
    kind: 'tierList',
    owner: readShareOwner(),
    data: tierShareData(draft.board, meta, {
      title: draft.name.trim() || t.share_untitled,
      description: draft.description,
      resolveCover: exportCover,
    }),
  }), [draft, meta, t.share_untitled]);

  if (editor.status === 'loading') return <div className="tier-state">{t.loading}</div>;
  if (editor.status !== 'ready') {
    return (
      <div className="tier-state">
        <p>{editor.status === 'missing' ? t.not_found : t.load_failed}</p>
        <a href="/tier" className="tier-btn">{t.back}</a>
      </div>
    );
  }

  const selectedIds = [...liveSelection];
  const clearSelection = () => setSelection(new Set());
  const hasRanked = board.rows.some(r => r.items.length > 0);

  return (
    <div className="tier-editor">
      <a href="/tier" className="tier-back">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true"><polyline points="15 18 9 12 15 6" /></svg>
        {t.back}
      </a>

      <header className="tier-editor-head">
        <input
          className="tier-title-input"
          value={state.draft.name}
          maxLength={TIER_NAME_MAX_LENGTH}
          placeholder={t.title_ph}
          aria-label={t.title_ph}
          onChange={e => dispatch({ type: 'text', field: 'name', value: e.target.value, at: Date.now() })}
        />
        <textarea
          className="tier-description-input"
          value={state.draft.description}
          maxLength={TIER_DESCRIPTION_MAX_LENGTH}
          rows={1}
          placeholder={t.description_ph}
          aria-label={t.description_ph}
          onChange={e => dispatch({ type: 'text', field: 'description', value: e.target.value, at: Date.now() })}
        />
      </header>

      <TierToolbar
        t={t}
        canUndo={tierCanUndo(state)}
        canRedo={tierCanRedo(state)}
        settings={settings}
        isPublic={state.draft.isPublic}
        shareLabel={tAll.share_image.button_label}
        shareFileName={tierListImageFileName(state.draft.name.trim() || t.share_untitled)}
        buildShareImage={buildShareImage}
        saveStatus={editor.saveStatus}
        saveError={editor.saveError}
        hasRanked={hasRanked}
        onAddItems={() => setFillerOpen(true)}
        onUndo={() => dispatch({ type: 'undo' })}
        onRedo={() => dispatch({ type: 'redo' })}
        onSettings={setSettings}
        onPublic={value => dispatch({ type: 'public', value })}
        onReset={() => { if (confirm(t.reset_confirm)) onBoard(resetBoard); }}
        onRetrySave={() => { void editor.saveNow(); }}
      />

      {selectedIds.length > 0 ? (
        <div className="tier-selection-bar" role="region" aria-label={t.selection_count.replace('{count}', String(selectedIds.length))}>
          <span className="tier-selection-count">{t.selection_count.replace('{count}', String(selectedIds.length))}</span>
          <select
            aria-label={t.move_selection_to}
            value=""
            onChange={e => { const to = e.target.value; if (to) { onBoard(b => moveItems(b, selectedIds, to)); clearSelection(); } }}
          >
            <option value="">{t.move_selection_to}</option>
            {board.rows.map((row, i) => <option key={row.id} value={row.id}>{row.label || String(i + 1)}</option>)}
            <option value={POOL_ID}>{t.pool_title}</option>
          </select>
          <button type="button" className="tier-btn" onClick={() => { onBoard(b => sendToPool(b, selectedIds)); clearSelection(); }}>{t.send_to_pool}</button>
          <button type="button" className="tier-btn tier-btn--danger" onClick={() => { onBoard(b => removeItems(b, selectedIds)); clearSelection(); }}>{t.remove_selected}</button>
          <button type="button" className="tier-link-btn" onClick={clearSelection}>{t.clear_selection}</button>
        </div>
      ) : (
        <p className="tier-hint">{t.board_hint}</p>
      )}

      <TierBoardView
        board={board}
        meta={meta}
        ratingLabels={ratingLabels}
        settings={settings}
        selection={liveSelection}
        onSelectionChange={setSelection}
        onBoard={onBoard}
        t={t}
      />

      {fillerOpen && (
        <TierPoolFiller
          listType={listType}
          library={library}
          exclude={onItems}
          onAdd={addCandidates}
          onOpenSearch={() => { setFillerOpen(false); setSearchOpen(true); }}
          onClose={() => setFillerOpen(false)}
          t={t}
          p={tAll.profile}
        />
      )}
      {searchOpen && listType === 'works' && (
        <MediaSearchPopup multiSelect closeOnSelect={false} excludeIds={[...onItems]} onSelect={addSearchResult} onClose={() => setSearchOpen(false)} />
      )}
      {searchOpen && listType === 'characters' && (
        <CharacterSearchPopup closeOnSelect={false} excludeIds={[...onItems]} onSelect={addSearchResult} onClose={() => setSearchOpen(false)} />
      )}
    </div>
  );
}
