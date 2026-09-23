import React, { useState, useEffect, useLayoutEffect, useReducer, useRef } from 'react';
import { errorMessage } from '../../lib/errors/format-error';
import { useHydrated } from '../shared/hooks/useHydrated';
import { useKeyedState } from '../shared/hooks/useKeyedState';
import { BookOpen, GitMerge, Mic, Settings } from 'lucide-react';
import { createPortal } from 'react-dom';
import { ModalShell } from '../shared/ModalShell';
import { openSubmittedProposal } from '../../lib/github/submit-collaborative-proposal';
import { compareByReleaseDateThenTitle } from '../../lib/media/mappers/mapper-utils';
import { MediaSearchPopup } from '../search-popups/MediaSearchPopup';
import { VoiceActorSearchPopup, type VoiceActorSearchResult } from '../search-popups/VoiceActorSearchPopup';
import { FandomImportModal, type SelectedImportFields } from './FandomImportModal';
import type { FandomCharacterData } from '../../lib/character/fandom-importer';
import type { SearchResult as ApiSearchResult } from '../../lib/search';
import { getT } from '../../i18n/runtime';
import { PrEditorChangelogPanel } from '../media/pr-editor/PrEditorChangelogPanel';
import { loadCharacterEditorData } from '../../lib/character/character-editor-load';
import { submitCharacterProposal } from '../../lib/character/character-editor-submit';
import { loadMergeCandidates, type MergeCandidate } from '../../lib/character/merge-candidates';
import { applyFandomImport } from '../../lib/character/fandom-import-apply';
import { emit, on, type CharacterAppearanceSeed, type CharacterEditorApi, type CharacterEditorOpenOptions } from '../../lib/shared/state/editor-session-bus';
import type { PrEditorSessionTab } from '../../lib/media/editor/pr-editor-types';
import {
  characteristicsChanged,
  appearancesChanged,
  voiceActorsChanged,
  mergedCharactersChanged,
  buildProposalChangeSummary,
} from '../../lib/character/character-editor-diff';
import {
  characterEditorInit,
  characterEditorReducer,
  hasChanges,
  type CharacterEditorState,
} from '../../lib/character/character-editor-state';
import { useAnchoredPopover } from '../shared/useAnchoredPopover';
import { CharacterEditorSessionLayout } from './CharacterEditorSessionLayout';
import { CharacterEditorHeaderBar } from './CharacterEditorHeaderBar';
import { CharacterEditorUnsavedPrompt } from './CharacterEditorUnsavedPrompt';
import { CharacterEditorGeneralTab } from './CharacterEditorGeneralTab';
import { CharacterEditorAppearancesTab, getAppearanceTotalPages } from './CharacterEditorAppearancesTab';
import { CharacterEditorMergesTab } from './CharacterEditorMergesTab';
import { CharacterEditorVoicesTab } from './CharacterEditorVoicesTab';

type CharacterEditorTab = 'general' | 'appearances' | 'merges' | 'voices';

// A backgrounded session tab: the reducer state plus the per-tab UI bits
// that must survive switching away and back.
interface CharacterEditorDraft {
  state: CharacterEditorState;
  mergeAppearanceIds: Record<string, string>;
  activeTab: CharacterEditorTab;
  dirty: boolean;
}

export function CharacterPrEditorModal() {
  const t = getT().character_editor;
  const mounted = useHydrated();
  const [isOpen, setIsOpen] = useState(false);
  const [isSessionTab, setIsSessionTab] = useState(false);
  const [sharedSessionTabs, setSharedSessionTabs] = useState<PrEditorSessionTab[]>([]);
  const [sharedSessionActiveCharacterId, setSharedSessionActiveCharacterId] = useState<string | null>(null);
  const [currentId, setCurrentId] = useState('');
  const [characterEditorTabIds, setCharacterEditorTabIds] = useState<string[]>([]);
  const [pendingCharacterTabCloseId, setPendingCharacterTabCloseId] = useState<string | null>(null);
  const [characterTabContextMenu, setCharacterTabContextMenu] = useState<{ externalId: string; kind?: 'media' | 'character'; x: number; y: number } | null>(null);
  const [loadNonce, setLoadNonce] = useState(0);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [showUnsavedPrompt, setShowUnsavedPrompt] = useState(false);
  const [unsavedPromptShake, setUnsavedPromptShake] = useState(0);
  const [statusMsg, setStatusMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [editor, dispatch] = useReducer(characterEditorReducer, characterEditorInit);
  const { baseline, draft } = editor;
  const character = draft.character;
  const originalCharacter = baseline.character;

  const characterCacheRef = useRef<Record<string, CharacterEditorState>>({});
  const characterDraftsRef = useRef(new Map<string, CharacterEditorDraft>());
  const currentCharacterDraftRef = useRef<{ externalId: string; draft: CharacterEditorDraft; isOpen: boolean } | null>(null);
  // Set by __metadeaCharacterEditor.open's second (optional) arg, consumed
  // once by the very next loadCharacter run — the media entry a character was
  // created FROM (via PrEditorModal's "+ Crear personaje") should already be
  // in its "Apariciones en obras" list, not left for the user to search/re-add
  // by hand right after typing its name.
  const pendingAppearanceRef = useRef<CharacterAppearanceSeed | null>(null);

  const [appearancePage, setAppearancePage] = useKeyedState(currentId, 0);
  // Tracks appearances inserted by this editor session solely because a
  // source character was merged. They must disappear with that merge, while
  // manually-added appearances remain untouched.
  const [mergeAppearanceIds, setMergeAppearanceIds] = useState<Record<string, string>>({});
  const [appearanceSearchRole, setAppearanceSearchRole] = useState('SUPPORTING');
  const [appearanceSearchOpen, setAppearanceSearchOpen] = useState(false);
  const [mergeMediaSearchOpen, setMergeMediaSearchOpen] = useState(false);
  const [voiceActorSearchOpen, setVoiceActorSearchOpen] = useState(false);
  const [fandomModalOpen, setFandomModalOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<CharacterEditorTab>('general');
  const mergeInfoRef = useRef<HTMLButtonElement | null>(null);
  const mergeHint = useAnchoredPopover(mergeInfoRef, { width: 336, height: 96 });
  const contextMenuItemRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const syncSession = (detail: { tabs?: PrEditorSessionTab[]; active?: { kind?: string; externalId?: string | null } } | undefined) => {
      setSharedSessionTabs(detail?.tabs ?? []);
      setSharedSessionActiveCharacterId(detail?.active?.kind === 'character' ? detail.active.externalId ?? null : null);
    };
    const offSessionUpdate = on('metadea:pr-editor-session-update', syncSession);
    const offActiveTabChange = on('metadea:pr-editor-active-tab-change', detail => {
      setSharedSessionActiveCharacterId(detail?.kind === 'character' ? detail.externalId ?? null : null);
    });
    syncSession(window.__metadeaPrEditorSession);
    return () => {
      offSessionUpdate();
      offActiveTabChange();
    };
  }, []);

  // Session-tab context menu: focus its one action on open, close on any
  // pointer down elsewhere or Escape (see local/ui/DeleteContextMenu). Escape
  // is taken in the capture phase and marked handled so the ModalShell below
  // (document listener, skips defaultPrevented keys) doesn't also close the
  // editor.
  useEffect(() => {
    if (!characterTabContextMenu) return;
    contextMenuItemRef.current?.focus();
    const close = () => setCharacterTabContextMenu(null);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      close();
    };
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', onKeyDown, true);
    };
  }, [characterTabContextMenu]);

  const handleClose = () => {
    setIsOpen(false);
    dispatch({ type: 'reset' });
    setErrorMsg('');
    setStatusMsg('');
    setAppearanceSearchOpen(false);
    setMergeMediaSearchOpen(false);
    mergeHint.close();
    setMergeAppearanceIds({});
    setFandomModalOpen(false);
    setIsSessionTab(false);
  };

  // closeTab/prepareProposal close over render-time state, so the window
  // object (mounted once below) delegates to whatever this ref holds after
  // the latest commit — the same timing as re-registering every render.
  const latestSessionApiRef = useRef<Pick<CharacterEditorApi, 'closeTab' | 'prepareProposal'> | null>(null);

  useEffect(() => {
    const open: CharacterEditorApi['open'] = (
      externalId: string,
      initialAppearance?: CharacterAppearanceSeed,
      options?: CharacterEditorOpenOptions,
    ) => {
      setIsSessionTab(!!options?.mediaSession);
      const activeDraft = currentCharacterDraftRef.current;
      if (activeDraft?.isOpen && activeDraft.externalId !== externalId) {
        characterDraftsRef.current.set(activeDraft.externalId, activeDraft.draft);
      }
      if (activeDraft?.isOpen && activeDraft.externalId === externalId) return;
      pendingAppearanceRef.current = initialAppearance ?? null;
      setCharacterEditorTabIds(previous => previous.includes(externalId) ? previous : [...previous, externalId]);
      setPendingCharacterTabCloseId(null);
      setCharacterTabContextMenu(null);
      setShowUnsavedPrompt(false);
      setUnsavedPromptShake(0);
      setCurrentId(externalId);
      setIsOpen(true);
      setLoading(true);
      setLoadNonce(n => n + 1);
      if (options?.mediaSession) {
        const cachedTitle = characterDraftsRef.current.get(externalId)?.state.draft.name || characterCacheRef.current[externalId]?.draft.name;
        emit('metadea:character-editor-session-change', { action: 'update', externalId, title: options.title || cachedTitle || '', dirty: false });
      }
    };

    const closeSession = () => {
      setIsOpen(false);
      setIsSessionTab(false);
      setCharacterEditorTabIds([]);
      characterDraftsRef.current.clear();
      currentCharacterDraftRef.current = null;
    };

    const api: CharacterEditorApi = {
      open,
      closeSession,
      closeTab: (externalId, discard) => latestSessionApiRef.current?.closeTab(externalId, discard),
      prepareProposal: (ownerId, setStatus) => latestSessionApiRef.current?.prepareProposal(ownerId, setStatus) ?? Promise.resolve(null),
    };
    window.__metadeaCharacterEditor = api;
    return () => {
      if (window.__metadeaCharacterEditor === api) delete window.__metadeaCharacterEditor;
    };
  }, []);

  useEffect(() => {
    if (!isOpen || !currentId) return;

    const loadCharacter = async () => {
      try {
        // These links only describe additions made in the currently open
        // editor; never carry them over to a different character/session.
        setMergeAppearanceIds({});
        const tabDraft = characterDraftsRef.current.get(currentId);
        if (tabDraft) {
          dispatch({ type: 'load', state: tabDraft.state });
          setMergeAppearanceIds(tabDraft.mergeAppearanceIds);
          setActiveTab(tabDraft.activeTab);
          setErrorMsg('');
          setStatusMsg('');
          setLoading(false);
          return;
        }
        const cached = characterCacheRef.current[currentId];
        if (cached) {
          dispatch({ type: 'load', state: cached });
          setLoading(false);
          return;
        }

        const pendingAppearance = pendingAppearanceRef.current;
        pendingAppearanceRef.current = null;
        const result = await loadCharacterEditorData(currentId, pendingAppearance, 'SUPPORTING');
        dispatch({ type: 'load', state: result });
        characterCacheRef.current[currentId] = result;
      } catch (err) {
        console.error('Failed to load character:', err);
        setErrorMsg(t.load_error);
      } finally {
        setLoading(false);
      }
    };
    loadCharacter();
  }, [isOpen, currentId, loadNonce, t.load_error]);

  const hasChanged = () => hasChanges(editor);
  const appearanceTotalPages = getAppearanceTotalPages(draft.appearances);
  const safeAppearancePage = Math.min(appearancePage, appearanceTotalPages - 1);
  // Snapshot of this render's draft, refreshed on every commit — only ever
  // read from event handlers (session sync, tab switches), never during render.
  useLayoutEffect(() => {
    if (!loading && character && originalCharacter) {
      currentCharacterDraftRef.current = {
        externalId: currentId,
        isOpen,
        draft: { state: editor, mergeAppearanceIds, activeTab, dirty: hasChanged() },
      };
    } else if (!isOpen) currentCharacterDraftRef.current = null;
  });
  const requestClose = () => {
    if (isSessionTab) {
      window.__metadeaPrEditorSession?.requestClose();
      return;
    }
    const hasAnyUnsavedChanges = hasChanged() || [...characterDraftsRef.current.values()].some(draft => draft.dirty);
    if (hasAnyUnsavedChanges) {
      if (showUnsavedPrompt) setUnsavedPromptShake(previous => previous + 1);
      setShowUnsavedPrompt(true);
      return;
    }
    handleClose();
  };

  const removeCharacterEditorTab = (externalId: string, discard = false) => {
    const tabDraft = characterDraftsRef.current.get(externalId);
    const dirty = externalId === currentId ? hasChanged() : !!tabDraft?.dirty;
    if (dirty && !discard) {
      setPendingCharacterTabCloseId(externalId);
      setShowUnsavedPrompt(true);
      return;
    }
    const previousIds = characterEditorTabIds;
    const remaining = previousIds.filter(id => id !== externalId);
    setCharacterEditorTabIds(remaining);
    characterDraftsRef.current.delete(externalId);
    emit('metadea:character-editor-session-change', { action: 'close', externalId });
    if (externalId !== currentId) return;
    setShowUnsavedPrompt(false);
    setUnsavedPromptShake(0);
    setPendingCharacterTabCloseId(null);
    const controller = window.__metadeaPrEditorSession;
    if (remaining.length) {
      const oldIndex = previousIds.indexOf(externalId);
      const nextId = remaining[Math.max(0, Math.min(oldIndex - 1, remaining.length - 1))];
      window.__metadeaCharacterEditor?.open(nextId, undefined, { mediaSession: true });
      return;
    }
    const mediaTab = controller?.tabs.find(tab => tab.kind !== 'character');
    if (controller && mediaTab) {
      controller.navigate(mediaTab);
      setIsOpen(false);
      setIsSessionTab(false);
      return;
    }
    if (controller) controller.finishSession();
    else handleClose();
  };

  const sessionNavigate = (tab: PrEditorSessionTab) => {
    const controller = window.__metadeaPrEditorSession;
    if (tab.kind === 'character') {
      if (controller) controller.navigate(tab);
      else window.__metadeaCharacterEditor?.open(tab.externalId, undefined, { mediaSession: true });
      return;
    }
    if (!loading && character && originalCharacter) {
      characterDraftsRef.current.set(currentId, { state: editor, mergeAppearanceIds, activeTab, dirty: hasChanged() });
    }
    controller?.navigate(tab);
  };

  const renderSessionLayout = (panel: React.ReactNode) => {
    if (!isSessionTab) return panel;
    return (
      <CharacterEditorSessionLayout
        sharedSessionTabs={sharedSessionTabs}
        currentId={currentId}
        onNavigate={sessionNavigate}
        onTabContextMenu={(tab, event) => {
          event.preventDefault();
          setCharacterTabContextMenu({ externalId: tab.externalId, kind: tab.kind, x: event.clientX, y: event.clientY });
        }}
      >
        {panel}
      </CharacterEditorSessionLayout>
    );
  };

  const characterIsDirty = !loading && character ? hasChanged() : false;
  useEffect(() => {
    if (!isOpen || !isSessionTab || loading || !character) return;
    emit('metadea:character-editor-session-change', { action: 'update', externalId: currentId, title: draft.name || character.name, dirty: characterIsDirty });
  }, [isOpen, isSessionTab, loading, character, currentId, draft.name, characterIsDirty]);

  const removeMergedCharacter = (externalId: string) => {
    const mergeAppearanceId = mergeAppearanceIds[externalId];
    dispatch({ type: 'edit', patch: previous => ({ mergedCharacters: previous.mergedCharacters.filter(item => item.external_id !== externalId) }) });
    if (mergeAppearanceId) {
      dispatch({ type: 'edit', patch: previous => ({ appearances: previous.appearances.filter(item => item.media_external_id !== mergeAppearanceId) }) });
      setMergeAppearanceIds(previous => {
        const { [externalId]: _removed, ...remaining } = previous;
        return remaining;
      });
    }
  };
  const loadCast = (result: ApiSearchResult) =>
    loadMergeCandidates(result, currentId, draft.mergedCharacters.map(item => item.external_id));
  const addMergedCharacter = (candidate: MergeCandidate, work: ApiSearchResult) => {
    const workIsAlreadyAnAppearance = draft.appearances.some(item => item.media_external_id === work.externalId);
    dispatch({ type: 'edit', patch: previous => ({ mergedCharacters: previous.mergedCharacters.some(item => item.external_id === candidate.external_id)
      ? previous.mergedCharacters
      : [...previous.mergedCharacters, candidate] }) });
    if (!workIsAlreadyAnAppearance) {
      addAppearance(work);
      setMergeAppearanceIds(previous => ({ ...previous, [candidate.external_id]: work.externalId }));
    }
  };
  const addAppearance = (result: ApiSearchResult, relationType = 'SUPPORTING') => {
    dispatch({ type: 'edit', patch: ({ appearances: previous }) => {
      if (previous.some(a => a.media_external_id === result.externalId)) return { appearances: previous };
      const next = [...previous, {
        media_external_id: result.externalId,
        relation_type: relationType,
        title: result.titleMain || result.externalId,
        cover: result.coverUrl,
        release_year: result.releaseYear,
        release_month: result.releaseMonth,
        release_day: result.releaseDay,
      }];
      next.sort(compareByReleaseDateThenTitle);
      return { appearances: next };
    } });
  };

  const prepareCharacterProposalForSession = async (externalId: string, updateStatus: (message: string) => void) => {
    const tabDraft = currentId === externalId && currentCharacterDraftRef.current?.externalId === externalId
      ? currentCharacterDraftRef.current.draft
      : characterDraftsRef.current.get(externalId);
    const state = tabDraft?.state;
    if (!state?.baseline.character || !state.draft.character) return null;
    if (!hasChanges(state)) return null;
    return submitCharacterProposal({
      currentId: externalId,
      originalCharacter: state.baseline.character,
      baseline: state.baseline,
      draft: state.draft,
      changeSummary: buildProposalChangeSummary(state.baseline, state.draft, t.merge_change_summary),
      setStatusMsg: updateStatus,
      statusSavingLocal: t.saving_local,
      statusPreparingProposal: t.preparing_proposal,
      prepareOnly: true,
    });
  };

  useEffect(() => {
    latestSessionApiRef.current = {
      closeTab: (externalId, discard = false) => removeCharacterEditorTab(externalId, discard),
      prepareProposal: prepareCharacterProposalForSession,
    };
  });

  const handleSubmit = async () => {
    if (!originalCharacter || !hasChanged()) {
      setErrorMsg(t.no_changes);
      return;
    }

    setSubmitting(true);
    setErrorMsg('');

    try {
      const prUrl = await submitCharacterProposal({
        currentId,
        originalCharacter,
        baseline,
        draft,
        changeSummary: buildProposalChangeSummary(baseline, draft, t.merge_change_summary),
        setStatusMsg,
        statusSavingLocal: t.saving_local,
        statusPreparingProposal: t.preparing_proposal,
      });

      if (prUrl) {
        setStatusMsg(t.pr_success);
        await new Promise(r => setTimeout(r, 1500));
        delete characterCacheRef.current[currentId];
        if (isSessionTab) {
          characterDraftsRef.current.delete(currentId);
          setCharacterEditorTabIds(previous => previous.filter(id => id !== currentId));
          emit('metadea:character-editor-session-change', { action: 'close', externalId: currentId });
          const hasOtherCharacterTabs = characterEditorTabIds.some(id => id !== currentId);
          const hasMediaTabs = window.__metadeaPrEditorSession?.tabs.some(tab => tab.kind !== 'character');
          if (!hasOtherCharacterTabs && !hasMediaTabs) window.__metadeaPrEditorSession?.finishSession();
        }
        openSubmittedProposal(prUrl);
        handleClose();
      }
    } catch (err) {
      console.error('Failed to submit proposal:', err);
      setStatusMsg('');
      setErrorMsg(errorMessage(err) || t.pr_error);
    } finally {
      setSubmitting(false);
    }
  };

  const addVoiceActor = (result: VoiceActorSearchResult) => {
    dispatch({ type: 'edit', patch: ({ voiceActors: prev }) => ({ voiceActors: prev.some(v => v.externalId === result.externalId) ? prev : [...prev, {
      externalId: result.externalId,
      name: result.name,
      native: result.nameNative,
      language: 'Japanese',
      image: result.image,
      role: 'voice',
    }] }) });
  };

  const handleApplyFandomData = (data: FandomCharacterData, fields: SelectedImportFields) => {
    dispatch({ type: 'edit', patch: previous => applyFandomImport(previous, data, fields) });
    setStatusMsg(t.import_fandom_success);
    setTimeout(() => setStatusMsg(''), 4000);
  };

  if (!mounted || !isOpen) return null;

  // Same shell shape as PrEditorModal: session layout around the dialog
  // panel, everything else after it inside the overlay. A backgrounded
  // session tab (display:none) stays mounted but `active={false}` keeps it
  // off the modal stack. Escape reaches requestClose, which routes into the
  // unsaved-changes prompt (or the shared session's close request).
  const backgrounded = isSessionTab && sharedSessionActiveCharacterId !== currentId;
  const renderShell = (opts: { label: string; panelClassName: string; panel: React.ReactNode; overlayChildren?: React.ReactNode }) => (
    <ModalShell
      active={!backgrounded}
      onClose={requestClose}
      label={opts.label}
      overlayClassName={`pr-editor-overlay${isSessionTab ? '' : ' pr-editor-overlay--nested'}`}
      overlayProps={{ style: backgrounded ? { display: 'none' } : undefined }}
      panelClassName={opts.panelClassName}
      renderPanel={renderSessionLayout}
      overlayChildren={opts.overlayChildren}
    >
      {opts.panel}
    </ModalShell>
  );

  if (loading) {
    return renderShell({
      label: `${t.entry_of} ${currentId}`,
      panelClassName: 'pr-editor-modal pr-editor-modal--loading',
      panel: <div className="spinner" />,
      overlayChildren: isSessionTab && <PrEditorChangelogPanel externalId={currentId} />,
    });
  }

  if (!character) return null;

  const title = `${t.entry_of} ${draft.name || character.name}`;

  return renderShell({
    label: title,
    panelClassName: 'pr-editor-modal pr-editor-modal--narrow',
    panel: (<>
        <CharacterEditorHeaderBar
          title={title}
          currentId={currentId}
          statusMsg={statusMsg}
          submitting={submitting}
          canSubmit={isSessionTab ? !!window.__metadeaPrEditorSession?.hasChanges : hasChanged()}
          onImport={() => setFandomModalOpen(true)}
          onCancel={requestClose}
          onSubmit={() => isSessionTab ? window.__metadeaPrEditorSession?.submitProposal() : void handleSubmit()}
        />

        <div className="pr-editor-content-shell">
          <nav className="pr-editor-sidebar" aria-label={t.sections_label}>
            <button type="button" className={`pr-editor-tab-btn${activeTab === 'general' ? ' active' : ''}`} onClick={() => setActiveTab('general')} title="General" aria-label="General">
              <Settings size={18} strokeWidth={1.8} />
              {characteristicsChanged(draft.characteristics, baseline.characteristics) && <span className="pr-editor-tab-changed-dot" />}
            </button>
            <button type="button" className={`pr-editor-tab-btn${activeTab === 'appearances' ? ' active' : ''}`} onClick={() => setActiveTab('appearances')} title={t.appearances_tab} aria-label={t.appearances_tab}>
              <BookOpen size={18} strokeWidth={1.8} />
              {appearancesChanged(draft.appearances, baseline.appearances) && <span className="pr-editor-tab-changed-dot" />}
            </button>
            <button type="button" className={`pr-editor-tab-btn${activeTab === 'merges' ? ' active' : ''}`} onClick={() => setActiveTab('merges')} title={t.merge_section} aria-label={t.merge_section}>
              <GitMerge size={18} strokeWidth={1.8} />
              {mergedCharactersChanged(baseline, draft) && <span className="pr-editor-tab-changed-dot" />}
            </button>
            <button type="button" className={`pr-editor-tab-btn${activeTab === 'voices' ? ' active' : ''}`} onClick={() => setActiveTab('voices')} title={t.voice_actors} aria-label={t.voice_actors}>
              <Mic size={18} strokeWidth={1.8} />
              {voiceActorsChanged(draft.voiceActors, baseline.voiceActors) && <span className="pr-editor-tab-changed-dot" />}
            </button>
          </nav>

          <main className="pr-editor-main">
          <div className="pr-editor-body">
          {errorMsg && <div className="pr-editor-alert pr-editor-alert--error pr-editor-field--full">{errorMsg}</div>}

          {activeTab === 'general' && (
            <CharacterEditorGeneralTab baseline={baseline} draft={draft} dispatch={dispatch} setErrorMsg={setErrorMsg} />
          )}

          {activeTab === 'appearances' && (
            <CharacterEditorAppearancesTab
              appearances={draft.appearances}
              dispatch={dispatch}
              page={safeAppearancePage}
              onPageChange={setAppearancePage}
              onOpenSearch={type => {
                setAppearanceSearchRole(type);
                setAppearanceSearchOpen(true);
              }}
            />
          )}

          {activeTab === 'merges' && (
            <CharacterEditorMergesTab
              mergedCharacters={draft.mergedCharacters}
              onRemove={removeMergedCharacter}
              onOpenSearch={() => setMergeMediaSearchOpen(true)}
              mergeInfoRef={mergeInfoRef}
              mergeHint={mergeHint}
            />
          )}

          {activeTab === 'voices' && (
            <CharacterEditorVoicesTab voiceActors={draft.voiceActors} dispatch={dispatch} onOpenSearch={() => setVoiceActorSearchOpen(true)} />
          )}
          </div>
          </main>
        </div>

    </>),
    overlayChildren: (<>
      <PrEditorChangelogPanel externalId={currentId} />

      {showUnsavedPrompt && (
        <CharacterEditorUnsavedPrompt
          shake={unsavedPromptShake}
          pendingTabCloseId={pendingCharacterTabCloseId}
          submitting={submitting}
          canSubmit={hasChanged()}
          onCloseTabWithoutSaving={externalId => removeCharacterEditorTab(externalId, true)}
          onKeepEditing={() => { setPendingCharacterTabCloseId(null); setShowUnsavedPrompt(false); setUnsavedPromptShake(0); }}
          onSubmit={() => void handleSubmit()}
          onDiscard={handleClose}
        />
      )}

      {characterTabContextMenu && createPortal(
        <div className="pr-editor-session-tab-context-menu" role="menu" style={{ left: Math.min(characterTabContextMenu.x, window.innerWidth - 190), top: Math.min(characterTabContextMenu.y, window.innerHeight - 58) }} onPointerDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()}>
              <button ref={contextMenuItemRef} type="button" role="menuitem" onClick={() => {
                const tab = sharedSessionTabs.find(item => item.externalId === characterTabContextMenu.externalId && item.kind === characterTabContextMenu.kind);
                const controller = window.__metadeaPrEditorSession;
                if (tab && controller) controller.closeTab(tab);
                else removeCharacterEditorTab(characterTabContextMenu.externalId);
                setCharacterTabContextMenu(null);
              }}>{t.close_tab}</button>
        </div>,
        document.body,
      )}

      {appearanceSearchOpen && (
        <MediaSearchPopup
          onSelect={result => addAppearance(result, appearanceSearchRole)}
          onClose={() => setAppearanceSearchOpen(false)}
          excludeIds={draft.appearances.map(a => a.media_external_id)}
          multiSelect
        />
      )}

      {mergeMediaSearchOpen && (
        <MediaSearchPopup
          onSelect={() => {}}
          onClose={() => setMergeMediaSearchOpen(false)}
          closeOnSelect
          castPicker={{
            loadCast,
            onSelectCharacter: (work, candidate) => addMergedCharacter(candidate, work),
            title: t.select_character,
            loadingLabel: t.loading_characters,
            emptyLabel: t.no_characters,
            backLabel: t.back_to_works,
            errorLabel: t.merge_cast_error,
          }}
        />
      )}

      {/* Keep the hint outside the modal, whose overflow:hidden clips child tooltips. */}
      {mergeHint.position && (
        <div
          id="character-merge-info-tooltip"
          className="pr-editor-merge-tooltip"
          role="tooltip"
          style={{ top: mergeHint.position.top, left: mergeHint.position.left }}
        >
          {t.merge_hint}
        </div>
      )}

      {voiceActorSearchOpen && (
        <VoiceActorSearchPopup
          onSelect={addVoiceActor}
          onClose={() => setVoiceActorSearchOpen(false)}
          excludeIds={draft.voiceActors.map(v => v.externalId).filter((id): id is string => !!id)}
        />
      )}

      {fandomModalOpen && (
        <FandomImportModal
          isOpen={fandomModalOpen}
          onClose={() => setFandomModalOpen(false)}
          onApply={handleApplyFandomData}
        />
      )}
    </>),
  });
}
