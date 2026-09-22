import { useCallback, useEffect, useRef, useState } from 'react';
import type { Translations } from '../../../i18n/index';
import type { PrEditorSessionHandle, PrEditorSessionTab } from '../PrEditorModal';
import { openSubmittedProposal, submitCollaborativeProposal, type ProposalFileEntry } from '../../../lib/github/submitCollaborativeProposal';
import { mergeProposalSessionBatches } from './proposal-session-merge';

export interface CharacterAppearanceSeed {
  media_external_id: string;
  title: string;
  cover: string | null;
  release_year?: number | null;
  release_month?: number | null;
  release_day?: number | null;
}

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
    window.dispatchEvent(new CustomEvent('metadea:pr-editor-active-tab-change', { detail: { kind: 'media', externalId: currentId } }));
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
    window.dispatchEvent(new CustomEvent('metadea:pr-editor-active-tab-change', { detail: { kind: 'media', externalId } }));
    setShowExitPrompt(false);
    setExitPromptShake(0);
    setPendingTabCloseId(null);
  }, []);

  const openCharacterTab = useCallback((externalId: string, initialAppearance?: CharacterAppearanceSeed, initialTitle?: string) => {
    setShowPrEditor(true);
    setActiveCharacterId(externalId);
    window.dispatchEvent(new CustomEvent('metadea:pr-editor-active-tab-change', { detail: { kind: 'character', externalId } }));
    setCharacterEntries(previous => ({
      ...previous,
      [externalId]: { title: initialTitle || previous[externalId]?.title || pe.session_loading_character, dirty: previous[externalId]?.dirty ?? false },
    }));
    (window as any).openCharacterEditor?.(externalId, initialAppearance, { mediaSession: true, title: initialTitle });
  }, [pe.session_loading_character]);

  useEffect(() => {
    const onCharacterSessionChange = (event: Event) => {
      const detail = (event as CustomEvent<{ action: 'update' | 'close'; externalId: string; title?: string; dirty?: boolean }>).detail;
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
    };
    window.addEventListener('metadea:character-editor-session-change', onCharacterSessionChange);
    return () => window.removeEventListener('metadea:character-editor-session-change', onCharacterSessionChange);
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
        (window as any).openCharacterEditor?.(nextCharacterId, undefined, { mediaSession: true });
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
    (window as any).closeCharacterEditorTab?.(externalId, true);
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
    (window as any).closeCharacterEditorSession?.();
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
        const prepared = await (window as any).prepareCharacterEditorProposal?.(ownerId, setStatus);
        if (!prepared) throw new Error(pe.session_prepare_character_failed.replace('{title}', character.title));
        batches.push({ ownerId, entries: prepared.entries as ProposalFileEntry[] });
        summaries.push(prepared.changeSummary as string);
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

  const navigateTab = (tab: PrEditorSessionTab) => {
    window.dispatchEvent(new CustomEvent('metadea:pr-editor-active-tab-change', { detail: { kind: tab.kind, externalId: tab.externalId } }));
    if (tab.kind === 'character') {
      setActiveCharacterId(tab.externalId);
      (window as any).openCharacterEditor?.(tab.externalId, undefined, { mediaSession: true, title: tab.label });
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
      (window as any).closeCharacterEditorTab?.(tab.externalId);
      return;
    }
    requestCloseEntry(tab.externalId);
  }, [characterEntries, requestCloseEntry]);

  // The session header lives outside this subtree, so the controls it needs
  // are published on window for it to drive.
  useEffect(() => {
    const controller = {
      tabs: allSessionTabs,
      active: activeCharacterId
        ? { kind: 'character' as const, externalId: activeCharacterId }
        : { kind: 'media' as const, externalId: activeId },
      navigate: navigateTab,
      closeTab: (tab: PrEditorSessionTab) => {
        if (tab.kind === 'character') (window as any).closeCharacterEditorTab?.(tab.externalId);
        else requestCloseEntry(tab.externalId);
      },
      requestClose,
      finishSession: discard,
      submitProposal: () => { void submit(); },
      hasChanges: Object.values(dirtyById).some(Boolean) || Object.values(characterEntries).some(entry => entry.dirty),
    };
    (window as any).__metadeaPrEditorSession = controller;
    window.dispatchEvent(new CustomEvent('metadea:pr-editor-session-update', { detail: controller }));
    return () => {
      if ((window as any).__metadeaPrEditorSession === controller) delete (window as any).__metadeaPrEditorSession;
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
