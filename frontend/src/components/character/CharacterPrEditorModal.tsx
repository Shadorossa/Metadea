import React, { useState, useEffect, useRef } from 'react';
import { BookOpen, GitMerge, Mic, Settings, X } from 'lucide-react';
import { createPortal } from 'react-dom';
import { openSubmittedProposal } from '../../lib/github/submitCollaborativeProposal';
import { getDroppedImageUrl, openImageCropModal } from '../shared/ImageCropModal';
import { getCharacterMergeTarget, getCharacterMerges, getMediaCharacters, type CharacterEntry, type CharacterMerge } from '../../lib/tauri/characters';
import type { ParsedCharacteristic } from '../../lib/character/biography-parser';
import { compareByReleaseDateThenTitle } from '../../lib/media/mapper-utils';
import { MediaSearchPopup } from '../media/MediaSearchPopup';
import { VoiceActorSearchPopup, type VoiceActorSearchResult } from './VoiceActorSearchPopup';
import { FandomImportModal, type SelectedImportFields } from './FandomImportModal';
import { correlateVoiceActor } from '../../lib/character/voiceActorResolver';
import type { FandomCharacterData } from '../../lib/character/fandomImporter';
import type { SearchResult as ApiSearchResult } from '../../lib/search';
import { getT } from '../../i18n/client';
import { Field } from '../shared/PrEditorField';
import { PrEditorAddButton } from '../media/pr-editor/PrEditorAddButton';
import { PrEditorChangelogPanel } from '../media/pr-editor/PrEditorChangelogPanel';
import { PrEditorHeader } from '../shared/PrEditorHeader';
import { getRolePageCount, getRolePageItems, PrEditorRolePagination } from '../media/pr-editor/PrEditorRolePagination';
import { TagsInput } from '../shared/TagsInput';
import { RichTextEditor } from '../shared/RichTextEditor';
import { loadCharacterEditorData, type PendingAppearance } from '../../lib/character/characterPrEditorLoad';
import { submitCharacterProposal } from '../../lib/character/characterPrEditorSubmit';
import { fetchMediaDataInternal } from '../../lib/media/mediaService';
import {
  isFieldChanged,
  characteristicsChanged as characteristicsChangedPure,
  appearancesChanged as appearancesChangedPure,
  voiceActorsChanged as voiceActorsChangedPure,
  hasChanged as hasChangedPure,
  buildChangeSummary as buildChangeSummaryPure,
  type AppearanceRow, type VoiceActorRow, type CharacterDiffFields,
} from '../../lib/character/prEditorDiff';

const RELATION_TYPE_OPTIONS = ['MAIN', 'SUPPORTING', 'BACKGROUND', 'CAMEO'];
const getRelationTypeLabels = () => {
  const t = getT();
  return {
    MAIN: t.character.role_main,
    SUPPORTING: t.character.role_supporting,
    BACKGROUND: t.character.role_background,
    CAMEO: t.character.role_cameo,
  };
};

const VA_LANGUAGES = [
  { code: 'JP', label: 'Japonés', name: 'Japanese' },
  { code: 'ES', label: 'Español', name: 'Spanish' },
  { code: 'EN', label: 'Inglés', name: 'English' },
  { code: 'IT', label: 'Italiano', name: 'Italian' },
  { code: 'DE', label: 'Alemán', name: 'German' },
  { code: 'FR', label: 'Francés', name: 'French' },
  { code: 'PT', label: 'Portugués', name: 'Portuguese' },
  { code: 'KR', label: 'Coreano', name: 'Korean' },
  { code: 'ZH', label: 'Chino', name: 'Chinese' },
];

function getVaLangIndex(rawLang?: string): number {
  if (!rawLang) return 0;
  const cur = rawLang.toLowerCase();
  if (cur.includes('japan') || cur.includes('japon') || cur === 'jp') return 0;
  if (cur.includes('span') || cur.includes('españ') || cur.includes('espan') || cur === 'es') return 1;
  if (cur.includes('engl') || cur.includes('ingl') || cur === 'en') return 2;
  if (cur.includes('ital') || cur === 'it') return 3;
  if (cur.includes('germ') || cur.includes('alem') || cur === 'de') return 4;
  if (cur.includes('fren') || cur.includes('franc') || cur === 'fr') return 5;
  if (cur.includes('port') || cur === 'pt') return 6;
  if (cur.includes('kore') || cur.includes('core') || cur === 'kr') return 7;
  if (cur.includes('chin') || cur.includes('mand') || cur === 'zh') return 8;
  return 0;
}

function VoiceActorLangStepper({
  language,
  onChange,
}: {
  language?: string;
  onChange: (newLang: string) => void;
}) {
  const curIdx = getVaLangIndex(language);
  const curLang = VA_LANGUAGES[curIdx];

  const prev = () => {
    const prevIdx = (curIdx - 1 + VA_LANGUAGES.length) % VA_LANGUAGES.length;
    onChange(VA_LANGUAGES[prevIdx].name);
  };
  const next = () => {
    const nextIdx = (curIdx + 1) % VA_LANGUAGES.length;
    onChange(VA_LANGUAGES[nextIdx].name);
  };

  const tChar = getT().character;

  return (
    <div className="pr-editor-va-stepper">
      <button
        type="button"
        className="pr-editor-va-stepper-btn"
        onClick={prev}
        title={tChar.prev_lang_title}
        aria-label={tChar.prev_lang_aria}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="15 18 9 12 15 6" />
        </svg>
      </button>
      <span
        className="pr-editor-va-stepper-label"
        onClick={next}
        title={`${curLang.label} (${curLang.name})`}
      >
        {curLang.code}
      </span>
      <button
        type="button"
        className="pr-editor-va-stepper-btn"
        onClick={next}
        title={tChar.next_lang_title}
        aria-label={tChar.next_lang_aria}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="9 18 15 12 9 6" />
        </svg>
      </button>
    </div>
  );
}

interface CachedCharacterData {
  character: CharacterEntry;
  originalCharacter: CharacterEntry;
  name: string;
  nameNative: string;
  aliases: string[];
  imageUrl: string;
  characteristics: ParsedCharacteristic[];
  cleanBiography: string;
  originalCharacteristics: ParsedCharacteristic[];
  originalCleanBiography: string;
  appearances: AppearanceRow[];
  originalAppearances: AppearanceRow[];
  mergedCharacters: CharacterMerge[];
  originalMergedCharacters: CharacterMerge[];
  voiceActors: VoiceActorRow[];
  originalVoiceActors: VoiceActorRow[];
}

interface CharacterEditorDraft extends CharacterDiffFields {
  character: CharacterEntry | null;
  originalCharacter: CharacterEntry | null;
  mergedCharacters: CharacterMerge[];
  originalMergedCharacters: CharacterMerge[];
  mergeAppearanceIds: Record<string, string>;
  activeTab: 'general' | 'appearances' | 'merges' | 'voices';
  dirty: boolean;
}

interface MergeCandidate {
  external_id: string;
  name: string;
  image_url?: string | null;
}

export function CharacterPrEditorModal() {
  const t = getT().character_editor;
  const [mounted, setMounted] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [isSessionTab, setIsSessionTab] = useState(false);
  const [sharedSessionTabs, setSharedSessionTabs] = useState<any[]>([]);
  const [currentId, setCurrentId] = useState('');
  const [characterEditorTabIds, setCharacterEditorTabIds] = useState<string[]>([]);
  const [pendingCharacterTabCloseId, setPendingCharacterTabCloseId] = useState<string | null>(null);
  const [characterTabContextMenu, setCharacterTabContextMenu] = useState<{ externalId: string; kind?: 'media' | 'character'; x: number; y: number } | null>(null);
  const [loadNonce, setLoadNonce] = useState(0);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [showUnsavedPrompt, setShowUnsavedPrompt] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [character, setCharacter] = useState<CharacterEntry | null>(null);
  const [originalCharacter, setOriginalCharacter] = useState<CharacterEntry | null>(null);

  const characterCacheRef = useRef<Record<string, CachedCharacterData>>({});
  const characterDraftsRef = useRef(new Map<string, CharacterEditorDraft>());
  const currentCharacterDraftRef = useRef<{ externalId: string; draft: CharacterEditorDraft; isOpen: boolean } | null>(null);
  // Set by openCharacterEditor's second (optional) arg, consumed once by the
  // very next loadCharacter run — the media entry a character was created
  // FROM (via PrEditorModal's "+ Crear personaje") should already be in its
  // "Apariciones en obras" list, not left for the user to search/re-add by
  // hand right after typing its name.
  const pendingAppearanceRef = useRef<{
    media_external_id: string;
    title: string;
    cover: string | null;
    release_year?: number | null;
    release_month?: number | null;
    release_day?: number | null;
  } | null>(null);

  const [name, setName] = useState('');
  const [nameNative, setNameNative] = useState('');
  const [aliases, setAliases] = useState<string[]>([]);
  const [imageUrl, setImageUrl] = useState('');
  const [isPhotoDragOver, setIsPhotoDragOver] = useState(false);

  const [originalName, setOriginalName] = useState('');
  const [originalNameNative, setOriginalNameNative] = useState('');
  const [originalAliases, setOriginalAliases] = useState<string[]>([]);
  const [originalImageUrl, setOriginalImageUrl] = useState('');

  const [characteristics, setCharacteristics] = useState<ParsedCharacteristic[]>([]);
  const [cleanBiography, setCleanBiography] = useState('');
  const [originalCharacteristics, setOriginalCharacteristics] = useState<ParsedCharacteristic[]>([]);
  const [originalCleanBiography, setOriginalCleanBiography] = useState('');

  const [appearances, setAppearances] = useState<AppearanceRow[]>([]);
  const [originalAppearances, setOriginalAppearances] = useState<AppearanceRow[]>([]);
  const [appearancePage, setAppearancePage] = useState(0);
  const [mergedCharacters, setMergedCharacters] = useState<CharacterMerge[]>([]);
  const [originalMergedCharacters, setOriginalMergedCharacters] = useState<CharacterMerge[]>([]);
  // Tracks appearances inserted by this editor session solely because a
  // source character was merged. They must disappear with that merge, while
  // manually-added appearances remain untouched.
  const [mergeAppearanceIds, setMergeAppearanceIds] = useState<Record<string, string>>({});
  const [voiceActors, setVoiceActors] = useState<VoiceActorRow[]>([]);
  const [originalVoiceActors, setOriginalVoiceActors] = useState<VoiceActorRow[]>([]);
  const [appearanceSearchRole, setAppearanceSearchRole] = useState('SUPPORTING');
  const [appearanceSearchOpen, setAppearanceSearchOpen] = useState(false);
  const [mergeMediaSearchOpen, setMergeMediaSearchOpen] = useState(false);
  const [voiceActorSearchOpen, setVoiceActorSearchOpen] = useState(false);
  const [fandomModalOpen, setFandomModalOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'general' | 'appearances' | 'merges' | 'voices'>('general');
  const mergeInfoRef = useRef<HTMLButtonElement | null>(null);
  const [mergeHintPosition, setMergeHintPosition] = useState<{ top: number; left: number } | null>(null);
  const isMergeHintOpen = mergeHintPosition !== null;

  const updateMergeHintPosition = () => {
    const anchor = mergeInfoRef.current;
    if (!anchor || typeof window === 'undefined') return;
    const rect = anchor.getBoundingClientRect();
    const width = Math.min(336, window.innerWidth - 24);
    const left = Math.max(12, Math.min(rect.left + rect.width / 2 - width / 2, window.innerWidth - width - 12));
    const belowTop = rect.bottom + 8;
    const top = belowTop + 96 > window.innerHeight ? Math.max(12, rect.top - 96) : belowTop;
    setMergeHintPosition({ top, left });
  };

  useEffect(() => {
    if (!isMergeHintOpen) return;
    const reposition = () => {
      const anchor = mergeInfoRef.current;
      if (!anchor) return;
      const rect = anchor.getBoundingClientRect();
      const width = Math.min(336, window.innerWidth - 24);
      const left = Math.max(12, Math.min(rect.left + rect.width / 2 - width / 2, window.innerWidth - width - 12));
      const belowTop = rect.bottom + 8;
      const top = belowTop + 96 > window.innerHeight ? Math.max(12, rect.top - 96) : belowTop;
      setMergeHintPosition(previous => previous?.top === top && previous.left === left ? previous : { top, left });
    };
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    return () => {
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
    };
  }, [isMergeHintOpen]);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    setAppearancePage(0);
  }, [currentId]);

  useEffect(() => {
    const onSessionUpdate = (event: Event) => {
      setSharedSessionTabs((event as CustomEvent<{ tabs?: any[] }>).detail?.tabs ?? []);
    };
    window.addEventListener('metadea:pr-editor-session-update', onSessionUpdate);
    setSharedSessionTabs((window as any).__metadeaPrEditorSession?.tabs ?? []);
    return () => window.removeEventListener('metadea:pr-editor-session-update', onSessionUpdate);
  }, []);

  useEffect(() => {
    if (!characterTabContextMenu) return;
    const close = () => setCharacterTabContextMenu(null);
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') close(); };
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [characterTabContextMenu]);

  const handleClose = () => {
    setIsOpen(false);
    setCharacter(null);
    setOriginalCharacter(null);
    setErrorMsg('');
    setStatusMsg('');
    setAppearanceSearchOpen(false);
    setMergeMediaSearchOpen(false);
    setMergeHintPosition(null);
    setMergeAppearanceIds({});
    setFandomModalOpen(false);
    setIsSessionTab(false);
  };

  useEffect(() => {
    (window as any).openCharacterEditor = (
      externalId: string,
      initialAppearance?: {
        media_external_id: string;
        title: string;
        cover: string | null;
        release_year?: number | null;
        release_month?: number | null;
        release_day?: number | null;
      },
      options?: { mediaSession?: boolean },
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
      setCurrentId(externalId);
      setIsOpen(true);
      setLoading(true);
      setLoadNonce(n => n + 1);
      if (options?.mediaSession) {
        window.dispatchEvent(new CustomEvent('metadea:character-editor-session-change', { detail: { action: 'update', externalId, title: externalId, dirty: false } }));
      }
    };

    (window as any).closeCharacterEditorSession = () => {
      setIsOpen(false);
      setIsSessionTab(false);
      setCharacterEditorTabIds([]);
      characterDraftsRef.current.clear();
      currentCharacterDraftRef.current = null;
    };

    return () => {
      delete (window as any).openCharacterEditor;
      delete (window as any).closeCharacterEditorSession;
    };
  }, []);

  useEffect(() => {
    if (!isOpen || !currentId) return;

    const loadCharacter = async () => {
      try {
        // These links only describe additions made in the currently open
        // editor; never carry them over to a different character/session.
        setMergeAppearanceIds({});
        const draft = characterDraftsRef.current.get(currentId);
        if (draft) {
          setCharacter(draft.character);
          setOriginalCharacter(draft.originalCharacter);
          setName(draft.name);
          setNameNative(draft.nameNative);
          setAliases(draft.aliases);
          setImageUrl(draft.imageUrl);
          setOriginalName(draft.originalName);
          setOriginalNameNative(draft.originalNameNative);
          setOriginalAliases(draft.originalAliases);
          setOriginalImageUrl(draft.originalImageUrl);
          setCharacteristics(draft.characteristics);
          setOriginalCharacteristics(draft.originalCharacteristics);
          setCleanBiography(draft.cleanBiography);
          setOriginalCleanBiography(draft.originalCleanBiography);
          setAppearances(draft.appearances);
          setOriginalAppearances(draft.originalAppearances);
          setMergedCharacters(draft.mergedCharacters);
          setOriginalMergedCharacters(draft.originalMergedCharacters);
          setMergeAppearanceIds(draft.mergeAppearanceIds);
          setVoiceActors(draft.voiceActors);
          setOriginalVoiceActors(draft.originalVoiceActors);
          setActiveTab(draft.activeTab);
          setErrorMsg('');
          setStatusMsg('');
          setLoading(false);
          return;
        }
        const cached = characterCacheRef.current[currentId];
        if (cached) {
          setCharacter(cached.character);
          setOriginalCharacter(cached.originalCharacter);
          setName(cached.name);
          setNameNative(cached.nameNative);
          setAliases(cached.aliases);
          setImageUrl(cached.imageUrl);
          setCharacteristics(cached.characteristics);
          setCleanBiography(cached.cleanBiography);
          setOriginalCharacteristics(cached.originalCharacteristics);
          setOriginalCleanBiography(cached.originalCleanBiography);
          setAppearances(cached.appearances);
          setOriginalAppearances(cached.originalAppearances);
          setMergedCharacters(cached.mergedCharacters);
          setOriginalMergedCharacters(cached.originalMergedCharacters);
          setVoiceActors(cached.voiceActors);
          setOriginalVoiceActors(cached.originalVoiceActors);
          setOriginalName(cached.name);
          setOriginalNameNative(cached.nameNative);
          setOriginalAliases(cached.aliases);
          setOriginalImageUrl(cached.imageUrl);
          setLoading(false);
          return;
        }

        const pendingAppearance = pendingAppearanceRef.current;
        pendingAppearanceRef.current = null;
        const result = await loadCharacterEditorData(currentId, pendingAppearance, 'SUPPORTING');

        setCharacter(result.character);
        setOriginalCharacter(result.originalCharacter);
        setName(result.name);
        setNameNative(result.nameNative);
        setAliases(result.aliases);
        setImageUrl(result.imageUrl);
        setCharacteristics(result.characteristics);
        setCleanBiography(result.cleanBiography);
        setOriginalCharacteristics(result.originalCharacteristics);
        setOriginalCleanBiography(result.originalCleanBiography);
        setAppearances(result.appearances);
        setOriginalAppearances(result.originalAppearances);
        setMergedCharacters(result.mergedCharacters);
        setOriginalMergedCharacters(result.originalMergedCharacters);
        setOriginalName(result.name);
        setOriginalNameNative(result.nameNative);
        setOriginalAliases(result.aliases);
        setOriginalImageUrl(result.imageUrl);
        setVoiceActors(result.voiceActors);
        setOriginalVoiceActors(result.originalVoiceActors);

        characterCacheRef.current[currentId] = {
          character: result.character,
          originalCharacter: result.originalCharacter,
          name: result.name,
          nameNative: result.nameNative,
          aliases: result.aliases,
          imageUrl: result.imageUrl,
          characteristics: result.characteristics,
          cleanBiography: result.cleanBiography,
          originalCharacteristics: result.originalCharacteristics,
          originalCleanBiography: result.originalCleanBiography,
          appearances: result.appearances,
          originalAppearances: result.originalAppearances,
          mergedCharacters: result.mergedCharacters,
          originalMergedCharacters: result.originalMergedCharacters,
          voiceActors: result.voiceActors,
          originalVoiceActors: result.originalVoiceActors,
        };
      } catch (err) {
        console.error('Failed to load character:', err);
        setErrorMsg('Error al cargar el personaje');
      } finally {
        setLoading(false);
      }
    };
    loadCharacter();
  }, [isOpen, currentId, loadNonce]);

  const diffFields: CharacterDiffFields = {
    name, originalName,
    nameNative, originalNameNative,
    aliases, originalAliases,
    imageUrl, originalImageUrl,
    cleanBiography, originalCleanBiography,
    characteristics, originalCharacteristics,
    appearances, originalAppearances,
    voiceActors, originalVoiceActors,
  };
  const characteristicsChanged = () => characteristicsChangedPure(characteristics, originalCharacteristics);
  const appearancesChanged = () => appearancesChangedPure(appearances, originalAppearances);
  const voiceActorsChanged = () => voiceActorsChangedPure(voiceActors, originalVoiceActors);
  const mergedCharacterIds = () => mergedCharacters.map(item => item.external_id).sort();
  const originalMergedCharacterIds = () => originalMergedCharacters.map(item => item.external_id).sort();
  const mergedCharactersChanged = () => JSON.stringify(mergedCharacterIds()) !== JSON.stringify(originalMergedCharacterIds());
  const hasChanged = () => hasChangedPure(originalCharacter, diffFields) || mergedCharactersChanged();
  const buildChangeSummary = () => buildChangeSummaryPure(originalCharacter, diffFields);
  const appearanceGroups = RELATION_TYPE_OPTIONS.map(type => ({
    type,
    allAppearances: appearances.filter(appearance => (appearance.relation_type ?? 'SUPPORTING') === type),
  }));
  const appearanceTotalPages = getRolePageCount(appearanceGroups.map(group => group.allAppearances.length));
  const safeAppearancePage = Math.min(appearancePage, appearanceTotalPages - 1);
  if (!loading && character && originalCharacter) {
    currentCharacterDraftRef.current = {
      externalId: currentId,
      isOpen,
      draft: {
        ...diffFields,
        character,
        originalCharacter,
        mergedCharacters,
        originalMergedCharacters,
        mergeAppearanceIds,
        activeTab,
        dirty: hasChanged(),
      },
    };
  } else if (!isOpen) currentCharacterDraftRef.current = null;
  const requestClose = () => {
    if (isSessionTab) {
      (window as any).__metadeaPrEditorSession?.requestClose?.();
      return;
    }
    const hasAnyUnsavedChanges = hasChanged() || [...characterDraftsRef.current.values()].some(draft => draft.dirty);
    if (hasAnyUnsavedChanges) {
      setShowUnsavedPrompt(true);
      return;
    }
    handleClose();
  };

  const removeCharacterEditorTab = (externalId: string, discard = false) => {
    const draft = characterDraftsRef.current.get(externalId);
    const dirty = externalId === currentId ? hasChanged() : !!draft?.dirty;
    if (dirty && !discard) {
      setPendingCharacterTabCloseId(externalId);
      setShowUnsavedPrompt(true);
      return;
    }
    const previousIds = characterEditorTabIds;
    const remaining = previousIds.filter(id => id !== externalId);
    setCharacterEditorTabIds(remaining);
    characterDraftsRef.current.delete(externalId);
    window.dispatchEvent(new CustomEvent('metadea:character-editor-session-change', { detail: { action: 'close', externalId } }));
    if (externalId !== currentId) return;
    setShowUnsavedPrompt(false);
    setPendingCharacterTabCloseId(null);
    const controller = (window as any).__metadeaPrEditorSession;
    if (remaining.length) {
      const oldIndex = previousIds.indexOf(externalId);
      const nextId = remaining[Math.max(0, Math.min(oldIndex - 1, remaining.length - 1))];
      (window as any).openCharacterEditor?.(nextId, undefined, { mediaSession: true });
      return;
    }
    const mediaTab = controller?.tabs?.find((tab: any) => tab.kind !== 'character');
    if (mediaTab) {
      controller.navigate?.(mediaTab);
      setIsOpen(false);
      setIsSessionTab(false);
      return;
    }
    if (controller?.finishSession) controller.finishSession();
    else handleClose();
  };

  useEffect(() => {
    (window as any).closeCharacterEditorTab = (externalId: string, discard = false) => removeCharacterEditorTab(externalId, discard);
    return () => { delete (window as any).closeCharacterEditorTab; };
  });

  const sessionNavigate = (tab: any) => {
    const controller = (window as any).__metadeaPrEditorSession;
    if (tab.kind === 'character') {
      if (controller?.navigate) controller.navigate(tab);
      else (window as any).openCharacterEditor?.(tab.externalId, undefined, { mediaSession: true });
      return;
    }
    if (!loading && character && originalCharacter) {
      characterDraftsRef.current.set(currentId, {
        ...diffFields,
        character,
        originalCharacter,
        mergedCharacters,
        originalMergedCharacters,
        mergeAppearanceIds,
        activeTab,
        dirty: hasChanged(),
      });
    }
    controller?.navigate?.(tab);
    setIsOpen(false);
    setIsSessionTab(false);
  };

  const renderSessionLayout = (panel: React.ReactNode) => {
    if (!isSessionTab) return panel;
    const tabs = sharedSessionTabs.length ? sharedSessionTabs : (window as any).__metadeaPrEditorSession?.tabs ?? [];
    const activeIndex = tabs.findIndex((tab: any) => tab.kind === 'character' && tab.externalId === currentId);
    const navigate = (index: number) => {
      if (!tabs.length) return;
      sessionNavigate(tabs[(index + tabs.length) % tabs.length]);
    };
    return (
      <div className="pr-editor-session-layout pr-editor-session-layout--active" onClick={event => event.stopPropagation()}>
        <nav className="pr-editor-session-tabs" aria-label="Pestañas de edición">
          {tabs.map((tab: any, index: number) => (
            <button
              key={`${tab.kind}:${tab.externalId}`}
              type="button"
              className={`pr-editor-session-tab${tab.kind === 'character' && tab.externalId === currentId ? ' pr-editor-session-tab--active' : ''}`}
              aria-current={tab.kind === 'character' && tab.externalId === currentId ? 'page' : undefined}
              title={`${tab.kind === 'character' ? 'Personaje' : 'Obra'}: ${tab.label}${tab.dirty ? ' · Cambios sin guardar' : ''}`}
              onClick={() => sessionNavigate(tab)}
              onContextMenu={event => {
                event.preventDefault();
                setCharacterTabContextMenu({ externalId: tab.externalId, kind: tab.kind, x: event.clientX, y: event.clientY });
              }}
            >
              <span className="pr-editor-session-tab-label">{tab.label}</span>
              {tab.dirty && <span className="pr-editor-session-tab-dirty" aria-label="Cambios sin guardar" />}
            </button>
          ))}
        </nav>
        <div className="pr-editor-session-panel-row">
          <button type="button" className="pr-editor-session-arrow" aria-label="Anterior" onClick={() => navigate(activeIndex - 1)}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6" /></svg></button>
          {panel}
          <button type="button" className="pr-editor-session-arrow" aria-label="Siguiente" onClick={() => navigate(activeIndex + 1)}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6" /></svg></button>
        </div>
      </div>
    );
  };

  const characterIsDirty = !loading && character ? hasChanged() : false;
  useEffect(() => {
    if (!isOpen || !isSessionTab || loading || !character) return;
    window.dispatchEvent(new CustomEvent('metadea:character-editor-session-change', {
      detail: { action: 'update', externalId: currentId, title: name || character.name, dirty: characterIsDirty },
    }));
  }, [isOpen, isSessionTab, loading, character, currentId, name, characterIsDirty]);

  const addCharacteristic = () => setCharacteristics([...characteristics, { label: '', value: '' }]);
  const removeCharacteristic = (idx: number) => setCharacteristics(characteristics.filter((_, i) => i !== idx));
  const updateCharacteristic = (idx: number, field: 'label' | 'value', value: string) =>
    setCharacteristics(characteristics.map((c, i) => i === idx ? { ...c, [field]: value } : c));

  const removeAppearance = (mediaExternalId: string) =>
    setAppearances(appearances.filter(a => a.media_external_id !== mediaExternalId));
  const removeMergedCharacter = (externalId: string) =>
    {
      const mergeAppearanceId = mergeAppearanceIds[externalId];
      setMergedCharacters(previous => previous.filter(item => item.external_id !== externalId));
      if (mergeAppearanceId) {
        setAppearances(previous => previous.filter(item => item.media_external_id !== mergeAppearanceId));
        setMergeAppearanceIds(previous => {
          const { [externalId]: _removed, ...remaining } = previous;
          return remaining;
        });
      }
    };
  const loadMergeCandidates = async (result: ApiSearchResult): Promise<MergeCandidate[]> => {
    const cached = await getMediaCharacters(result.externalId).catch(() => []);
    let candidates: MergeCandidate[] = cached.map(item => ({
      external_id: item.external_id,
      name: item.name,
      image_url: item.image_url,
    }));
    if (!candidates.length) {
      const live = await fetchMediaDataInternal(result.externalId);
      candidates = (live?.characters ?? []).map(item => ({
        external_id: item.id || `character:${item.name}`,
        name: item.name,
        image_url: item.image,
      }));
    }
    const seen = new Set<string>();
    const alreadyAdded = new Set(mergedCharacters.map(item => item.external_id));
    const unique = candidates.filter(item => {
      if (!item.external_id || item.external_id === currentId || alreadyAdded.has(item.external_id) || seen.has(item.external_id)) return false;
      seen.add(item.external_id);
      return true;
    });
    const eligible: MergeCandidate[] = [];
    for (const item of unique) {
      const target = await getCharacterMergeTarget(item.external_id).catch(() => null);
      if (!target || target === currentId) eligible.push(item);
    }
    return eligible;
  };
  const addMergedCharacter = (candidate: MergeCandidate, work: ApiSearchResult) => {
    const workIsAlreadyAnAppearance = appearances.some(item => item.media_external_id === work.externalId);
    setMergedCharacters(previous => previous.some(item => item.external_id === candidate.external_id)
      ? previous
      : [...previous, candidate]);
    if (!workIsAlreadyAnAppearance) {
      addAppearance(work);
      setMergeAppearanceIds(previous => ({ ...previous, [candidate.external_id]: work.externalId }));
    }
  };
  const addAppearance = (result: ApiSearchResult, relationType = 'SUPPORTING') => {
    setAppearances(previous => {
      if (previous.some(a => a.media_external_id === result.externalId)) return previous;
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
      return next;
    });
  };

  const handleChangePhoto = async () => {
    const result = await openImageCropModal({
      title: 'Foto del personaje',
      initialUrl: imageUrl,
      aspectRatio: 3 / 4,
      saveLabel: 'Usar esta imagen',
      outputMimeType: 'image/webp',
    });
    if (result.action === 'saved') setImageUrl(result.imageUrl);
  };

  const handlePhotoDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsPhotoDragOver(false);
    const droppedUrl = getDroppedImageUrl(event.dataTransfer);
    if (droppedUrl) {
      setImageUrl(droppedUrl);
      setErrorMsg('');
      return;
    }

    const file = event.dataTransfer.files?.[0];
    if (!file?.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') setImageUrl(reader.result);
    };
    reader.readAsDataURL(file);
  };

  const prepareCharacterProposalForSession = async (externalId: string, updateStatus: (message: string) => void) => {
    const draft = currentId === externalId && currentCharacterDraftRef.current?.externalId === externalId
      ? currentCharacterDraftRef.current.draft
      : characterDraftsRef.current.get(externalId);
    if (!draft?.originalCharacter || !draft.character) return null;
    const mergedIds = draft.mergedCharacters.map(item => item.external_id).sort();
    const originalMergedIds = draft.originalMergedCharacters.map(item => item.external_id).sort();
    const mergesChanged = JSON.stringify(mergedIds) !== JSON.stringify(originalMergedIds);
    if (!hasChangedPure(draft.originalCharacter, draft) && !mergesChanged) return null;
    return submitCharacterProposal({
      currentId: externalId,
      originalCharacter: draft.originalCharacter,
      name: draft.name,
      nameNative: draft.nameNative,
      aliases: draft.aliases,
      imageUrl: draft.imageUrl,
      characteristics: draft.characteristics,
      cleanBiography: draft.cleanBiography,
      originalCleanBiography: draft.originalCleanBiography,
      appearances: draft.appearances,
      originalAppearances: draft.originalAppearances,
      mergedCharacterIds: mergedIds,
      originalMergedCharacterIds: originalMergedIds,
      mergedCharactersChanged: mergesChanged,
      voiceActors: draft.voiceActors,
      originalVoiceActors: draft.originalVoiceActors,
      appearancesChanged: appearancesChangedPure(draft.appearances, draft.originalAppearances),
      voiceActorsChanged: voiceActorsChangedPure(draft.voiceActors, draft.originalVoiceActors),
      changeSummary: mergesChanged && !hasChangedPure(draft.originalCharacter, draft)
        ? t.merge_change_summary
        : buildChangeSummaryPure(draft.originalCharacter, draft),
      setStatusMsg: updateStatus,
      statusSavingLocal: t.saving_local,
      statusPreparingProposal: t.preparing_proposal,
      prepareOnly: true,
    });
  };

  useEffect(() => {
    (window as any).prepareCharacterEditorProposal = prepareCharacterProposalForSession;
    return () => { delete (window as any).prepareCharacterEditorProposal; };
  });

  const handleSubmit = async () => {
    if (!originalCharacter || !hasChanged()) {
      setErrorMsg('No hay cambios para enviar');
      return;
    }

    setSubmitting(true);
    setErrorMsg('');

    try {
      const prUrl = await submitCharacterProposal({
        currentId,
        originalCharacter,
        name, nameNative, aliases, imageUrl,
        characteristics, cleanBiography, originalCleanBiography,
        appearances, originalAppearances,
        mergedCharacterIds: mergedCharacterIds(),
        originalMergedCharacterIds: originalMergedCharacterIds(),
        mergedCharactersChanged: mergedCharactersChanged(),
        voiceActors, originalVoiceActors,
        appearancesChanged: appearancesChanged(),
        voiceActorsChanged: voiceActorsChanged(),
        changeSummary: mergedCharactersChanged() && !hasChangedPure(originalCharacter, diffFields)
          ? t.merge_change_summary
          : buildChangeSummary(),
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
          window.dispatchEvent(new CustomEvent('metadea:character-editor-session-change', { detail: { action: 'close', externalId: currentId } }));
          const hasOtherCharacterTabs = characterEditorTabIds.some(id => id !== currentId);
          const hasMediaTabs = (window as any).__metadeaPrEditorSession?.tabs?.some((tab: any) => tab.kind !== 'character');
          if (!hasOtherCharacterTabs && !hasMediaTabs) (window as any).__metadeaPrEditorSession?.finishSession?.();
        }
        openSubmittedProposal(prUrl);
        handleClose();
      }
    } catch (err: any) {
      console.error('Failed to submit proposal:', err);
      setStatusMsg('');
      setErrorMsg(err.message || t.pr_error);
    } finally {
      setSubmitting(false);
    }
  };

  const addVoiceActor = (result: VoiceActorSearchResult) => {
    setVoiceActors(prev => prev.some(v => v.externalId === result.externalId) ? prev : [...prev, {
      externalId: result.externalId,
      name: result.name,
      native: result.nameNative,
      language: 'Japanese',
      image: result.image,
      role: 'voice',
    }]);
  };

  const updateVoiceActor = (index: number, field: keyof VoiceActorRow, value: string) => {
    setVoiceActors(prev => prev.map((va, i) => i === index ? { ...va, [field]: value } : va));
  };

  const handleVoiceActorBlur = async (index: number, name: string) => {
    const clean = name.trim();
    if (!clean) return;
    const current = voiceActors[index];
    if (current && (!current.externalId || current.externalId.startsWith('va:'))) {
      const match = await correlateVoiceActor(clean, current.language);
      if (match.matchedFrom !== 'none') {
        setVoiceActors(prev => prev.map((va, i) => {
          if (i !== index) return va;
          return {
            ...va,
            externalId: match.externalId,
            name: match.name,
            native: match.native || va.native,
            image: match.image || va.image,
          };
        }));
      }
    }
  };

  const removeVoiceActor = (index: number) => {
    setVoiceActors(prev => prev.filter((_, i) => i !== index));
  };

  const handleApplyFandomData = (data: FandomCharacterData, fields: SelectedImportFields) => {
    if (fields.name && data.name) {
      setName(data.name);
    }
    if (fields.nativeName && data.nativeName) {
      setNameNative(data.nativeName);
    }
    if (fields.image && data.imageUrl) {
      setImageUrl(data.imageUrl);
    }
    if (fields.aliases && data.aliases.length > 0) {
      setAliases(prev => Array.from(new Set([...prev, ...data.aliases])));
    }
    if (fields.characteristics && data.characteristics.length > 0) {
      setCharacteristics(prev => {
        if (prev.length === 0) return data.characteristics;
        const existingLabels = new Set(prev.map(c => c.label.toLowerCase().trim()));
        const toAdd = data.characteristics.filter(c => !existingLabels.has(c.label.toLowerCase().trim()));
        return [...prev, ...toAdd];
      });
    }
    if (fields.biography && data.cleanBiography) {
      setCleanBiography(data.cleanBiography);
    }
    if (fields.voiceActors && data.voiceActors.length > 0) {
      const newVas: VoiceActorRow[] = data.voiceActors.map(va => ({
        externalId: va.externalId || `va:${va.name}`,
        name: va.name,
        native: va.native || '',
        language: va.language,
        image: va.image || '',
        role: 'voice',
      }));
      setVoiceActors(prev => {
        const existingNames = new Set(prev.map(v => v.name.toLowerCase().trim()));
        const toAdd = newVas.filter(v => !existingNames.has(v.name.toLowerCase().trim()));
        return [...prev, ...toAdd];
      });
    }

    setStatusMsg(t.import_fandom_success);
    setTimeout(() => setStatusMsg(''), 4000);
  };

  if (!mounted || !isOpen) return null;

  if (loading) {
    return createPortal(
      <div className={`pr-editor-overlay${isSessionTab ? '' : ' pr-editor-overlay--nested'}`} onClick={requestClose}>
        {renderSessionLayout(<div className="pr-editor-modal pr-editor-modal--loading" onClick={e => e.stopPropagation()}><div className="spinner" /></div>)}
      </div>,
      document.body
    );
  }

  if (!character) return null;

  return createPortal(
    <div className={`pr-editor-overlay${isSessionTab ? '' : ' pr-editor-overlay--nested'}`} onClick={requestClose}>
      {renderSessionLayout(<div className="pr-editor-modal pr-editor-modal--narrow" onClick={e => e.stopPropagation()}>
        <PrEditorHeader
          title={`Editar ${name || character.name}`}
          subtitle={`ID: ${currentId}`}
          status={statusMsg && (
            <div className="pr-editor-header-status">
              <div className="spinner spinner--small pr-editor-header-status-spinner" />
              <span>{statusMsg}</span>
            </div>
          )}
          actions={
          <>
            <button
              type="button"
              className="pr-editor-btn pr-editor-btn--secondary pr-editor-header-action"
              onClick={() => setFandomModalOpen(true)}
              title={t.import_fandom_title}
            >
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              <span>{t.import_fandom}</span>
            </button>
            <button
              type="button"
              className="pr-editor-btn pr-editor-btn--cancel pr-editor-header-action pr-editor-header-action--icon pr-editor-header-cancel"
              onClick={requestClose}
              disabled={submitting}
              title={t.cancel}
              aria-label={t.cancel}
            >
              <X size={17} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="pr-editor-btn pr-editor-btn--submit pr-editor-header-action"
              onClick={() => isSessionTab ? (window as any).__metadeaPrEditorSession?.submitProposal?.() : void handleSubmit()}
              disabled={submitting || (isSessionTab ? !(window as any).__metadeaPrEditorSession?.hasChanges : !hasChanged())}
            >
              {submitting ? t.submitting : 'Submit Proposal'}
            </button>
          </>
          }
        />

        <div className="pr-editor-content-shell">
          <nav className="pr-editor-sidebar" aria-label="Secciones del personaje">
            <button type="button" className={`pr-editor-tab-btn${activeTab === 'general' ? ' active' : ''}`} onClick={() => setActiveTab('general')} title="General" aria-label="General">
              <Settings size={18} strokeWidth={1.8} />
              {characteristicsChanged() && <span className="pr-editor-tab-changed-dot" />}
            </button>
            <button type="button" className={`pr-editor-tab-btn${activeTab === 'appearances' ? ' active' : ''}`} onClick={() => setActiveTab('appearances')} title={t.appearances_tab} aria-label={t.appearances_tab}>
              <BookOpen size={18} strokeWidth={1.8} />
              {appearancesChanged() && <span className="pr-editor-tab-changed-dot" />}
            </button>
            <button type="button" className={`pr-editor-tab-btn${activeTab === 'merges' ? ' active' : ''}`} onClick={() => setActiveTab('merges')} title={t.merge_section} aria-label={t.merge_section}>
              <GitMerge size={18} strokeWidth={1.8} />
              {mergedCharactersChanged() && <span className="pr-editor-tab-changed-dot" />}
            </button>
            <button type="button" className={`pr-editor-tab-btn${activeTab === 'voices' ? ' active' : ''}`} onClick={() => setActiveTab('voices')} title={t.voice_actors} aria-label={t.voice_actors}>
              <Mic size={18} strokeWidth={1.8} />
              {voiceActorsChanged() && <span className="pr-editor-tab-changed-dot" />}
            </button>
          </nav>

          <main className="pr-editor-main">
          <div className="pr-editor-body">
          {errorMsg && <div className="pr-editor-alert pr-editor-alert--error pr-editor-field--full">{errorMsg}</div>}

          {activeTab === 'general' && (
          <>
          {/* Cabecera: Foto + Datos Básicos */}
          <div className="pr-editor-section" style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: '1.5rem', alignItems: 'start', marginBottom: '2rem' }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <div
                className={`pr-editor-char-photo-wrap${isPhotoDragOver ? ' is-dragging' : ''}`}
                onClick={handleChangePhoto}
                onDragOver={event => { event.preventDefault(); setIsPhotoDragOver(true); }}
                onDragLeave={() => setIsPhotoDragOver(false)}
                onDrop={handlePhotoDrop}
                role="button"
                tabIndex={0}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleChangePhoto(); } }}
                title={t.change_image}
              >
                {imageUrl
                  ? <img src={imageUrl} alt={name} onError={() => setErrorMsg('URL de imagen inválida')} />
                  : <span className="pr-editor-cover-placeholder">{t.no_image}</span>}
                <div className="pr-editor-photo-hover-overlay">
                  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                    <circle cx="12" cy="13" r="4" />
                  </svg>
                  <span>{t.change_image}</span>
                </div>
              </div>
            </div>

            <div className="pr-editor-form-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
              <Field label={t.name} changed={isFieldChanged(name, originalCharacter?.name)}>
                <input type="text" value={name} onChange={e => setName(e.target.value)} />
              </Field>

              <Field label={t.native_name} changed={isFieldChanged(nameNative, originalCharacter?.name_native)}>
                <input type="text" value={nameNative} onChange={e => setNameNative(e.target.value)} placeholder={t.optional} />
              </Field>

              <Field label={t.aliases} changed={aliases.join(',') !== (originalCharacter?.aliases_csv || '')} full>
                <TagsInput tags={aliases} onChange={setAliases} placeholder={t.aliases_ph} />
              </Field>
            </div>
          </div>

          {/* Características */}
          <div className="pr-editor-section" style={{ marginBottom: '2rem' }}>
            <span className="pr-editor-section-title">
              {t.characteristics}
              {characteristicsChanged() && <span className="pr-editor-section-changed-dot" />}
            </span>
            <div className="pr-editor-char-grid">
              {characteristics.map((c, idx) => {
                const isLong = c.value.replace(/<[^>]+>/g, '').length > 200;
                return (
                <div key={idx} className={`pr-editor-char-row${isLong ? ' pr-editor-char-row--wide' : ''}`}>
                  <input
                    type="text"
                    className="pr-editor-char-input"
                    value={c.label}
                    onChange={e => updateCharacteristic(idx, 'label', e.target.value)}
                    placeholder={t.char_label_ph}
                  />
                  <div className="pr-editor-char-divider" />
                  <RichTextEditor
                    className="pr-editor-char-richtext"
                    value={c.value}
                    onChange={v => updateCharacteristic(idx, 'value', v)}
                    placeholder={t.char_value_ph}
                  />
                  <button
                    type="button"
                    className="pr-editor-char-remove"
                    onClick={() => removeCharacteristic(idx)}
                    title={t.remove_characteristic}
                  >
                    ×
                  </button>
                </div>
                );
              })}
            </div>
            <PrEditorAddButton onClick={addCharacteristic} title={t.add_characteristic} className="pr-editor-character-add-btn" />
          </div>

          {/* ── Biografía ── */}
          <div className="pr-editor-section">
            <div className="pr-editor-form-grid">
              <Field label={t.biography} changed={isFieldChanged(cleanBiography, originalCleanBiography)} full>
                <RichTextEditor
                  value={cleanBiography}
                  onChange={setCleanBiography}
                  placeholder={t.biography_ph}
                />
              </Field>
            </div>
          </div>
          </>
          )}

          {activeTab === 'appearances' && (
          <>
          {/* ── Apariciones ── */}
          <div className="pr-editor-section">
            <div className="pr-editor-character-appearance-groups pr-editor-character-appearance-groups--paginated">
              {appearanceGroups.map(group => {
                const { type, allAppearances: roleAppearances } = group;
                const pageAppearances = getRolePageItems(roleAppearances, safeAppearancePage);
                const label = getRelationTypeLabels()[type as keyof ReturnType<typeof getRelationTypeLabels>] || type;
                return (
                  <section className="pr-editor-character-appearance-group pr-editor-media-character-role-group" key={type}>
                    <div className="pr-editor-character-appearance-header">
                      <h3 className="pr-editor-section-title pr-editor-character-appearance-title">
                        {label} <span>({roleAppearances.length})</span>
                      </h3>
                      <PrEditorAddButton
                        onClick={() => {
                          setAppearanceSearchRole(type);
                          setAppearanceSearchOpen(true);
                        }}
                        title={`${t.add_appearance}: ${label}`}
                      />
                    </div>
                    <div className="pr-editor-characters-grid pr-editor-media-character-role-grid">
                      {pageAppearances.map(a => (
                <div key={a.media_external_id} className="pr-editor-media-card">
                  <div className="pr-editor-media-card-cover">
                    {a.cover
                      ? <img className="cover-image-fill" src={a.cover} alt="" />
                      : <div className="pr-editor-media-card-placeholder" />}
                    <button
                      type="button"
                      className="pr-editor-media-card-remove"
                      onClick={() => removeAppearance(a.media_external_id)}
                    >
                      ×
                    </button>
                  </div>
                  <div className="pr-editor-media-card-title" title={a.release_year ? `${a.title} (${a.release_year})` : a.title}>
                    {a.title}
                  </div>
                  {a.release_year ? <div className="pr-editor-character-appearance-year">({a.release_year})</div> : null}
                </div>
                      ))}
                    </div>
                  </section>
                );
              })}
            </div>
            <PrEditorRolePagination page={safeAppearancePage} totalPages={appearanceTotalPages} onPageChange={setAppearancePage} />

            {/* Character identity merges are managed in the dedicated tab. */}
            {/* <div className="pr-editor-appearance-merges">
              <div className="pr-editor-section-title">{t.appearance_merges}</div>
              {appearances.map(a => (
                <div className="pr-editor-appearance-merge-row" key={`merge-${a.media_external_id}`}>
                  <div className="pr-editor-appearance-merge-work" title={a.title}>{a.title}</div>
                  <div className="pr-editor-appearance-merge-controls">
                    <span
                      className={`pr-editor-appearance-merge-label${a.merged_character_external_id ? '' : ' is-empty'}`}
                      title={a.merged_character_external_id || undefined}
                    >
                      {a.merged_character_external_id
                        ? `${t.merged_with}: ${a.merged_character_name || a.merged_character_external_id}`
                        : t.no_merge_target}
                    </span>
                    <button
                      type="button"
                      className="pr-editor-appearance-merge-btn"
                      onClick={() => setMergePickerFor(a.media_external_id)}
                    >
                      {a.merged_character_external_id ? t.change_merge : t.merge_character}
                    </button>
                    {a.merged_character_external_id && (
                      <button
                        type="button"
                        className="pr-editor-appearance-merge-clear"
                        onClick={() => clearAppearanceMergeTarget(a.media_external_id)}
                        title={t.clear_merge}
                        aria-label={t.clear_merge}
                      >×</button>
                    )}
                  </div>
                </div>
              ))}
            </div> */}
          </div>
          </>
          )}

          {activeTab === 'merges' && (
            <div className="pr-editor-section pr-editor-character-merges">
              {mergedCharacters.length > 0 ? (
                <div className="pr-editor-character-merge-list">
                  {mergedCharacters.map(item => (
                    <div className="pr-editor-character-merge-item" key={item.external_id}>
                      {item.image_url
                        ? <img src={item.image_url} alt="" />
                        : <div className="pr-editor-character-merge-placeholder">{item.name.charAt(0).toUpperCase()}</div>}
                      <span className="pr-editor-character-merge-name" title={`${item.name} · ${item.external_id}`}>
                        <strong>{item.name}</strong>
                        <small>{item.external_id}</small>
                      </span>
                      <button type="button" onClick={() => removeMergedCharacter(item.external_id)} title={t.clear_merge} aria-label={t.clear_merge}>×</button>
                    </div>
                  ))}
                </div>
              ) : null}
              <div className="pr-editor-add-row pr-editor-character-merge-add-row">
                <PrEditorAddButton onClick={() => setMergeMediaSearchOpen(true)} title={t.add_merge} />
                <button
                  ref={mergeInfoRef}
                  type="button"
                  className="pr-editor-merge-info"
                  aria-label={`${t.merge_info}: ${t.merge_hint}`}
                  aria-describedby={mergeHintPosition ? 'character-merge-info-tooltip' : undefined}
                  onMouseEnter={updateMergeHintPosition}
                  onMouseLeave={() => {
                    if (document.activeElement !== mergeInfoRef.current) setMergeHintPosition(null);
                  }}
                  onFocus={updateMergeHintPosition}
                  onBlur={() => setMergeHintPosition(null)}
                ><span className="info-indicator" aria-hidden="true">i</span></button>
              </div>
            </div>
          )}

          {activeTab === 'voices' && (
          <>
          <div className="pr-editor-section">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: '0.6rem' }}>
              {voiceActors.map((va, idx) => (
                <div key={idx} className="pr-editor-va-card">
                  <button
                    type="button"
                    className="pr-editor-media-card-remove"
                    onClick={() => removeVoiceActor(idx)}
                    title={t.remove_voice_actor}
                  >
                    ×
                  </button>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', paddingRight: '1rem' }}>
                    {va.image ? (
                      <img src={va.image} alt="" style={{ width: '24px', height: '24px', borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
                    ) : (
                      <div style={{ width: '24px', height: '24px', borderRadius: '50%', background: 'var(--border-color)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.65rem', flexShrink: 0 }}>
                        {va.name ? va.name.charAt(0).toUpperCase() : '?'}
                      </div>
                    )}
                    <input
                      type="text"
                      className="pr-editor-char-input"
                      value={va.name}
                      onChange={e => updateVoiceActor(idx, 'name', e.target.value)}
                      onBlur={() => handleVoiceActorBlur(idx, va.name)}
                      placeholder={t.actor_name_ph}
                      style={{ flex: 1, minWidth: 0, fontWeight: 600, fontSize: '0.75rem' }}
                    />
                  </div>

                  <input
                    type="text"
                    className="pr-editor-char-input"
                    value={va.native}
                    onChange={e => updateVoiceActor(idx, 'native', e.target.value)}
                    placeholder={t.actor_native_ph}
                    style={{ fontSize: '0.7rem' }}
                  />

                  <VoiceActorLangStepper
                    language={va.language}
                    onChange={lang => updateVoiceActor(idx, 'language', lang)}
                  />
                </div>
              ))}
            </div>
            <div className="pr-editor-add-row">
              <PrEditorAddButton onClick={() => setVoiceActorSearchOpen(true)} title={t.add_voice_actor} />
            </div>
          </div>
          </>
          )}
          </div>
          </main>
        </div>

      </div>)}

      <PrEditorChangelogPanel externalId={currentId} />

      {showUnsavedPrompt && (
        <div className="pr-unsaved-changes-toast" role="alertdialog" aria-live="assertive" onClick={event => event.stopPropagation()}>
          {pendingCharacterTabCloseId ? <span>Este personaje tiene cambios sin guardar</span> : <span>Tienes cambios sin guardar</span>}
          {pendingCharacterTabCloseId ? (
            <>
              <button type="button" className="pr-editor-btn pr-editor-btn--cancel" onClick={() => removeCharacterEditorTab(pendingCharacterTabCloseId, true)} disabled={submitting}>Cerrar sin guardar</button>
              <button type="button" className="pr-editor-btn pr-editor-btn--secondary" onClick={() => { setPendingCharacterTabCloseId(null); setShowUnsavedPrompt(false); }}>Cancelar</button>
            </>
          ) : (
            <>
              <button type="button" className="pr-editor-btn pr-editor-btn--submit" onClick={() => void handleSubmit()} disabled={submitting || !hasChanged()}>
                {submitting ? t.submitting : 'Submit proposal'}
              </button>
              <button type="button" className="pr-editor-btn pr-editor-btn--cancel" onClick={handleClose} disabled={submitting}>Descartar</button>
            </>
          )}
        </div>
      )}

      {characterTabContextMenu && createPortal(
        <div className="pr-editor-session-tab-context-menu" role="menu" style={{ left: Math.min(characterTabContextMenu.x, window.innerWidth - 190), top: Math.min(characterTabContextMenu.y, window.innerHeight - 58) }} onPointerDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()}>
              <button type="button" role="menuitem" onClick={() => {
                const tab = sharedSessionTabs.find(item => item.externalId === characterTabContextMenu.externalId && item.kind === characterTabContextMenu.kind);
                const controller = (window as any).__metadeaPrEditorSession;
                if (tab && controller?.closeTab) controller.closeTab(tab);
                else removeCharacterEditorTab(characterTabContextMenu.externalId);
                setCharacterTabContextMenu(null);
              }}>Cerrar pestaña</button>
        </div>,
        document.body,
      )}

      {appearanceSearchOpen && (
        <MediaSearchPopup
          onSelect={result => addAppearance(result, appearanceSearchRole)}
          onClose={() => setAppearanceSearchOpen(false)}
          excludeIds={appearances.map(a => a.media_external_id)}
          multiSelect
        />
      )}

      {mergeMediaSearchOpen && (
        <MediaSearchPopup
          onSelect={() => {}}
          onClose={() => setMergeMediaSearchOpen(false)}
          closeOnSelect
          castPicker={{
            loadCast: loadMergeCandidates,
            onSelectCharacter: (work, candidate) => addMergedCharacter(candidate, work),
            title: t.select_character,
            loadingLabel: t.loading_characters,
            emptyLabel: t.no_characters,
            backLabel: t.back_to_works,
            errorLabel: t.merge_cast_error,
          }}
        />
      )}

      {/* {mergeSelectedWork && createPortal(
        <div className="pr-editor-overlay pr-editor-overlay--nested pr-editor-merge-cast-overlay" onClick={() => setMergeSelectedWork(null)}>
          <div className="pr-editor-merge-cast-modal" onClick={event => event.stopPropagation()}>
            <div className="pr-editor-merge-cast-header">
              <div>
                <span className="pr-editor-section-title">{t.select_character}</span>
                <small>{mergeSelectedWork.title}</small>
              </div>
              <button type="button" onClick={() => setMergeSelectedWork(null)} aria-label={t.cancel}>×</button>
            </div>
            {mergeCandidatesLoading ? (
              <div className="pr-editor-character-merges-empty">{t.loading_characters}</div>
            ) : mergeCandidates.length > 0 ? (
              <div className="pr-editor-merge-cast-list">
                {mergeCandidates.map(candidate => (
                  <button type="button" className="pr-editor-merge-cast-option" key={candidate.external_id} onClick={() => addMergedCharacter(candidate)}>
                    {candidate.image_url
                      ? <img src={candidate.image_url} alt="" />
                      : <span className="pr-editor-character-merge-placeholder">{candidate.name.charAt(0).toUpperCase()}</span>}
                    <span><strong>{candidate.name}</strong><small>{candidate.external_id}</small></span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="pr-editor-character-merges-empty">{t.no_characters}</div>
            )}
          </div>
        </div>,
        document.body,
      )} */}

      {/* Keep the hint outside the modal, whose overflow:hidden clips child tooltips. */}
      {mergeHintPosition && (
        <div
          id="character-merge-info-tooltip"
          className="pr-editor-merge-tooltip"
          role="tooltip"
          style={{ top: mergeHintPosition.top, left: mergeHintPosition.left }}
        >
          {t.merge_hint}
        </div>
      )}

      {voiceActorSearchOpen && (
        <VoiceActorSearchPopup
          onSelect={addVoiceActor}
          onClose={() => setVoiceActorSearchOpen(false)}
          excludeIds={voiceActors.map(v => v.externalId).filter((id): id is string => !!id)}
        />
      )}

      {fandomModalOpen && (
        <FandomImportModal
          isOpen={fandomModalOpen}
          onClose={() => setFandomModalOpen(false)}
          onApply={handleApplyFandomData}
        />
      )}
    </div>,
    document.body
  );
}
