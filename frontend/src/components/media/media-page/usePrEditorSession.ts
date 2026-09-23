import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Translations } from '../../../i18n/index';
import type { PrEditorSessionHandle, PrEditorSessionTab } from '../../../lib/media/editor/pr-editor-types';
import { openSubmittedProposal, submitCollaborativeProposal, type ProposalFileEntry } from '../../../lib/github/submit-collaborative-proposal';
import { emit, on, type CharacterAppearanceSeed, type PrEditorSessionController } from '../../../lib/shared/state/editor-session-bus';
import { mergeProposalSessionBatches } from './proposal-session-merge';

export type { CharacterAppearanceSeed } from '../../../lib/shared/state/editor-session-bus';

const sameTabs = (a: PrEditorSessionTab[], b: PrEditorSessionTab[]) =>
  a.length === b.length && a.every((tab, index) => {
    const other = b[index];
    return tab.externalId === other.externalId
      && tab.label === other.label
      && tab.dirty === other.dirty
      && tab.affected === other.affected
      && tab.kind === other.kind;
  });

interface Options {
  currentId: string;
  currentTitle?: string;
  pe: Translations['pr_editor'];
  // Runs after a proposal lands so the page can re-fetch what it just changed.
  onSubmitted: () => void;
}

// Owns the whole "edit several catalog entries at once" session: which entries
// and characters are open, which are dirty, the unsaved-changes prompt, and the
// combined proposal submission. The character half lives in a separate editor
// that talks to us through window events and window-mounted callbacks, so the
// two editors can co-operate without importing each other.
export function usePrEditorSession({ currentId, currentTitle, pe, onSubmitted }: Options) {
  const [showPrEditor, setShowPrEditor] = useState(false);
  const [sessionIds, setSessionIds] = useState<string[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [activeCharacterId, setActiveCharacterId] = useState<string | null>(null);
  const [characterEntries, setCharacterEntries] = useState<Record<string, { title: string; dirty: boolean }>>({});
  const [dirtyById, setDirtyById] = useState<Record<string, boolean>>({});
  const [sessionTitles, setSessionTitles] = useState<Record<string, string>>({});
  const [sagaOrderById, setSagaOrderById] = useState<Record<string, string[]>>({});
  const [showExitPrompt, setShowExitPrompt] = useState(false);
  const [exitPromptShake, setExitPromptShake] = useState(0);
  const [pendingTabCloseId, setPendingTabCloseId] = useState<string | null>(null);
  const [pendingCharacterCloseId, setPendingCharacterCloseId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState('');
  const [exitError, setExitError] = useState('');
  const handles = useRef(new Map<string, PrEditorSessionHandle>());
  // Last controller published on window, kept here because the effect
  // cleanup removes it from window before the next publish can compare.
  const publishedController = useRef<PrEditorSessionController | null>(null);

  const registerSession = useCallback((externalId: string, handle: PrEditorSessionHandle | null) => {
    if (handle) handles.current.set(externalId, handle);
    else handles.current.delete(externalId);
  }, []);

  const updateDirty = useCallback((externalId: string, dirty: boolean) => {
    setDirtyById(previous => previous[externalId] === dirty ? previous : { ...previous, [externalId]: dirty });
  }, []);

  const updateSessionTitle = useCallback((externalId: string, title: string) => {
    setSessionTitles(previous => previous[externalId] === title ? previous : { ...previous, [externalId]: title });
  }, []);

  const updateSagaOrder = useCallback((externalId: string, sagaOrder: string[]) => {
    setSagaOrderById(previous => {
      const current = previous[externalId] ?? [];
      return current.length === sagaOrder.length && current.every((id, index) => id === sagaOrder[index])
        ? previous
        : { ...previous, [externalId]: sagaOrder };
    });
  }, []);

  const start = useCallback(() => {
    if (!currentId) return;
    handles.current.clear();
    setSessionIds([currentId]);
    setDirtyById({});
    setSessionTitles(currentId && currentTitle ? { [currentId]: currentTitle } : {});
    setSagaOrderById({});
    setActiveId(currentId);
    setActiveCharacterId(null);
    emit('metadea:pr-editor-active-tab-change', { kind: 'media', externalId: currentId });
    setShowExitPrompt(false);
    setExitPromptShake(0);
    setPendingTabCloseId(null);
    setStatus('');
    setExitError('');
    setShowPrEditor(true);
  }, [currentId, currentTitle]);

  const addEntry = useCallback((externalId: string) => {
    setSessionIds(previous => previous.includes(externalId) ? previous : [...previous, externalId]);
    setActiveId(externalId);
    setActiveCharacterId(null);
    emit('metadea:pr-editor-active-tab-change', { kind: 'media', externalId });
    setShowExitPrompt(false);
    setExitPromptShake(0);
    setPendingTabCloseId(null);
  }, []);

  const openCharacterTab = useCallback((externalId: string, initialAppearance?: CharacterAppearanceSeed, initialTitle?: string) => {
    setShowPrEditor(true);
    setActiveCharacterId(externalId);
    emit('metadea:pr-editor-active-tab-change', { kind: 'character', externalId });
    setCharacterEntries(previous => ({
      ...previous,
      [externalId]: { title: initialTitle || previous[externalId]?.title || pe.session_loading_character, dirty: previous[externalId]?.dirty ?? false },
    }));
    window.__metadeaCharacterEditor?.open(externalId, initialAppearance, { mediaSession: true, title: initialTitle });
  }, [pe.session_loading_character]);

  useEffect(() => {
    return on('metadea:character-editor-session-change', detail => {
      if (!detail?.externalId) return;
      if (detail.action === 'close') {
        setCharacterEntries(previous => {
          const { [detail.externalId]: _removed, ...remaining } = previous;
          return remaining;
        });
        setActiveCharacterId(current => current === detail.externalId ? null : current);
        return;
      }
      setCharacterEntries(previous => ({
        ...previous,
        [detail.externalId]: {
          title: detail.title || previous[detail.externalId]?.title || pe.session_loading_character,
          dirty: detail.dirty ?? previous[detail.externalId]?.dirty ?? false,
        },
      }));
    });
  }, [pe.session_loading_character]);

  const removeEntry = useCallback((externalId: string) => {
    const currentIndex = sessionIds.indexOf(externalId);
    const remaining = sessionIds.filter(id => id !== externalId);
    setSessionIds(remaining);
    if (!remaining.length) {
      const nextCharacterId = Object.keys(characterEntries)[0];
      if (nextCharacterId) {
        setActiveId(null);
        setActiveCharacterId(nextCharacterId);
        setDirtyById({});
        setSessionTitles({});
        setSagaOrderById({});
        handles.current.delete(externalId);
        window.__metadeaCharacterEditor?.open(nextCharacterId, undefined, { mediaSession: true });
        return;
      }
      setShowPrEditor(false);
      setActiveId(null);
      setActiveCharacterId(null);
      setDirtyById({});
      setSessionTitles({});
      setSagaOrderById({});
      setShowExitPrompt(false);
      setPendingTabCloseId(null);
      handles.current.clear();
      handles.current.delete(externalId);
      return;
    }
    if (activeId === externalId) setActiveId(remaining[Math.max(0, Math.min(currentIndex - 1, remaining.length - 1))]);
    handles.current.delete(externalId);
    setDirtyById(previous => { const { [externalId]: _removed, ...next } = previous; return next; });
    setSessionTitles(previous => { const { [externalId]: _removed, ...next } = previous; return next; });
    setSagaOrderById(previous => { const { [externalId]: _removed, ...next } = previous; return next; });
  }, [activeId, sessionIds, characterEntries]);

  const requestCloseEntry = useCallback((externalId: string) => {
    if (dirtyById[externalId]) {
      setPendingTabCloseId(externalId);
      setShowExitPrompt(true);
      return;
    }
    setShowExitPrompt(false);
    setExitPromptShake(0);
    removeEntry(externalId);
  }, [dirtyById, removeEntry]);

  const confirmCloseEntry = useCallback(() => {
    if (!pendingTabCloseId) return;
    const externalId = pendingTabCloseId;
    setShowExitPrompt(false);
    setExitPromptShake(0);
    setPendingTabCloseId(null);
    removeEntry(externalId);
  }, [pendingTabCloseId, removeEntry]);

  const confirmCloseCharacterEntry = useCallback(() => {
    if (!pendingCharacterCloseId) return;
    const externalId = pendingCharacterCloseId;
    setShowExitPrompt(false);
    setExitPromptShake(0);
    setPendingCharacterCloseId(null);
    window.__metadeaCharacterEditor?.closeTab(externalId, true);
  }, [pendingCharacterCloseId]);

  const discard = useCallback(() => {
    setShowExitPrompt(false);
    setExitPromptShake(0);
    setPendingTabCloseId(null);
    setPendingCharacterCloseId(null);
    setShowPrEditor(false);
    setSessionIds([]);
    setActiveId(null);
    setActiveCharacterId(null);
    setCharacterEntries({});
    setDirtyById({});
    setSessionTitles({});
    setSagaOrderById({});
    handles.current.clear();
    setStatus('');
    window.__metadeaCharacterEditor?.closeSession();
  }, []);

  const hasChanges = Object.values(dirtyById).some(Boolean) || Object.values(characterEntries).some(entry => entry.dirty);

  const requestClose = useCallback(() => {
    if (!Object.values(dirtyById).some(Boolean) && !Object.values(characterEntries).some(entry => entry.dirty)) {
      discard();
      return;
    }
    if (showExitPrompt) setExitPromptShake(previous => previous + 1);
    setPendingTabCloseId(null);
    setShowExitPrompt(true);
  }, [discard, dirtyById, characterEntries, showExitPrompt]);

  const submit = useCallback(async () => {
    if (submitting) return;
    setSubmitting(true);
    setStatus(pe.session_preparing);
    try {
      const batches: Array<{ ownerId: string; entries: ProposalFileEntry[] }> = [];
      const summaries: string[] = [];
      for (const [ownerId, character] of Object.entries(characterEntries)) {
        if (!character.dirty) continue;
        const prepared = await window.__metadeaCharacterEditor?.prepareProposal(ownerId, setStatus);
        if (!prepared) throw new Error(pe.session_prepare_character_failed.replace('{title}', character.title));
        batches.push({ ownerId, entries: prepared.entries });
        summaries.push(prepared.changeSummary);
      }
      for (const ownerId of sessionIds) {
        const handle = handles.current.get(ownerId);
        if (!handle?.hasChanges()) continue;
        const prepared = await handle.prepareProposal();
        if (!prepared) throw new Error(pe.session_prepare_failed.replace('{id}', ownerId));
        batches.push({ ownerId, entries: prepared.entries });
        summaries.push(prepared.changeSummary);
      }
      const entries = mergeProposalSessionBatches(batches);
      if (!entries.length) throw new Error(pe.session_no_changes);
      const primaryId = batches[0]?.ownerId || currentId;
      const proposal = await submitCollaborativeProposal(primaryId, entries, summaries.join('\n'), setStatus);
      if (!proposal) throw new Error(pe.session_proposal_failed);
      openSubmittedProposal(proposal);
      discard();
      onSubmitted();
    } catch (error) {
      console.error('Failed to submit media editor session:', error);
      setStatus('');
      setExitError(error instanceof Error ? error.message : pe.session_submit_failed);
    } finally {
      setSubmitting(false);
    }
  }, [currentId, discard, onSubmitted, pe, sessionIds, submitting, characterEntries]);

  // `affectedIds` reads the handles ref, which the registered editors mutate
  // outside React; the memo deps are the state changes that accompany those
  // registrations, which is what this derivation always effectively tracked.
  const { affectedIds, allSessionTabs } = useMemo(() => {
    const affectedIds = new Set(sessionIds.flatMap(id => handles.current.get(id)?.affectedExternalIds() ?? []));
    const insertionOrder = new Map(sessionIds.map((id, index) => [id, index]));
    const orderCandidates = sessionIds.map((id, index) => {
      const sagaOrder = sagaOrderById[id] ?? [];
      return { sagaOrder, index, coverage: sessionIds.filter(sessionId => sagaOrder.includes(sessionId)).length, active: id === activeId };
    }).sort((a, b) => b.coverage - a.coverage || Number(b.active) - Number(a.active) || b.index - a.index);
    const sagaOrderForTabs = orderCandidates[0]?.sagaOrder ?? [];
    const sagaPosition = new Map(sagaOrderForTabs.map((id, index) => [id, index]));
    const orderedSessionIds = [...sessionIds].sort((a, b) =>
      (sagaPosition.get(a) ?? Number.MAX_SAFE_INTEGER) - (sagaPosition.get(b) ?? Number.MAX_SAFE_INTEGER)
      || (insertionOrder.get(a) ?? 0) - (insertionOrder.get(b) ?? 0),
    );
    const sessionTabs: PrEditorSessionTab[] = orderedSessionIds.map(id => ({
      externalId: id,
      label: sessionTitles[id] || (id === currentId ? currentTitle : '') || pe.session_loading_work,
      dirty: dirtyById[id] ?? false,
      affected: affectedIds.has(id),
      kind: 'media',
    }));
    const allSessionTabs: PrEditorSessionTab[] = [
      ...sessionTabs,
      ...Object.entries(characterEntries).map(([externalId, character]) => ({
        externalId,
        label: character.title,
        dirty: character.dirty,
        affected: false,
        kind: 'character' as const,
      })),
    ];
    return { affectedIds, allSessionTabs };
  }, [sessionIds, activeId, dirtyById, sessionTitles, sagaOrderById, characterEntries, currentId, currentTitle, pe.session_loading_work]);

  const navigateTab = (tab: PrEditorSessionTab) => {
    emit('metadea:pr-editor-active-tab-change', { kind: tab.kind, externalId: tab.externalId });
    if (tab.kind === 'character') {
      setActiveCharacterId(tab.externalId);
      window.__metadeaCharacterEditor?.open(tab.externalId, undefined, { mediaSession: true, title: tab.label });
      return;
    }
    setActiveCharacterId(null);
    setActiveId(tab.externalId);
  };

  // Closing a character tab from inside the modal prompts when it is dirty;
  // the window controller below closes it outright, which is what the shell
  // header has always done.
  const requestCloseTab = useCallback((tab: PrEditorSessionTab) => {
    if (tab.kind === 'character') {
      if (characterEntries[tab.externalId]?.dirty) {
        setPendingCharacterCloseId(tab.externalId);
        setShowExitPrompt(true);
        return;
      }
      window.__metadeaCharacterEditor?.closeTab(tab.externalId);
      return;
    }
    requestCloseEntry(tab.externalId);
  }, [characterEntries, requestCloseEntry]);

  // The session header lives outside this subtree, so the controls it needs
  // are published on window for it to drive.
  useEffect(() => {
    const previous = publishedController.current;
    const controller: PrEditorSessionController = {
      tabs: allSessionTabs,
      active: activeCharacterId
        ? { kind: 'character', externalId: activeCharacterId }
        : { kind: 'media', externalId: activeId },
      navigate: navigateTab,
      closeTab: (tab: PrEditorSessionTab) => {
        if (tab.kind === 'character') window.__metadeaCharacterEditor?.closeTab(tab.externalId);
        else requestCloseEntry(tab.externalId);
      },
      requestClose,
      finishSession: discard,
      submitProposal: () => { void submit(); },
      hasChanges: Object.values(dirtyById).some(Boolean) || Object.values(characterEntries).some(entry => entry.dirty),
    };
    window.__metadeaPrEditorSession = controller;
    publishedController.current = controller;
    // The character editor re-renders on every update it hears; only tell it
    // when something it actually mirrors (tabs, active tab, dirtiness) moved.
    const unchanged = previous
      && sameTabs(previous.tabs, controller.tabs)
      && previous.active.kind === controller.active.kind
      && previous.active.externalId === controller.active.externalId
      && previous.hasChanges === controller.hasChanges;
    if (!unchanged) emit('metadea:pr-editor-session-update', controller);
    return () => {
      if (window.__metadeaPrEditorSession === controller) delete window.__metadeaPrEditorSession;
    };
  }, [allSessionTabs, activeCharacterId, activeId, requestClose, requestCloseEntry, discard, submit, dirtyById, characterEntries]);

  return {
    showPrEditor,
    sessionIds,
    activeId,
    activeCharacterId,
    characterEntries,
    dirtyById,
    sessionTitles,
    showExitPrompt,
    exitPromptShake,
    pendingTabCloseId,
    pendingCharacterCloseId,
    submitting,
    status,
    exitError,
    affectedIds,
    allSessionTabs,
    hasChanges,
    setActiveId,
    setPendingTabCloseId,
    setPendingCharacterCloseId,
    setShowExitPrompt,
    setExitPromptShake,
    registerSession,
    updateDirty,
    updateSessionTitle,
    updateSagaOrder,
    start,
    addEntry,
    openCharacterTab,
    requestCloseEntry,
    confirmCloseEntry,
    confirmCloseCharacterEntry,
    discard,
    requestClose,
    requestCloseTab,
    navigateTab,
    submit,
  };
}
