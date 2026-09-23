import React, { useState, useEffect, useLayoutEffect, useMemo, useRef, useReducer, useCallback } from 'react';
import { useKeyedState } from '../shared/hooks/useKeyedState';
import { ModalShell } from '../shared/ModalShell';
import { invoke } from '../../lib/tauri';
import { getMediaAuthors, getMediaRelationsForEditor } from '../../lib/tauri/catalog';
import { invalidateCachedMediaData, fetchMediaDataInternal } from '../../lib/media/media-page-data';
import { isVnovelExternalId } from '../../lib/media/mappers/mapper-utils';
import type { MediaCatalogEntry } from '../../lib/tauri/catalog';
import { getMediaCharacters } from '../../lib/tauri/characters';
import type { SearchResult as ApiSearchResult } from '../../lib/search';
import { submitPrEditorChanges } from './pr-editor/pr-editor-submit';
import { loadComicVineIssuePreview, loadPrEditorRelationsAndSaga, resolveCatalogEntryForEditor } from './pr-editor/pr-editor-load';
import { buildPrEditorChangeSummary } from './pr-editor/pr-editor-change-summary';
import {
  affectedExternalIds as computeAffectedExternalIds, canRedo, canUndo, charactersChanged as computeCharactersChanged,
  createInitialPrEditorState, hasChanges as computeHasChanges, isFieldChanged as computeIsFieldChanged,
  prEditorReducer, type PrEditorDraft, type PrEditorDraftPatch,
} from './pr-editor/pr-editor-state';
import { useShortcuts } from '../shared/hooks/useShortcuts';
import { MediaSourceMappingSearchPopup, type MediaSourceMappingKind } from '../search-popups/MediaSourceMappingSearchPopup';
import { generateCustomCharacterId } from '../../lib/character/custom-character';
import { CONTAINS_RELATION_TYPES } from '../../lib/media/saga/saga-relation-types';
import { createMetaResolver, type MediaMeta } from '../../lib/media/saga/saga-grouping';
import { PrEditorCharactersSection } from './pr-editor/PrEditorCharactersSection';
import { PrEditorChangelogPanel } from './pr-editor/PrEditorChangelogPanel';
import { PrEditorHeaderActions } from './pr-editor/PrEditorHeaderActions';
import { PrEditorGeneralSection } from './pr-editor/PrEditorGeneralSection';
import { PrEditorRelationsTab } from './pr-editor/PrEditorRelationsTab';
import { PrEditorSidebar, type PrEditorTab, type RelationsSubtab } from './pr-editor/PrEditorSidebar';
import { PrEditorSessionLayout, PrEditorSessionTabContextMenu, type SessionTabContextMenuState } from './pr-editor/PrEditorSessionLayout';
import { PrEditorSearchPopups, PrEditorCastPickerPopup, type PrEditorSearchPopupMode } from './pr-editor/PrEditorSearchPopups';
import { usePrEditorPreviews } from './pr-editor/usePrEditorPreviews';
import { usePrEditorDraftActions } from './pr-editor/usePrEditorDraftActions';
import { PrEditorHeader } from '../shared/PrEditorHeader';
import { getT } from '../../i18n/runtime';

export type { BundledRelation, EditableRelation, PreparedMediaProposal, PrEditorSessionHandle, PrEditorSessionTab } from '../../lib/media/editor/pr-editor-types';
import type { PreparedMediaProposal, PrEditorSessionHandle, PrEditorSessionTab } from '../../lib/media/editor/pr-editor-types';

interface Props {
  externalId: string;
  initialTab?: PrEditorTab;
  initialRelationsSubtab?: RelationsSubtab;
  onClose: () => void;
  onSaved?: () => void;
  onBlockedSubmitted?: (externalId: string) => void;
  onEditSagaEntry?: (externalId: string) => void;
  onEditCharacter?: (externalId: string, initialAppearance?: { media_external_id: string; title: string; cover: string | null; release_year?: number | null; release_month?: number | null; release_day?: number | null }, title?: string) => void;
  sessionActive?: boolean;
  sessionMode?: boolean;
  sessionHasChanges?: boolean;
  sessionAffected?: boolean;
  sessionTabs?: PrEditorSessionTab[];
  onNavigateSessionEntry?: (externalId: string) => void;
  onNavigateSessionTab?: (tab: PrEditorSessionTab) => void;
  onRequestCloseSessionEntry?: (externalId: string) => void;
  onRequestCloseSessionTab?: (tab: PrEditorSessionTab) => void;
  onSessionTitleChange?: (externalId: string, title: string) => void;
  onSessionSagaOrderChange?: (externalId: string, sagaOrder: string[]) => void;
  onSessionDirtyChange?: (externalId: string, dirty: boolean) => void;
  onSubmitProposalSession?: () => void;
  onRequestSessionClose?: () => void;
  onDiscardSession?: () => void;
  onRegisterSessionEditor?: (externalId: string, handle: PrEditorSessionHandle | null) => void;
  // 'local' (admin catalog panel) writes straight to the local DB and skips
  // branch/PR creation entirely — everything up to and including onSaved()
  // already writes locally regardless of mode, so this only gates the
  // GitHub submission step below it.
  mode?: 'proposal' | 'local';
  // Set when opened from an already-merged GitHub entry (CatalogAdminPanel's
  // "GitHub" tab) — field names present locally (media_catalog, possibly via
  // a live-fetch enrichment) but absent from the actual GitHub bundle that
  // was opened. Dimmed in the form so it's visually clear which values are
  // already on GitHub vs. which are just known locally and haven't been
  // proposed yet.
  nonGithubFields?: Set<string>;
}

export function PrEditorModal({ externalId, initialTab = 'general', initialRelationsSubtab, onClose, onSaved, onBlockedSubmitted, onEditSagaEntry, onEditCharacter, sessionActive = true, sessionMode = false, sessionHasChanges = false, sessionAffected = false, sessionTabs = [], onNavigateSessionEntry, onNavigateSessionTab, onRequestCloseSessionEntry, onRequestCloseSessionTab, onSessionTitleChange, onSessionSagaOrderChange, onSessionDirtyChange, onSubmitProposalSession, onRequestSessionClose, onDiscardSession, onRegisterSessionEditor, mode = 'proposal', nonGithubFields }: Props) {
  const t = getT();
  const tm = t.media;
  const pe = t.pr_editor;

  // A remaster/remake/expanded-edition/bundle relation picked here should
  // keep this entry's own type, not always default to 'game' — a VN's
  // remaster is still a VN (see MediaSearchPopup's own comment).
  const igdbRelationMediaType = isVnovelExternalId(externalId) ? 'vnovel' as const : 'game' as const;

  // Both tabs snap back to their requested initial values whenever the
  // editor is pointed at a different entry (or asked to open elsewhere).
  const tabResetKey = `${externalId}\n${initialTab}\n${initialRelationsSubtab ?? ''}`;
  const [activeTab, setActiveTab] = useKeyedState<PrEditorTab>(tabResetKey, initialTab);
  const [relationsSubtab, setRelationsSubtab] = useKeyedState<RelationsSubtab>(tabResetKey, initialRelationsSubtab ?? 'saga');
  const [loading, setLoading] = useState(true);
  // Every 'proposal'-mode edit ends in a GitHub submission — checked up
  // front instead of only at the very end of handleSubmit, so a signed-out
  // user isn't let in to spend time filling out an edit that can only fail
  // once they hit save. 'local' mode (the admin catalog panel) never
  // submits upstream, so it has nothing to gate here.
  const [githubGate, setGithubGate] = useState<'checking' | 'ok' | 'signed-out'>(mode === 'local' ? 'ok' : 'checking');
  const [submitting, setSubmitting] = useState(false);
  const [showUnsavedPrompt, setShowUnsavedPrompt] = useState(false);
  const [unsavedPromptShake, setUnsavedPromptShake] = useState(0);
  const [sessionTabContextMenu, setSessionTabContextMenu] = useState<SessionTabContextMenuState | null>(null);
  const closeSessionTabContextMenu = useCallback(() => setSessionTabContextMenu(null), []);
  const [statusMsg, setStatusMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  // Everything the curator edits, as baseline (loaded) + draft (edited) —
  // see pr-editor-state.ts for the field-by-field rationale.
  const [state, dispatch] = useReducer(prEditorReducer, externalId, createInitialPrEditorState);
  const { draft } = state;
  const { entry, bundledRelations, issueRelations, sagaOrder, characters } = draft;
  const load = (patch: Partial<PrEditorDraft>) => dispatch({ type: 'load', patch });
  // `coalesceKey` names the text field being typed into so mod+z undoes a
  // burst of keystrokes as one step (see pr-editor-state.ts).
  const edit = (patch: PrEditorDraftPatch, coalesceKey?: string) =>
    dispatch(coalesceKey ? { type: 'edit', patch, coalesceKey, at: Date.now() } : { type: 'edit', patch });

  const stateCtx = { externalId, recommendationLabel: tm.relations.RECOMMENDATION };
  const hasChanges = () => computeHasChanges(state, stateCtx);
  const charactersChanged = () => computeCharactersChanged(state);
  const isFieldChanged = (field: keyof MediaCatalogEntry) => computeIsFieldChanged(state, field);

  const [bundleChildrenLoadedFor, setBundleChildrenLoadedFor] = useState<string | null>(null);
  const [isLoadingIssuePreview, setIsLoadingIssuePreview] = useState(false);
  const [issuePreviewError, setIssuePreviewError] = useState<string | null>(null);
  const issuePreviewRequest = useRef(0);
  const previews = usePrEditorPreviews(externalId, entry);

  // Display-only metadata (cover/title) for saga members other than this
  // entry, so tags can show a thumbnail instead of a bare id — populated
  // either from the existing relation rows (which already join title/cover
  // from media_catalog) or from the live API search result the user picked.
  const [sagaMeta, setSagaMeta] = useState<Record<string, MediaMeta>>({});
  const actions = usePrEditorDraftActions({ pe, externalId, draft, edit, sagaMeta, setSagaMeta });

  const [showCharSearch, setShowCharSearch] = useState(false);
  const [castSearchRole, setCastSearchRole] = useState('SUPPORTING');
  const characterCreateRole = useRef('SUPPORTING');
  // Arcs delete themselves immediately (see PrEditorStoryArcsSection), so
  // there's no before/after list here to diff for the GitHub merge like
  // characters/authors get — the section reports its own removals instead.
  const [removedArcIds, setRemovedArcIds] = useState<string[]>([]);

  const [searchPopupMode, setSearchPopupMode] = useState<PrEditorSearchPopupMode | null>(null);
  const [sourceMappingSearch, setSourceMappingSearch] = useState<MediaSourceMappingKind | null>(null);

  const entryType = entry?.type;
  const entryFormat = entry?.format;
  const relationsSubtabs = useMemo(() => {
    const tabs: Array<{ id: RelationsSubtab; label: string; visible: boolean }> = [
      { id: 'saga', label: 'Saga', visible: true },
      { id: 'relations', label: pe.subtab_relations, visible: true },
      { id: 'recommendations', label: pe.subtab_recommendations, visible: true },
      { id: 'bundled', label: pe.subtab_bundled, visible: true },
      { id: 'arcs', label: pe.subtab_arcs, visible: true },
      { id: 'issues', label: pe.subtab_issues, visible: !!entryType && (issueRelations.length > 0 || ['comic', 'manga', 'lnovel'].includes(entryType)) },
      { id: 'episodes', label: pe.subtab_episodes, visible: !!entryType && ['anime', 'series'].includes(entryType) },
      { id: 'themes', label: tm.section_themes, visible: entryType === 'anime' },
      { id: 'bundle-children', label: pe.subtab_bundle_children, visible: bundledRelations.length > 0 },
      { id: 'contains', label: pe.subtab_contains, visible: entryFormat === 'BUNDLE' },
    ];
    return tabs.filter(tab => tab.visible);
  }, [entryType, entryFormat, issueRelations.length, bundledRelations.length, tm.section_themes, pe]);

  useEffect(() => {
    if (relationsSubtabs.some(tab => tab.id === relationsSubtab)) return;
    if (!entry && initialRelationsSubtab === relationsSubtab) return;
    setRelationsSubtab(relationsSubtabs[0]?.id ?? 'saga');
  }, [entry, initialRelationsSubtab, relationsSubtabs, relationsSubtab, setRelationsSubtab]);

  useEffect(() => {
    if (mode === 'local') return;
    let cancelled = false;
    invoke<string | null>('get_github_token').catch(() => null).then(token => {
      if (!cancelled) setGithubGate(token ? 'ok' : 'signed-out');
    });
    return () => { cancelled = true; };
  }, [mode]);

  useEffect(() => {
    const loadAll = async () => {
      const resolved = await resolveCatalogEntryForEditor(externalId);
      if (resolved) load({ entry: resolved });
      else setErrorMsg(pe.local_read_error);

      try {
        const result = await loadPrEditorRelationsAndSaga(externalId);
        load({ ...result.draft, ...(result.currentEntry ? { entry: result.currentEntry } : {}) });
        setSagaMeta(result.sagaMeta);
      } catch (err) {
        console.error('Failed to load relations/saga:', err);
        edit({ bundledRelations: [], containedRelations: [], editableRelations: [], issueRelations: [] });
        load({ recommendations: [] });
      } finally {
        setLoading(false);
      }
    };

    loadAll();
    getMediaCharacters(externalId).then(chars => load({ characters: chars })).catch(() => load({ characters: [] }));
    getMediaAuthors(externalId).then(a => load({ mediaAuthors: a })).catch(() => load({ mediaAuthors: [] }));
  }, [externalId, pe.local_read_error]);

  // Loads the referenced bundle's existing Contains list once, the first
  // time bundledRelations picks one up — re-fires only if the bundle itself
  // changes (not on every bundleChildren edit, which would refetch and wipe
  // out unsaved additions/removals). Clears back to empty if the bundle
  // relation is removed again.
  useEffect(() => {
    const bundleId = bundledRelations[0]?.external_id;
    if (!bundleId) {
      load({ bundleChildren: [] });
      setBundleChildrenLoadedFor(null);
      return;
    }
    if (bundleId === bundleChildrenLoadedFor) return;
    let cancelled = false;
    getMediaRelationsForEditor(bundleId).then(rels => {
      if (cancelled) return;
      const children = (rels || [])
        .filter(r => CONTAINS_RELATION_TYPES.includes(r.relation_type) && r.related_media_external_id !== externalId)
        .map(r => ({ external_id: r.related_media_external_id, title: r.title, cover: r.cover }));
      load({ bundleChildren: children });
      setBundleChildrenLoadedFor(bundleId);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [bundledRelations, externalId, bundleChildrenLoadedFor]);

  // A character created via "+ Crear personaje" (onOpenCreate below) opens
  // the real CharacterPrEditorModal directly instead of anything owned by
  // this component — the only way back into this entry's own cast list is
  // this event, dispatched by that modal the instant its own local save
  // succeeds (see its handleSubmit), independent of whether its GitHub
  // proposal step succeeds/fails/never runs at all. The reducer reads the
  // latest draft, so this listener never needs re-registering after list edits.
  useEffect(() => {
    function onCharacterSaved(e: Event) {
      const detail = (e as CustomEvent<{ externalId: string; name: string; imageUrl: string | null }>).detail;
      if (!detail?.externalId) return;
      dispatch({ type: 'edit', patch: d => d.characters.some(c => c.external_id === detail.externalId) ? {} : { characters: [...d.characters, {
        external_id: detail.externalId,
        name: detail.name,
        image_url: detail.imageUrl,
        relation_type: characterCreateRole.current,
        character_name: null,
      }] } });
    }
    window.addEventListener('metadea:character-saved', onCharacterSaved);
    return () => window.removeEventListener('metadea:character-saved', onCharacterSaved);
  }, []);

  const handleChange = (field: keyof MediaCatalogEntry, value: string | number | null) => {
    if (!entry) return;
    edit({ entry: { ...entry, [field]: value === '' ? null : value } }, typeof value === 'string' ? field : undefined);
  };

  const setProviderSource = async (kind: MediaSourceMappingKind, result: ApiSearchResult) => {
    if (!entry) return;
    const id = result.externalId.split(':').pop() || '';
    edit({ entry: {
      ...entry,
      [kind === 'episodes' ? 'episode_source_id' : 'issue_source_id']: id || null,
    } });

    if (kind !== 'issues' || !id) return;

    const volumeId = Number(id);
    if (!Number.isInteger(volumeId) || volumeId <= 0) return;

    const requestId = ++issuePreviewRequest.current;
    setIsLoadingIssuePreview(true);
    setIssuePreviewError(null);
    try {
      const mappedIssues = await loadComicVineIssuePreview(volumeId, entry.external_id.split(':')[0]);
      if (requestId !== issuePreviewRequest.current) return;
      edit({ issueRelations: mappedIssues });
    } catch (error) {
      if (requestId !== issuePreviewRequest.current) return;
      console.error('Failed to preview ComicVine issues', error);
      setIssuePreviewError(pe.issues_load_error);
    } finally {
      if (requestId === issuePreviewRequest.current) setIsLoadingIssuePreview(false);
    }
  };

  const resetIssueSource = () => {
    issuePreviewRequest.current += 1;
    setIsLoadingIssuePreview(false);
    setIssuePreviewError(null);
    handleChange('issue_source_id', null);
    edit({ issueRelations: state.baseline.issueRelations });
  };

  const [isResyncing, setIsResyncing] = useState(false);

  const handleResync = async () => {
    if (!externalId || isResyncing) return;
    setIsResyncing(true);
    setStatusMsg(pe.downloading_official_data);

    try {
      invalidateCachedMediaData(externalId);
      const liveData = await fetchMediaDataInternal(externalId, true);

      if (!liveData) {
        setStatusMsg(pe.resync_no_data);
        setTimeout(() => setStatusMsg(''), 3000);
        setIsResyncing(false);
        return;
      }

      dispatch({ type: 'resync', liveData, externalId });

      setStatusMsg(pe.resync_filled);
      setTimeout(() => setStatusMsg(''), 3500);
    } catch (err) {
      console.error('Resync failed:', err);
      setStatusMsg(pe.resync_failed);
      setTimeout(() => setStatusMsg(''), 3000);
    } finally {
      setIsResyncing(false);
    }
  };

  const handleSubmit = async (prepareOnly = false): Promise<PreparedMediaProposal | null> => {
    if (!entry || isLoadingIssuePreview || issuePreviewError || (prepareOnly && !hasChanges())) return null;
    setSubmitting(true);
    setErrorMsg('');

    try {
      const resolveMeta = createMetaResolver(externalId, { title: entry.title_main || externalId, cover: entry.cover_url || null, release_year: entry.release_year ?? null }, sagaMeta);
      const changeSummary = buildPrEditorChangeSummary(state, stateCtx, resolveMeta);
      const preparedEntries = await submitPrEditorChanges({
        state,
        ...stateCtx,
        mode,
        sagaMeta,
        removedArcIds,
        changeSummary,
        prepareOnly,
        onSaved,
        onBlockedSubmitted: entry.blocked_at ? onBlockedSubmitted : undefined,
        onClose,
        setStatusMsg,
      });
      if (prepareOnly && preparedEntries) {
        setStatusMsg('');
        return { entries: preparedEntries, changeSummary };
      }
    } catch (err) {
      console.error(err);
      setErrorMsg(err instanceof Error ? err.message : pe.github_api_error);
    } finally {
      setSubmitting(false);
    }
    return null;
  };

  useEffect(() => {
    onSessionDirtyChange?.(externalId, hasChanges());
  });

  const entryTitle = entry ? entry.title_main || externalId : null;
  useEffect(() => {
    if (entryTitle !== null) onSessionTitleChange?.(externalId, entryTitle);
  }, [entryTitle, externalId, onSessionTitleChange]);

  useEffect(() => {
    onSessionSagaOrderChange?.(externalId, sagaOrder);
  }, [externalId, onSessionSagaOrderChange, sagaOrder]);

  const renderSessionLayout = (panel: React.ReactNode) => (
    <PrEditorSessionLayout
      pe={pe}
      externalId={externalId}
      sessionMode={sessionMode}
      sessionTabs={sessionTabs}
      onNavigateSessionEntry={onNavigateSessionEntry}
      onNavigateSessionTab={onNavigateSessionTab}
      onTabContextMenu={setSessionTabContextMenu}
    >
      {panel}
    </PrEditorSessionLayout>
  );

  const requestClose = () => {
    if (sessionMode) {
      onRequestSessionClose?.();
      return;
    }
    if (hasChanges()) {
      if (showUnsavedPrompt) setUnsavedPromptShake(previous => previous + 1);
      setShowUnsavedPrompt(true);
      return;
    }
    onClose();
  };

  const discardAndClose = () => {
    setShowUnsavedPrompt(false);
    setUnsavedPromptShake(0);
    if (sessionMode) onDiscardSession?.();
    else onClose();
  };

  // Refreshed on every commit so the handle registered below always reaches
  // this render's closures (only ever called from event handlers/effects).
  const sessionHandleRef = useRef<PrEditorSessionHandle | null>(null);
  useLayoutEffect(() => {
    sessionHandleRef.current = {
      hasChanges,
      affectedExternalIds: () => computeAffectedExternalIds(state, stateCtx),
      prepareProposal: () => handleSubmit(true),
    };
  });
  useEffect(() => {
    if (!onRegisterSessionEditor) return;
    const handle: PrEditorSessionHandle = {
      hasChanges: () => sessionHandleRef.current?.hasChanges() ?? false,
      affectedExternalIds: () => sessionHandleRef.current?.affectedExternalIds() ?? [],
      prepareProposal: () => sessionHandleRef.current?.prepareProposal() ?? Promise.resolve(null),
    };
    onRegisterSessionEditor(externalId, handle);
    return () => onRegisterSessionEditor(externalId, null);
  }, [externalId, onRegisterSessionEditor]);

  // ── Keyboard shortcuts (modal context) ───────────────────────────────────
  // Registered only while this editor is the visible session tab. Save and
  // tab switching fire from inside fields too; undo/redo stay out of text
  // fields so the native text undo keeps working there (registry default).
  const submitDisabled = submitting || isLoadingIssuePreview || !!issuePreviewError || !(sessionMode ? sessionHasChanges : hasChanges());
  const submit = () => { if (sessionMode) onSubmitProposalSession?.(); else void handleSubmit(); };
  const confirmUnsavedPrompt = () => { setShowUnsavedPrompt(false); setUnsavedPromptShake(0); void handleSubmit(); };
  const cycleTab = (delta: 1 | -1) => {
    const tabs: PrEditorTab[] = ['general', 'cast', 'relations'];
    const index = tabs.indexOf(activeTab);
    setActiveTab(tabs[(index + delta + tabs.length) % tabs.length]);
  };
  const editorReady = !loading && githubGate === 'ok' && !!entry;
  useShortcuts('modal', [
    { id: 'pr_editor.submit', keys: 'mod+s', description: 'shortcuts.editor_save', allowInInputs: true, when: () => editorReady && !submitDisabled, handler: submit },
    { id: 'pr_editor.confirm', keys: 'mod+enter', description: 'shortcuts.editor_confirm', allowInInputs: true, when: () => editorReady && showUnsavedPrompt && !sessionMode, handler: confirmUnsavedPrompt },
    { id: 'pr_editor.undo', keys: 'mod+z', description: 'shortcuts.editor_undo', when: () => editorReady && canUndo(state), handler: () => dispatch({ type: 'undo' }) },
    { id: 'pr_editor.redo', keys: ['mod+y', 'mod+shift+z'], description: 'shortcuts.editor_redo', when: () => editorReady && canRedo(state), handler: () => dispatch({ type: 'redo' }) },
    { id: 'pr_editor.next_tab', keys: 'mod+tab', description: 'shortcuts.editor_next_tab', allowInInputs: true, when: () => editorReady, handler: () => cycleTab(1) },
    { id: 'pr_editor.prev_tab', keys: 'mod+shift+tab', description: 'shortcuts.editor_prev_tab', allowInInputs: true, when: () => editorReady, handler: () => cycleTab(-1) },
  ], { enabled: sessionActive });

  // One shell for every render branch below: the overlay keeps the session
  // layout (tab strip + arrows) around the dialog panel and everything else
  // (toast, context menu, changelog, popups) after it, in the same DOM order
  // as before. `active` keeps a backgrounded session tab (display:none) off
  // the modal stack so Escape/Tab go to the visible editor. Escape reaches
  // requestClose, which routes into the unsaved-changes prompt.
  const renderShell = (opts: { label: string; panelClassName: string; panel: React.ReactNode; closeOnBackdrop?: boolean; overlayChildren?: React.ReactNode }) => (
    <ModalShell
      active={sessionActive}
      onClose={requestClose}
      label={opts.label}
      overlayClassName="pr-editor-overlay"
      overlayProps={{ style: sessionActive ? undefined : { display: 'none' } }}
      panelClassName={opts.panelClassName}
      closeOnBackdrop={opts.closeOnBackdrop ?? false}
      renderPanel={renderSessionLayout}
      overlayChildren={opts.overlayChildren}
    >
      {opts.panel}
    </ModalShell>
  );

  if (githubGate === 'checking') {
    return renderShell({
      label: `${pe.entry_of} ${externalId}`,
      panelClassName: 'pr-editor-modal pr-editor-modal--loading',
      panel: <div className="spinner" />,
      overlayChildren: <PrEditorChangelogPanel externalId={externalId} />,
    });
  }

  if (githubGate === 'signed-out') {
    return renderShell({
      label: pe.login_required_title,
      panelClassName: 'pr-editor-modal pr-editor-modal--narrow',
      closeOnBackdrop: true,
      panel: (
          <div className="pr-editor-body pr-editor-login-required">
            <p className="pr-editor-title">{pe.login_required_title}</p>
            <p className="pr-editor-subtitle">
              {pe.login_required_body}
            </p>
            <div className="pr-editor-login-actions">
              <button type="button" className="pr-editor-btn pr-editor-btn--cancel" onClick={requestClose}>{pe.close}</button>
              <button type="button" className="pr-editor-btn pr-editor-btn--submit" onClick={() => { window.location.href = '/settings'; }}>
                {pe.go_to_settings}
              </button>
            </div>
          </div>
      ),
    });
  }

  if (loading) {
    return renderShell({
      label: `${pe.entry_of} ${externalId}`,
      panelClassName: 'pr-editor-modal pr-editor-modal--loading',
      panel: <div className="spinner" />,
      overlayChildren: <PrEditorChangelogPanel externalId={externalId} />,
    });
  }

  if (!entry) return null;

  const isLocalOnly = (field: keyof MediaCatalogEntry) => nonGithubFields?.has(field) ?? false;

  const resolveMeta = createMetaResolver(externalId, { title: entry.title_main ?? null, cover: entry.cover_url ?? null, release_year: entry.release_year ?? null }, sagaMeta);

  return renderShell({
    label: `${pe.entry_of} ${entry.title_main || externalId}`,
    panelClassName: 'pr-editor-modal pr-editor-modal--narrow',
    closeOnBackdrop: true,
    panel: (<>
        <PrEditorHeader
          title={<>{pe.entry_of} <strong>{entry.title_main || externalId}</strong>{sessionAffected && <span className="pr-editor-session-affected" title={pe.affected_tooltip}> · {pe.related_change}</span>}</>}
          subtitle={`ID: ${externalId}`}
          status={statusMsg && (
            <div className="pr-editor-header-status">
              <div className="spinner spinner--small pr-editor-header-status-spinner" />
              <span>{statusMsg}</span>
            </div>
          )}
          actions={
            <PrEditorHeaderActions
              pe={pe}
              blocked={!!entry.blocked_at}
              isResyncing={isResyncing}
              submitting={submitting}
              submitDisabled={submitDisabled}
              onResync={handleResync}
              onToggleBlocked={() => handleChange('blocked_at', entry.blocked_at ? null : new Date().toISOString())}
              onCancel={requestClose}
              onSubmit={submit}
            />
          }
        />

        <div className="pr-editor-content-shell">
          <PrEditorSidebar
            pe={pe}
            activeTab={activeTab}
            relationsSubtab={relationsSubtab}
            relationsSubtabs={relationsSubtabs}
            charactersChanged={charactersChanged()}
            onSelectTab={setActiveTab}
            onSelectRelationsSubtab={subtab => { setActiveTab('relations'); setRelationsSubtab(subtab); }}
          />

          <div className="pr-editor-main">
          <div className={`pr-editor-body${activeTab === 'cast' ? ' pr-editor-body--cast' : ''}`}>
          {errorMsg && <div className="pr-editor-alert pr-editor-alert--error pr-editor-field--full">{errorMsg}</div>}

          {activeTab === 'general' && (
            <PrEditorGeneralSection
              t={t}
              entry={entry}
              isFieldChanged={isFieldChanged}
              isLocalOnly={isLocalOnly}
              onChange={handleChange}
              onReplaceEntry={next => edit({ entry: next })}
            />
          )}

          {activeTab === 'cast' && (
            <PrEditorCharactersSection
              t={t}
              characters={characters}
              onRemove={actions.cast.remove}
              onOpenCharacterEditor={(id, title) => {
                if (onEditCharacter) onEditCharacter(id, undefined, title);
                else window.__metadeaCharacterEditor?.open(id);
              }}
              onOpenSearch={role => {
                setCastSearchRole(role);
                setShowCharSearch(true);
              }}
              onOpenCreate={role => {
                characterCreateRole.current = role;
                const characterId = generateCustomCharacterId();
                const initialAppearance = {
                media_external_id: externalId,
                title: entry?.title_main || externalId,
                cover: entry?.cover_url ?? null,
                release_year: entry?.release_year ?? null,
                release_month: entry?.release_month ?? null,
                release_day: entry?.release_day ?? null,
                };
                if (onEditCharacter) onEditCharacter(characterId, initialAppearance, pe.new_character);
                else window.__metadeaCharacterEditor?.open(characterId, initialAppearance);
              }}
            />
          )}

          {activeTab === 'relations' && (
            <PrEditorRelationsTab
              t={t}
              externalId={externalId}
              entry={entry}
              draft={draft}
              actions={actions}
              subtab={relationsSubtab}
              resolveMeta={resolveMeta}
              issuePreview={{ loading: isLoadingIssuePreview, error: issuePreviewError }}
              previews={previews}
              onOpenSearch={setSearchPopupMode}
              onOpenSourceMapping={setSourceMappingSearch}
              onResetIssueSource={resetIssueSource}
              onResetEpisodeSource={() => handleChange('episode_source_id', null)}
              onArcDeleted={arcId => setRemovedArcIds(prev => [...prev, arcId])}
              onEditWork={onEditSagaEntry}
            />
          )}
        </div>
          </div>
        </div>

    </>),
    overlayChildren: (<>
      {showUnsavedPrompt && !sessionMode && (
        <div key={unsavedPromptShake} className={`pr-unsaved-changes-toast${unsavedPromptShake ? ' pr-unsaved-changes-toast--shake' : ''}`} role="alertdialog" aria-live="assertive" onClick={event => event.stopPropagation()}>
          <span>{pe.unsaved_changes_title}</span>
          <button type="button" className="pr-editor-btn pr-editor-btn--submit" onClick={confirmUnsavedPrompt}>{pe.submit_proposal}</button>
          <button type="button" className="pr-editor-btn pr-editor-btn--cancel" onClick={discardAndClose}>{pe.discard}</button>
        </div>
      )}

      {sessionMode && sessionTabContextMenu && (onRequestCloseSessionEntry || onRequestCloseSessionTab) && (
        <PrEditorSessionTabContextMenu
          menu={sessionTabContextMenu}
          sessionTabs={sessionTabs}
          onRequestCloseSessionEntry={onRequestCloseSessionEntry}
          onRequestCloseSessionTab={onRequestCloseSessionTab}
          onClose={closeSessionTabContextMenu}
        />
      )}

      <PrEditorChangelogPanel externalId={externalId} />

      <PrEditorSearchPopups
        mode={searchPopupMode}
        externalId={externalId}
        igdbRelationMediaType={igdbRelationMediaType}
        draft={draft}
        onSelectSaga={actions.saga.add}
        onSelectBundled={actions.bundled.add}
        onSelectBundleChild={actions.bundleChild.add}
        onSelectContained={actions.contained.add}
        onSelectRelation={actions.editable.add}
        onSelectRecommendation={actions.recommendation.add}
        onClose={() => setSearchPopupMode(null)}
      />

      {sourceMappingSearch && (
        <MediaSourceMappingSearchPopup
          kind={sourceMappingSearch}
          preferredIssueCount={sourceMappingSearch === 'issues' ? entry.total_count_2 : undefined}
          onSelect={result => setProviderSource(sourceMappingSearch, result)}
          onClose={() => setSourceMappingSearch(null)}
        />
      )}

      {showCharSearch && (
        <PrEditorCastPickerPopup
          pe={pe}
          existingCharacters={characters}
          role={castSearchRole}
          onAdd={actions.cast.add}
          onClose={() => setShowCharSearch(false)}
        />
      )}
    </>),
  });
}
