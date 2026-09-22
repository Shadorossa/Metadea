import React, { useState, useEffect, useMemo, useRef } from 'react';
import { BookOpen, Boxes, Clapperboard, GitBranch, Layers, Link, List, Music2, Package, RefreshCw, Settings, Sparkles, Trash2, Users, X, type LucideIcon } from 'lucide-react';
import { createPortal } from 'react-dom';
import { invoke } from '../../lib/tauri';
import { getCatalogEntryForEditor, getBlockedExternalIds, getMediaAuthors, getMediaRelationsForEditor } from '../../lib/tauri/catalog';
import { invalidateCachedMediaData, fetchMediaDataInternal, fetchMediaThemes } from '../../lib/media/mediaService';
import { mapMediaDataToCatalogEntry } from '../../lib/media/catalog-mapper';
import { isVnovelExternalId } from '../../lib/media/mapper-utils';
import type { MediaCatalogEntry, DbMediaAuthor } from '../../lib/tauri/catalog';
import { getMediaCharacters, type DbMediaCharacter } from '../../lib/tauri/characters';
import type { ProposalFileEntry } from '../../lib/github/submitCollaborativeProposal';
import { getMediaEpisodes, type MediaEpisode, type MediaTheme } from '../../lib/tauri/misc-commands';
import { fetchMediaEpisodes } from '../../lib/media/episode-list';
import { fetchTmdbDetail, fetchTmdbEpisodes, type TmdbTvDetail } from '../../lib/search/providers/tmdb';
import type { SearchResult as ApiSearchResult } from '../../lib/search';
import { submitPrEditorChanges } from './pr-editor/pr-editor-submit';
import { loadPrEditorRelationsAndSaga } from './pr-editor/pr-editor-load';
import { buildPrEditorChangeSummary } from './pr-editor/pr-editor-change-summary';
import { mergeResyncFields, buildResyncCharacters, appendResyncRelations, appendResyncRecommendations } from './pr-editor/pr-editor-resync';
import { MediaSearchPopup } from './MediaSearchPopup';
import { MediaSourceMappingSearchPopup, type MediaSourceMappingKind } from './MediaSourceMappingSearchPopup';
import { generateCustomCharacterId } from '../../lib/character/customCharacter';
import { comicVineGetIssues } from '../../lib/tauri/comicvine';
import { SlotInput } from './SlotInput';
import {
  EDITABLE_RELATION_OPTIONS,
  CONTAINS_RELATION_TYPES,
  type SagaRelationType,
} from '../../lib/media/sagaTypes';
import { createMetaResolver, type MediaMeta } from '../../lib/media/sagaGrouping';
import { ALL_PLATFORMS, ALL_GENRES } from '../../lib/constants/igdbData';
import { DIFF_FIELDS } from '../../lib/media/constants';
import { normField, ChangedDot, Field } from '../shared/PrEditorField';
import { RichTextEditor } from '../shared/RichTextEditor';
import { useDragReorder } from './hooks/useDragReorder';
import { PrEditorCharactersSection } from './pr-editor/PrEditorCharactersSection';
import { PrEditorThemeCard } from './pr-editor/PrEditorThemeCard';
import { PrEditorRelationCardList } from './pr-editor/PrEditorRelationCardList';
import { PrEditorStoryArcsSection } from './pr-editor/PrEditorStoryArcsSection';
import { PrEditorSagaOrderSection } from './pr-editor/PrEditorSagaOrderSection';
import { PrEditorAddButton } from './pr-editor/PrEditorAddButton';
import { PrEditorRelationsSection } from './pr-editor/PrEditorRelationsSection';
import { PrEditorChangelogPanel } from './pr-editor/PrEditorChangelogPanel';
import { PrEditorHeader } from '../shared/PrEditorHeader';
import { getT } from '../../i18n/client';
import { CANONICAL_RELATION_LABELS } from '../../lib/media/canonical-relations';

// Always saved as a PART_OF relation — there's no per-item type to pick
// anymore (previously episode/update, shown as a dropdown).
export interface BundledRelation {
  external_id: string;
  title?: string | null;
  cover?: string | null;
}

// Editable relations: ADAPTATION, SPIN_OFF, ALTERNATIVE, etc (not saga-managed)
export interface EditableRelation {
  related_media_external_id: string;
  relation_type: string;
  type_label: string;
  title?: string | null;
  cover?: string | null;
}

export interface PreparedMediaProposal {
  entries: ProposalFileEntry[];
  changeSummary: string;
}

export interface PrEditorSessionHandle {
  hasChanges: () => boolean;
  affectedExternalIds: () => string[];
  prepareProposal: () => Promise<PreparedMediaProposal | null>;
}

export interface PrEditorSessionTab {
  externalId: string;
  label: string;
  dirty: boolean;
  affected: boolean;
  kind?: 'media' | 'character';
}

interface Props {
  externalId: string;
  initialTab?: 'general' | 'cast' | 'relations';
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


const DEFAULT_NEW_RELATION_TYPE = 'REL_ADAPTATION';
type RelationsSubtab = 'saga' | 'relations' | 'recommendations' | 'bundled' | 'arcs' | 'issues' | 'episodes' | 'themes' | 'bundle-children' | 'contains';
const RELATIONS_SUBTAB_ICONS: Record<RelationsSubtab, LucideIcon> = {
  saga: GitBranch,
  relations: Link,
  recommendations: Sparkles,
  bundled: Package,
  arcs: Layers,
  issues: BookOpen,
  episodes: Clapperboard,
  themes: Music2,
  'bundle-children': Boxes,
  contains: List,
};

// True when two string records differ after normalizing each value (missing
// keys fall back through `normalize`), regardless of which record a key is in.
function recordsDiffer(a: Record<string, string>, b: Record<string, string>, normalize: (v?: string) => string): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    if (normalize(a[k]) !== normalize(b[k])) return true;
  }
  return false;
}

function enforceSingleMovieEpisode(entry: MediaCatalogEntry): MediaCatalogEntry {
  return entry.type === 'movie' && entry.total_count !== 1 ? { ...entry, total_count: 1 } : entry;
}

export function PrEditorModal({ externalId, initialTab = 'general', initialRelationsSubtab, onClose, onSaved, onBlockedSubmitted, onEditSagaEntry, onEditCharacter, sessionActive = true, sessionMode = false, sessionHasChanges = false, sessionAffected = false, sessionTabs = [], onNavigateSessionEntry, onNavigateSessionTab, onRequestCloseSessionEntry, onRequestCloseSessionTab, onSessionTitleChange, onSessionSagaOrderChange, onSessionDirtyChange, onSubmitProposalSession, onRequestSessionClose, onDiscardSession, onRegisterSessionEditor, mode = 'proposal', nonGithubFields }: Props) {
  const t = getT();
  const tm = t.media;
  const pe = t.pr_editor;
  // Also what the Relations dropdown itself displays (not just what gets
  // persisted) — a curator's own UI language shouldn't decide what a PR
  // reviewer in a different language sees on that same option, and this is
  // the exact text that ends up in type_label (see updateEditableRelationType
  // below), so showing anything else here would just be misleading.
  const canonicalRelationLabels = CANONICAL_RELATION_LABELS;

  // A remaster/remake/expanded-edition/bundle relation picked here should
  // keep this entry's own type, not always default to 'game' — a VN's
  // remaster is still a VN (see MediaSearchPopup's own comment).
  const igdbRelationMediaType = isVnovelExternalId(externalId) ? 'vnovel' as const : 'game' as const;
  const tPr = getT().pr_editor;

  const [activeTab, setActiveTab] = useState<'general' | 'cast' | 'relations'>(initialTab);
  const [relationsSubtab, setRelationsSubtab] = useState<RelationsSubtab>(initialRelationsSubtab ?? 'saga');
  useEffect(() => {
    setActiveTab(initialTab);
    setRelationsSubtab(initialRelationsSubtab ?? 'saga');
  }, [externalId, initialTab, initialRelationsSubtab]);
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
  const [sessionTabContextMenu, setSessionTabContextMenu] = useState<{ externalId: string; kind?: 'media' | 'character'; x: number; y: number } | null>(null);
  const [statusMsg, setStatusMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [entry, setEntry] = useState<MediaCatalogEntry | null>(null);
  const [originalEntry, setOriginalEntry] = useState<MediaCatalogEntry | null>(null);

  const [bundledRelations, setBundledRelations] = useState<BundledRelation[]>([]);
  const [originalBundledIds, setOriginalBundledIds] = useState<Set<string>>(new Set());

  // Reverse of Bundled In — items that have *this* entry as their Bundled In
  // (i.e. this entry is the container). Read/write mirrors bundledRelations
  // exactly, just the other direction (EPISODE instead of PART_OF).
  const [containedRelations, setContainedRelations] = useState<BundledRelation[]>([]);
  const [originalContainedIds, setOriginalContainedIds] = useState<Set<string>>(new Set());

  // Bundled In's own referenced bundle (bundledRelations[0], if any) gets its
  // *own* Contains list editable right here too — so adding "The Orange Box"
  // as a Bundled In from Half-Life 2's editor lets you also add the rest of
  // the bundle's contents in the same sitting, instead of having to leave
  // and separately open the bundle's own editor to fill in Contains one by
  // one. This entry itself isn't part of this list (it's already implied by
  // the Bundled In relation above); this only covers "the rest".
  const [bundleChildren, setBundleChildren] = useState<BundledRelation[]>([]);
  const [originalBundleChildIds, setOriginalBundleChildIds] = useState<Set<string>>(new Set());
  const [bundleChildrenLoadedFor, setBundleChildrenLoadedFor] = useState<string | null>(null);

  const [editableRelations, setEditableRelations] = useState<EditableRelation[]>([]);
  // Maps id -> its original relation_type, both to know which ids existed
  // before (Set-like via .has) and to detect an in-place type change on an
  // id that's still present (a plain id Set couldn't tell the two apart).
  const [originalEditableRelationTypes, setOriginalEditableRelationTypes] = useState<Map<string, string>>(new Map());
  const [recommendations, setRecommendations] = useState<BundledRelation[]>([]);
  const [originalRecommendationIds, setOriginalRecommendationIds] = useState<Set<string>>(new Set());

  // ComicVine issues — split out of editableRelations into their own
  // collapsible section since their titles are often just a bare issue
  // number, which used to clutter the general Relations grid.
  const [issueRelations, setIssueRelations] = useState<BundledRelation[]>([]);
  const [originalIssueRelations, setOriginalIssueRelations] = useState<BundledRelation[]>([]);
  const [originalIssueIds, setOriginalIssueIds] = useState<Set<string>>(new Set());
  const [isLoadingIssuePreview, setIsLoadingIssuePreview] = useState(false);
  const [issuePreviewError, setIssuePreviewError] = useState<string | null>(null);
  const issuePreviewRequest = useRef(0);
  const [episodePreview, setEpisodePreview] = useState<MediaEpisode[]>([]);
  const [episodePreviewLoading, setEpisodePreviewLoading] = useState(false);
  const [episodeSourceTitle, setEpisodeSourceTitle] = useState('');
  const [themePreview, setThemePreview] = useState<MediaTheme[]>([]);
  const [themePreviewLoading, setThemePreviewLoading] = useState(false);
  const episodePreviewRequest = useRef(0);

  // Saga — one single ordered chain (chronological order), including this
  // entry itself. Every adjacent pair in this order gets a SEQUEL edge
  // (earlier → later) and a PREQUEL edge (later → earlier) on submit — for
  // every id in the chain, not just the one currently open in the editor.
  const [sagaOrder, setSagaOrder] = useState<string[]>([externalId]);
  const [originalSagaOrder, setOriginalSagaOrder] = useState<string[]>([externalId]);

  // Display-only metadata (cover/title) for saga members other than this
  // entry, so tags can show a thumbnail instead of a bare id — populated
  // either from the existing relation rows (which already join title/cover
  // from media_catalog) or from the live API search result the user picked.
  const [sagaMeta, setSagaMeta] = useState<Record<string, MediaMeta>>({});
  // 'main' ids can share a sagaGroups key to collapse into one timeline step
  // and become alternate versions of each other
  // (e.g. a console remaster + its PC original); 'source'/'episode'/'update'
  // ids attach to the nearest preceding group instead (see classifySagaChain).
  const [sagaRelationTypes, setSagaRelationTypes] = useState<Record<string, SagaRelationType>>({});
  const [sagaGroups, setSagaGroups] = useState<Record<string, string>>({});
  const [originalSagaRelationTypes, setOriginalSagaRelationTypes] = useState<Record<string, SagaRelationType>>({});
  const [originalSagaGroups, setOriginalSagaGroups] = useState<Record<string, string>>({});
  const [sagaName, setSagaName] = useState('');
  const [originalSagaName, setOriginalSagaName] = useState('');


  const [characters, setCharacters] = useState<DbMediaCharacter[]>([]);
  const [originalCharacters, setOriginalCharacters] = useState<DbMediaCharacter[]>([]);
  const [showCharSearch, setShowCharSearch] = useState(false);
  const [castSearchRole, setCastSearchRole] = useState('SUPPORTING');
  const characterCreateRole = useRef('SUPPORTING');
  const [selectedCastCharacters, setSelectedCastCharacters] = useState<Array<{ external_id: string; name: string; image_url?: string | null }>>([]);
  const [mediaAuthors, setMediaAuthors] = useState<DbMediaAuthor[]>([]);
  const [originalMediaAuthors, setOriginalMediaAuthors] = useState<DbMediaAuthor[]>([]);
  // Arcs delete themselves immediately (see PrEditorStoryArcsSection), so
  // there's no before/after list here to diff for the GitHub merge like
  // characters/authors get — the section reports its own removals instead.
  const [removedArcIds, setRemovedArcIds] = useState<string[]>([]);

  const [searchPopupMode, setSearchPopupMode] = useState<'saga' | 'bundled' | 'contains' | 'relations' | 'recommendations' | 'bundle-children' | null>(null);
  const [sourceMappingSearch, setSourceMappingSearch] = useState<MediaSourceMappingKind | null>(null);

  const relationsSubtabs = useMemo(() => {
    const tabs: Array<{ id: RelationsSubtab; label: string; visible: boolean }> = [
      { id: 'saga', label: 'Saga', visible: true },
      { id: 'relations', label: 'Relaciones', visible: true },
      { id: 'recommendations', label: 'Recomendados', visible: true },
      { id: 'bundled', label: 'Incluida en', visible: true },
      { id: 'arcs', label: 'Arcos', visible: true },
      { id: 'issues', label: 'Issues', visible: !!entry && (issueRelations.length > 0 || ['comic', 'manga', 'lnovel'].includes(entry.type)) },
      { id: 'episodes', label: 'Episodios', visible: !!entry && ['anime', 'series'].includes(entry.type) },
      { id: 'themes', label: tm.section_themes, visible: entry?.type === 'anime' },
      { id: 'bundle-children', label: 'Contenido', visible: bundledRelations.length > 0 },
      { id: 'contains', label: 'Contiene', visible: entry?.format === 'BUNDLE' },
    ];
    return tabs.filter(tab => tab.visible);
  }, [entry?.type, entry?.format, issueRelations.length, bundledRelations.length, tm.section_themes]);

  useEffect(() => {
    if (relationsSubtabs.some(tab => tab.id === relationsSubtab)) return;
    if (!entry && initialRelationsSubtab === relationsSubtab) return;
    setRelationsSubtab(relationsSubtabs[0]?.id ?? 'saga');
  }, [entry, initialRelationsSubtab, relationsSubtabs, relationsSubtab]);

  useEffect(() => {
    if (mode === 'local') return;
    let cancelled = false;
    invoke<string | null>('get_github_token').catch(() => null).then(token => {
      if (!cancelled) setGithubGate(token ? 'ok' : 'signed-out');
    });
    return () => { cancelled = true; };
  }, [mode]);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await getCatalogEntryForEditor(externalId);
        const resolved = res ?? {
          id: '',
          external_id: externalId,
          type: externalId.split(':')[0],
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        setEntry(enforceSingleMovieEpisode(resolved));
        setOriginalEntry(resolved);
      } catch (err) {
        console.error('Failed to get catalog entry:', err);
        // An older running Tauri binary may not yet have the editor-only
        // command compiled in. The blocked-id command is older and lets the
        // modal preserve the active removal state instead of presenting a
        // misleading enabled-looking button.
        const blockedIds = await getBlockedExternalIds().catch(() => [] as string[]);
        if (blockedIds.includes(externalId)) {
          const now = new Date().toISOString();
          const liveData = await fetchMediaDataInternal(externalId, true).catch(() => null);
          const fallback = {
            ...(liveData ? mapMediaDataToCatalogEntry(liveData, externalId) : {}),
            id: '',
            external_id: externalId,
            type: liveData?.type ?? externalId.split(':')[0],
            blocked_at: 'blocked',
            created_at: now,
            updated_at: now,
          };
          setEntry(enforceSingleMovieEpisode(fallback));
          setOriginalEntry(fallback);
        } else {
          setErrorMsg('Error reading local data');
        }
      }

      try {
        const result = await loadPrEditorRelationsAndSaga(externalId);
        setBundledRelations(result.bundledRelations);
        setOriginalBundledIds(result.originalBundledIds);
        setContainedRelations(result.containedRelations);
        setOriginalContainedIds(result.originalContainedIds);
        setEditableRelations(result.editableRelations);
        setOriginalEditableRelationTypes(result.originalEditableRelationTypes);
        setRecommendations(result.recommendations);
        setOriginalRecommendationIds(result.originalRecommendationIds);
        setIssueRelations(result.issueRelations);
        setOriginalIssueRelations(result.issueRelations);
        setOriginalIssueIds(result.originalIssueIds);
        if (result.currentEntry) {
          setEntry(enforceSingleMovieEpisode(result.currentEntry));
          setOriginalEntry(result.currentEntry);
        }
        setSagaMeta(result.sagaMeta);
        setSagaOrder(result.sagaOrder);
        setOriginalSagaOrder(result.originalSagaOrder);
        setSagaRelationTypes(result.sagaRelationTypes);
        setOriginalSagaRelationTypes(result.originalSagaRelationTypes);
        setSagaGroups(result.sagaGroups);
        setOriginalSagaGroups(result.originalSagaGroups);
        setSagaName(result.sagaName);
        setOriginalSagaName(result.originalSagaName);
      } catch (err) {
        console.error('Failed to load relations/saga:', err);
        setBundledRelations([]);
        setContainedRelations([]);
        setEditableRelations([]);
        setRecommendations([]);
        setOriginalRecommendationIds(new Set());
        setIssueRelations([]);
      } finally {
        setLoading(false);
      }
    };

    load();
    getMediaCharacters(externalId).then(chars => { setCharacters(chars); setOriginalCharacters(chars); }).catch(() => { setCharacters([]); setOriginalCharacters([]); });
    getMediaAuthors(externalId).then(a => { setMediaAuthors(a); setOriginalMediaAuthors(a); }).catch(() => { setMediaAuthors([]); setOriginalMediaAuthors([]); });
  }, [externalId]);

  useEffect(() => {
    if (!entry || !['anime', 'series'].includes(entry.type)) {
      setEpisodePreview([]);
      setEpisodeSourceTitle('');
      setEpisodePreviewLoading(false);
      setThemePreview([]);
      setThemePreviewLoading(false);
      return;
    }

    let cancelled = false;
    const requestId = ++episodePreviewRequest.current;
    const isCurrent = () => !cancelled && requestId === episodePreviewRequest.current;
    setEpisodePreviewLoading(true);
    setEpisodePreview([]);
    setEpisodeSourceTitle('');
    setThemePreview([]);
    if (entry.type === 'anime') {
      setThemePreviewLoading(true);
      fetchMediaThemes(externalId)
        .then(themes => { if (isCurrent()) setThemePreview(themes); })
        .catch(error => { if (isCurrent()) console.error('Failed to load theme preview', error); })
        .finally(() => { if (isCurrent()) setThemePreviewLoading(false); });
    } else {
      setThemePreviewLoading(false);
    }

    const toPreviewEpisode = (episode: {
      season_number: number;
      episode_number: number;
      season_episode_number?: number;
      name: string | null;
      cover_url: string | null;
    }): MediaEpisode => ({
      external_id: externalId,
      season_number: episode.season_number,
      episode_number: episode.season_episode_number ?? episode.episode_number,
      name: episode.name,
      cover_url: episode.cover_url,
      source_key: null,
      mapping_key: null,
    });

    const load = async () => {
      if (entry.episode_source_id) {
        const tmdbId = Number(entry.episode_source_id);
        if (!Number.isInteger(tmdbId) || tmdbId <= 0) return;
        const detail = await fetchTmdbDetail(tmdbId, 'series') as TmdbTvDetail | null;
        if (!isCurrent()) return;
        setEpisodeSourceTitle(detail?.name || `TMDB #${tmdbId}`);
        const seasons = detail?.number_of_seasons || entry.total_count_2 || 0;
        const episodes = seasons > 0 ? await fetchTmdbEpisodes(tmdbId, seasons) : [];
        if (isCurrent()) setEpisodePreview(episodes.map(toPreviewEpisode));
        return;
      }

      const cached = await getMediaEpisodes(externalId).catch(() => []);
      if (isCurrent() && cached.length > 0) setEpisodePreview(cached);
      const episodes = await fetchMediaEpisodes(
        externalId,
        false,
        entry.type === 'series' ? entry.total_count_2 ?? undefined : undefined,
      ).catch(() => cached);
      if (!isCurrent()) return;
      setEpisodePreview(episodes);

      const tmdbId = episodes
        .map(episode => episode.source_key?.match(/^tmdb:(\d+):/)?.[1])
        .find(Boolean)
        || (entry.type === 'series' ? externalId.match(/^series:(\d+)$/)?.[1] : undefined);
      if (tmdbId) {
        const detail = await fetchTmdbDetail(Number(tmdbId), 'series') as TmdbTvDetail | null;
        if (isCurrent()) setEpisodeSourceTitle(detail?.name || `TMDB #${tmdbId}`);
      } else if (isCurrent()) {
        setEpisodeSourceTitle(episodes.some(episode => episode.source_key?.startsWith('anilist:')) ? 'AniList' : '—');
      }
    };

    load().catch(error => {
      if (isCurrent()) console.error('Failed to load episode source preview', error);
    }).finally(() => {
      if (isCurrent()) setEpisodePreviewLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [externalId, entry?.type, entry?.episode_source_id, entry?.total_count_2]);

  // Loads the referenced bundle's existing Contains list once, the first
  // time bundledRelations picks one up — re-fires only if the bundle itself
  // changes (not on every bundleChildren edit, which would refetch and wipe
  // out unsaved additions/removals). Clears back to empty if the bundle
  // relation is removed again.
  useEffect(() => {
    const bundleId = bundledRelations[0]?.external_id;
    if (!bundleId) {
      setBundleChildren([]);
      setOriginalBundleChildIds(new Set());
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
      setBundleChildren(children);
      setOriginalBundleChildIds(new Set(children.map(c => c.external_id)));
      setBundleChildrenLoadedFor(bundleId);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [bundledRelations, externalId, bundleChildrenLoadedFor]);

  // A character created via "+ Crear personaje" (onOpenCreate below) opens
  // the real CharacterPrEditorModal directly instead of anything owned by
  // this component — the only way back into this entry's own cast list is
  // this event, dispatched by that modal the instant its own local save
  // succeeds (see its handleSubmit), independent of whether its GitHub
  // proposal step succeeds/fails/never runs at all. The functional state
  // update means this listener never needs re-registering after list edits.
  useEffect(() => {
    function onCharacterSaved(e: Event) {
      const detail = (e as CustomEvent<{ externalId: string; name: string; imageUrl: string | null }>).detail;
      if (!detail?.externalId) return;
      setCharacters(prev => prev.some(c => c.external_id === detail.externalId) ? prev : [...prev, {
        external_id: detail.externalId,
        name: detail.name,
        image_url: detail.imageUrl,
        relation_type: characterCreateRole.current,
        character_name: null,
      }]);
    }
    window.addEventListener('metadea:character-saved', onCharacterSaved);
    return () => window.removeEventListener('metadea:character-saved', onCharacterSaved);
  }, []);

  // ── Character handlers ──────────────────────────────────────────────────────

  const removeCharacter = (charExternalId: string) =>
    setCharacters(characters.filter(c => c.external_id !== charExternalId));
  const charactersChanged = () => {
    const key = (c: DbMediaCharacter) => `${c.external_id}::${c.relation_type ?? ''}`;
    const a = new Set(characters.map(key));
    const b = new Set(originalCharacters.map(key));
    return a.size !== b.size || [...a].some(k => !b.has(k));
  };

  // ── Saga handlers ──────────────────────────────────────────────────────────

  const addToSaga = (result: ApiSearchResult) => {
    if (sagaOrder.includes(result.externalId)) return;

    // Catches a *different* id with the same title (e.g. duplicate IGDB
    // entries per platform) — confirm rather than block outright, since two
    // different works can coincidentally share a title.
    const normalizedTitle = result.titleMain.trim().toLowerCase();
    const duplicateTitleId = sagaOrder.find(id => {
      const existingTitle = id === externalId ? entry?.title_main : sagaMeta[id]?.title;
      return existingTitle?.trim().toLowerCase() === normalizedTitle;
    });
    if (duplicateTitleId) {
      const proceed = window.confirm(
        `"${result.titleMain}" ya parece estar en la saga (mismo título, id distinto: ${duplicateTitleId} vs ${result.externalId}). ¿Añadirla de todas formas?`
      );
      if (!proceed) return;
    }

    setSagaOrder([...sagaOrder, result.externalId]);
    setSagaMeta(prev => ({ ...prev, [result.externalId]: { title: result.titleMain, cover: result.coverUrl } }));
  };
  const removeFromSaga = (id: string) => {
    if (id === externalId) return; // this entry can move, not leave its own saga
    setSagaOrder(sagaOrder.filter(x => x !== id));
  };
  const ungroupSagaItems = (ids: string[]) => {
    setSagaGroups(previous => {
      const next = { ...previous };
      ids.forEach(id => { delete next[id]; });
      return next;
    });
  };
  const reorderSaga = (fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || fromIndex >= sagaOrder.length || toIndex >= sagaOrder.length) return;
    const next = [...sagaOrder];
    const [moved] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, moved);
    setSagaOrder(next);
  };
  const canGroupSagaItems = (fromIndex: number, toIndex: number) => {
    const sourceId = sagaOrder[fromIndex];
    const targetId = sagaOrder[toIndex];
    if (!sourceId || !targetId || sourceId === targetId) return false;

    const sourceRole = sagaRelationTypes[sourceId] || 'main';
    const targetRole = sagaRelationTypes[targetId] || 'main';
    if (sourceRole !== 'main' || targetRole !== 'main') return false;

    const yearOf = (id: string) => id === externalId ? entry?.release_year ?? null : sagaMeta[id]?.release_year ?? null;
    const sourceYear = yearOf(sourceId);
    const targetYear = yearOf(targetId);
    if (sourceYear == null || targetYear == null || sourceYear !== targetYear) return false;

    const sourceGroup = sagaGroups[sourceId]?.trim();
    const targetGroup = sagaGroups[targetId]?.trim();
    const members = new Set([sourceId, targetId]);
    if (sourceGroup) {
      sagaOrder.filter(id => sagaGroups[id]?.trim() === sourceGroup).forEach(id => members.add(id));
    }
    if (targetGroup) {
      sagaOrder.filter(id => sagaGroups[id]?.trim() === targetGroup).forEach(id => members.add(id));
    }
    return [...members].every(id => yearOf(id) != null && yearOf(id) === sourceYear);
  };

  const groupSagaItems = (fromIndex: number, toIndex: number) => {
    if (!canGroupSagaItems(fromIndex, toIndex)) return;
    const sourceId = sagaOrder[fromIndex];
    const targetId = sagaOrder[toIndex];
    const sourceGroup = sagaGroups[sourceId]?.trim();
    const targetGroup = sagaGroups[targetId]?.trim();
    const group = targetGroup || sourceGroup || `Alternative ${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${fromIndex}-${toIndex}`}`;
    const members = new Set([sourceId, targetId]);
    if (sourceGroup) {
      sagaOrder.filter(id => sagaGroups[id]?.trim() === sourceGroup).forEach(id => members.add(id));
    }
    if (targetGroup) {
      sagaOrder.filter(id => sagaGroups[id]?.trim() === targetGroup).forEach(id => members.add(id));
    }

    setSagaGroups(previous => {
      const next = { ...previous };
      members.forEach(id => { next[id] = group; });
      return next;
    });
    reorderSaga(fromIndex, toIndex);
  };

  const reorderRelations = (fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || fromIndex >= editableRelations.length || toIndex >= editableRelations.length) return;
    const next = [...editableRelations];
    const [moved] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, moved);
    setEditableRelations(next);
  };

  const {
    draggedIndex: draggedSagaIndex,
    dragHandlers: sagaDragHandlers,
    dwellTargetIndex: sagaGroupTargetIndex,
    dwellReady: sagaGroupDropReady,
  } = useDragReorder(reorderSaga, { onDwellDrop: groupSagaItems, canDwellOver: canGroupSagaItems, dwellMs: 1000 });
  const { draggedIndex: draggedRelationIndex, dragHandlers: relationDragHandlers } =
    useDragReorder(reorderRelations);

  // ── Bundled-in handlers ────────────────────────────────────────────────────

  const addBundledRelation = (result: ApiSearchResult) => {
    if (!bundledRelations.some(r => r.external_id === result.externalId)) {
      setBundledRelations([...bundledRelations, {
        external_id: result.externalId,
        title: result.titleMain,
        cover: result.coverUrl,
      }]);
    }
  };
  const removeBundledRelation = (id: string) =>
    setBundledRelations(prev => prev.filter(r => r.external_id !== id));
  const reorderBundled = (fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || fromIndex >= bundledRelations.length || toIndex >= bundledRelations.length) return;
    const next = [...bundledRelations];
    const [moved] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, moved);
    setBundledRelations(next);
  };

  // ── Contains handlers ──────────────────────────────────────────────────────

  const addContainedRelation = (result: ApiSearchResult) => {
    if (!containedRelations.some(r => r.external_id === result.externalId)) {
      setContainedRelations([...containedRelations, {
        external_id: result.externalId,
        title: result.titleMain,
        cover: result.coverUrl,
      }]);
    }
  };
  const removeContainedRelation = (id: string) =>
    setContainedRelations(prev => prev.filter(r => r.external_id !== id));
  const reorderContained = (fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || fromIndex >= containedRelations.length || toIndex >= containedRelations.length) return;
    const next = [...containedRelations];
    const [moved] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, moved);
    setContainedRelations(next);
  };

  const { draggedIndex: draggedBundledIndex, dragHandlers: bundledDragHandlers } =
    useDragReorder(reorderBundled);
  const { draggedIndex: draggedContainedIndex, dragHandlers: containedDragHandlers } =
    useDragReorder(reorderContained);

  // ── Referenced bundle's own Contains handlers ─────────────────────────────

  const addBundleChild = (result: ApiSearchResult) => {
    if (result.externalId === externalId) return; // already implied by the Bundled In relation itself
    if (!bundleChildren.some(r => r.external_id === result.externalId)) {
      setBundleChildren([...bundleChildren, {
        external_id: result.externalId,
        title: result.titleMain,
        cover: result.coverUrl,
      }]);
    }
  };
  const removeBundleChild = (id: string) =>
    setBundleChildren(prev => prev.filter(r => r.external_id !== id));
  const reorderBundleChildren = (fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || fromIndex >= bundleChildren.length || toIndex >= bundleChildren.length) return;
    const next = [...bundleChildren];
    const [moved] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, moved);
    setBundleChildren(next);
  };
  const { draggedIndex: draggedBundleChildIndex, dragHandlers: bundleChildDragHandlers } =
    useDragReorder(reorderBundleChildren);

  // ── Editable relation handlers ────────────────────────────────────────────

  const recommendationLabel = tm.relations.RECOMMENDATION;
  const toRecommendationRelation = (recommendation: BundledRelation): EditableRelation => ({
    related_media_external_id: recommendation.external_id,
    relation_type: 'RECOMMENDATION',
    type_label: recommendationLabel,
    title: recommendation.title,
    cover: recommendation.cover,
  });

  const addEditableRelation = (result: ApiSearchResult) => {
    if (!editableRelations.some(r => r.related_media_external_id === result.externalId)
      && !recommendations.some(r => r.external_id === result.externalId)) {
      // Type is picked afterward on the card's own select (same one shown
      // for pre-existing relations), not before adding — a default here is
      // just the starting point.
      setEditableRelations([...editableRelations, {
        related_media_external_id: result.externalId,
        relation_type: DEFAULT_NEW_RELATION_TYPE,
        type_label: canonicalRelationLabels[DEFAULT_NEW_RELATION_TYPE] || DEFAULT_NEW_RELATION_TYPE,
        title: result.titleMain,
        cover: result.coverUrl,
      }]);
    }
  };
  const updateEditableRelationType = (id: string, relationType: string) =>
    setEditableRelations(prev => prev.map(r => r.related_media_external_id === id
      ? { ...r, relation_type: relationType, type_label: canonicalRelationLabels[relationType] || relationType }
      : r));
  const removeEditableRelation = (id: string) =>
    setEditableRelations(prev => prev.filter(r => r.related_media_external_id !== id));
  const addRecommendation = (result: ApiSearchResult) => {
    if (!recommendations.some(r => r.external_id === result.externalId)
      && !editableRelations.some(r => r.related_media_external_id === result.externalId)) {
      setRecommendations(prev => [...prev, {
        external_id: result.externalId,
        title: result.titleMain,
        cover: result.coverUrl,
      }]);
    }
  };
  const removeRecommendation = (id: string) =>
    setRecommendations(prev => prev.filter(r => r.external_id !== id));
  const reorderRecommendations = (fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || fromIndex >= recommendations.length || toIndex >= recommendations.length) return;
    const next = [...recommendations];
    const [moved] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, moved);
    setRecommendations(next);
  };
  const { draggedIndex: draggedRecommendationIndex, dragHandlers: recommendationDragHandlers } =
    useDragReorder(reorderRecommendations);

  // ── Issue (ComicVine) relation handlers ───────────────────────────────────

  const removeIssueRelation = (id: string) =>
    setIssueRelations(prev => prev.filter(r => r.external_id !== id));
  const reorderIssueRelations = (fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || fromIndex >= issueRelations.length || toIndex >= issueRelations.length) return;
    const next = [...issueRelations];
    const [moved] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, moved);
    setIssueRelations(next);
  };
  const { draggedIndex: draggedIssueIndex, dragHandlers: issueDragHandlers } =
    useDragReorder(reorderIssueRelations);

  const handleChange = (field: keyof MediaCatalogEntry, value: string | number | null) => {
    if (!entry) return;
    setEntry({ ...entry, [field]: value === '' ? null : value });
  };

  const setProviderSource = async (kind: MediaSourceMappingKind, result: ApiSearchResult) => {
    if (!entry) return;
    const id = result.externalId.split(':').pop() || '';
    setEntry({
      ...entry,
      [kind === 'episodes' ? 'episode_source_id' : 'issue_source_id']: id || null,
    });

    if (kind !== 'issues' || !id) return;

    const volumeId = Number(id);
    if (!Number.isInteger(volumeId) || volumeId <= 0) return;

    const requestId = ++issuePreviewRequest.current;
    setIsLoadingIssuePreview(true);
    setIssuePreviewError(null);
    try {
      const issues = await comicVineGetIssues(volumeId);
      if (requestId !== issuePreviewRequest.current) return;
      const baseType = entry.external_id.split(':')[0];
      const mappedIssues = issues.flatMap(issue => {
        const cover = issue.image?.medium_url || issue.image?.small_url;
        if (!cover) return [];
        const number = issue.issue_number ? `#${issue.issue_number}` : '';
        const name = issue.name ? ` - ${issue.name}` : '';
        return [{
          external_id: `${baseType}:issue-${issue.id}`,
          title: number + name || `#${issue.id}`,
          cover,
        }];
      });
      setIssueRelations(mappedIssues);
    } catch (error) {
      if (requestId !== issuePreviewRequest.current) return;
      console.error('Failed to preview ComicVine issues', error);
      setIssuePreviewError('No se pudieron cargar las issues del volumen seleccionado.');
    } finally {
      if (requestId === issuePreviewRequest.current) setIsLoadingIssuePreview(false);
    }
  };

  const resetIssueSource = () => {
    issuePreviewRequest.current += 1;
    setIsLoadingIssuePreview(false);
    setIssuePreviewError(null);
    handleChange('issue_source_id', null);
    setIssueRelations(originalIssueRelations);
  };

  const [isResyncing, setIsResyncing] = useState(false);

  const handleResync = async () => {
    if (!externalId || isResyncing) return;
    setIsResyncing(true);
    setStatusMsg('Descargando datos oficiales...');

    try {
      invalidateCachedMediaData(externalId);
      const liveData = await fetchMediaDataInternal(externalId, true);

      if (!liveData) {
        setStatusMsg('No se encontraron datos en la API');
        setTimeout(() => setStatusMsg(''), 3000);
        setIsResyncing(false);
        return;
      }

      const partialFromLive = mapMediaDataToCatalogEntry(liveData, externalId);

      setEntry(prev => prev ? mergeResyncFields(prev, partialFromLive) : prev);

      const newCharacters = buildResyncCharacters(liveData, characters.length > 0);
      if (newCharacters) setCharacters(newCharacters);

      setEditableRelations(prev => appendResyncRelations(prev, liveData, externalId));
      setRecommendations(prev => appendResyncRecommendations(prev, liveData));

      setStatusMsg('Datos oficiales descargados para campos vacíos');
      setTimeout(() => setStatusMsg(''), 3500);
    } catch (err) {
      console.error('Error durante resync:', err);
      setStatusMsg('Error al descargar datos');
      setTimeout(() => setStatusMsg(''), 3000);
    } finally {
      setIsResyncing(false);
    }
  };

  // ── Change detection (shared by hasChanges + the PR change summary) ───────

  const isFieldChanged = (field: keyof MediaCatalogEntry) =>
    !!originalEntry && normField(entry?.[field]) !== normField(originalEntry[field]);

  const getDiff = () => {
    const originalSagaIds = new Set(originalSagaOrder);
    return {
      addedBundled: bundledRelations.filter(r => !originalBundledIds.has(r.external_id)),
      removedBundledIds: [...originalBundledIds].filter(id => !bundledRelations.some(r => r.external_id === id)),
      addedContained: containedRelations.filter(r => !originalContainedIds.has(r.external_id)),
      removedContainedIds: [...originalContainedIds].filter(id => !containedRelations.some(r => r.external_id === id)),
      addedBundleChildren: bundleChildren.filter(r => !originalBundleChildIds.has(r.external_id)),
      removedBundleChildIds: [...originalBundleChildIds].filter(id => !bundleChildren.some(r => r.external_id === id)),
      addedEditableRelations: [
        ...editableRelations.filter(r => !originalEditableRelationTypes.has(r.related_media_external_id)),
        ...recommendations.filter(r => !originalRecommendationIds.has(r.external_id)).map(toRecommendationRelation),
      ],
      removedEditableRelationIds: [
        ...[...originalEditableRelationTypes.keys()].filter(id => !editableRelations.some(r => r.related_media_external_id === id)),
        ...[...originalRecommendationIds].filter(id => !recommendations.some(r => r.external_id === id)),
      ],
      changedEditableRelations: editableRelations.filter(r => {
        const originalType = originalEditableRelationTypes.get(r.related_media_external_id);
        return originalType !== undefined && originalType !== r.relation_type;
      }),
      addedIssues: issueRelations.filter(r => !originalIssueIds.has(r.external_id)),
      removedIssueIds: [...originalIssueIds].filter(id => !issueRelations.some(r => r.external_id === id)),
      addedSaga: sagaOrder.filter(id => id !== externalId && !originalSagaIds.has(id)),
      removedSaga: originalSagaOrder.filter(id => id !== externalId && !sagaOrder.includes(id)),
      sagaOrderChanged: sagaOrder.join(',') !== originalSagaOrder.join(','),
      relTypesChanged: recordsDiffer(sagaRelationTypes, originalSagaRelationTypes, v => v || 'main'),
      groupsChanged: recordsDiffer(sagaGroups, originalSagaGroups, v => (v || '').trim()),
      sagaNameChanged: sagaName !== originalSagaName,
      // Only used for the GitHub upload merge (submitCollaborativeProposal's
      // mergeListByKey) — tells "removed this session" apart from "never
      // loaded it" so an upstream row someone else added isn't clobbered.
      removedCharacterIds: originalCharacters
        .filter(c => !characters.some(cur => cur.external_id === c.external_id))
        .map(c => c.external_id),
      removedAuthorIds: originalMediaAuthors
        .filter(a => !mediaAuthors.some(cur => cur.external_id === a.external_id))
        .map(a => a.external_id),
    };
  };

  const hasChanges = () => {
    if (!entry || !originalEntry) return false;
    // Not in DIFF_FIELDS — it's a curator flag toggled by its own dedicated
    // "Eliminar de Metadea" button, not a regular diffable field with a
    // label, but flipping it is still a real change that must enable Submit.
    if (entry.blocked_at !== originalEntry.blocked_at) return true;
    if (DIFF_FIELDS.some(([field]) => isFieldChanged(field))) return true;
    if (charactersChanged()) return true;
    const d = getDiff();
    return d.addedBundled.length > 0 || d.removedBundledIds.length > 0
      || d.addedContained.length > 0 || d.removedContainedIds.length > 0
      || d.addedBundleChildren.length > 0 || d.removedBundleChildIds.length > 0
      || d.addedEditableRelations.length > 0 || d.removedEditableRelationIds.length > 0 || d.changedEditableRelations.length > 0
      || d.addedIssues.length > 0 || d.removedIssueIds.length > 0
      || d.addedSaga.length > 0 || d.removedSaga.length > 0
      || d.sagaOrderChanged || d.relTypesChanged || d.groupsChanged || d.sagaNameChanged;
  };

  const buildChangeSummary = (resolveMeta: (id: string) => MediaMeta): string => {
    if (!entry) return '';
    return buildPrEditorChangeSummary({
      entry,
      originalEntry,
      isFieldChanged,
      diff: getDiff(),
      resolveMeta,
      originalEditableRelationTypes,
      sagaOrder,
      sagaRelationTypes,
      sagaName,
      originalSagaName,
      charactersChanged: charactersChanged(),
      charactersCount: characters.length,
      mediaAuthorsCount: mediaAuthors.length,
    });
  };

  const handleSubmit = async (prepareOnly = false): Promise<PreparedMediaProposal | null> => {
    if (!entry || isLoadingIssuePreview || issuePreviewError || (prepareOnly && !hasChanges())) return null;
    setSubmitting(true);
    setErrorMsg('');

    try {
      const resolveMeta = createMetaResolver(externalId, { title: entry.title_main || externalId, cover: entry.cover_url || null, release_year: entry.release_year ?? null }, sagaMeta);
      const sagaChangeDiff = getDiff();
      const sagaChanged = !!entry.blocked_at || sagaChangeDiff.sagaOrderChanged || sagaChangeDiff.relTypesChanged
        || sagaChangeDiff.groupsChanged || sagaChangeDiff.addedSaga.length > 0 || sagaChangeDiff.removedSaga.length > 0;
      const editedFields = DIFF_FIELDS.filter(([field]) => isFieldChanged(field)).map(([field]) => field);
      // Union of every relation-editing UI's own removals — media_relations
      // has no per-category split once saved (see mergeListByKey), so the
      // GitHub merge just needs "which related_media_external_id ids did
      // this session actually remove", regardless of which list they came from.
      const removedRelationIds = [
        ...sagaChangeDiff.removedBundledIds,
        ...sagaChangeDiff.removedContainedIds,
        ...sagaChangeDiff.removedEditableRelationIds,
        ...sagaChangeDiff.removedIssueIds,
      ];

      const changeSummary = buildChangeSummary(resolveMeta);
      const preparedEntries = await submitPrEditorChanges({
        entry,
        externalId,
        mode,
        sagaOrder,
        originalSagaOrder,
        sagaRelationTypes,
        sagaGroups,
        sagaName,
        sagaMeta,
        bundledRelations,
        originalBundledIds,
        containedRelations,
        originalContainedIds,
        bundleId: bundledRelations[0]?.external_id,
        bundleChildren,
        originalBundleChildIds,
        editableRelations: [...editableRelations, ...recommendations.map(toRecommendationRelation)],
        issueRelations,
        characters,
        charactersChanged: charactersChanged(),
        mediaAuthors,
        sagaChanged,
        editedFields,
        removedRelationIds,
        removedCharacterIds: sagaChangeDiff.removedCharacterIds,
        removedAuthorIds: sagaChangeDiff.removedAuthorIds,
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
      setErrorMsg(err instanceof Error ? err.message : 'Error communicating with GitHub API');
    } finally {
      setSubmitting(false);
    }
    return null;
  };

  const affectedExternalIds = () => {
    const diff = getDiff();
    return [...new Set([
      ...diff.addedBundled.map(item => item.external_id), ...diff.removedBundledIds,
      ...diff.addedContained.map(item => item.external_id), ...diff.removedContainedIds,
      ...diff.addedBundleChildren.map(item => item.external_id), ...diff.removedBundleChildIds,
      ...diff.addedEditableRelations.map(item => item.related_media_external_id), ...diff.removedEditableRelationIds,
      ...diff.changedEditableRelations.map(item => item.related_media_external_id),
      ...diff.addedIssues.map(item => item.external_id), ...diff.removedIssueIds,
      ...diff.addedSaga, ...diff.removedSaga,
      ...(diff.sagaOrderChanged ? sagaOrder.filter(id => id !== externalId) : []),
    ])];
  };

  useEffect(() => {
    onSessionDirtyChange?.(externalId, hasChanges());
  });

  useEffect(() => {
    if (entry) onSessionTitleChange?.(externalId, entry.title_main || externalId);
  }, [entry?.title_main, externalId, onSessionTitleChange]);

  useEffect(() => {
    onSessionSagaOrderChange?.(externalId, sagaOrder);
  }, [externalId, onSessionSagaOrderChange, sagaOrder]);

  const renderSessionLayout = (panel: React.ReactNode) => {
    const activeIndex = sessionTabs.findIndex(tab => tab.kind !== 'character' && tab.externalId === externalId);
    const navigate = (index: number) => {
      const targetIndex = (index + sessionTabs.length) % sessionTabs.length;
      const target = sessionTabs[targetIndex];
      if (target && !(target.kind !== 'character' && target.externalId === externalId)) {
        if (onNavigateSessionTab) onNavigateSessionTab(target);
        else onNavigateSessionEntry?.(target.externalId);
      }
    };
    return (
      <div className={`pr-editor-session-layout${sessionMode ? ' pr-editor-session-layout--active' : ''}`} onClick={event => event.stopPropagation()}>
        {sessionMode && (
          <nav className="pr-editor-session-tabs" aria-label="Obras en edición">
            {sessionTabs.map((tab, index) => (
              <button
                key={`${tab.kind ?? 'media'}:${tab.externalId}`}
                type="button"
                className={`pr-editor-session-tab${tab.kind !== 'character' && tab.externalId === externalId ? ' pr-editor-session-tab--active' : ''}${tab.affected ? ' pr-editor-session-tab--affected' : ''}`}
                aria-current={tab.kind !== 'character' && tab.externalId === externalId ? 'page' : undefined}
                title={`${tab.kind === 'character' ? 'Personaje: ' : 'Obra: '}${tab.label}${tab.dirty ? ' · Cambios sin guardar' : ''}${tab.affected ? ' · Cambio relacionado' : ''}`}
                  onClick={() => navigate(index)}
                onContextMenu={event => {
                  event.preventDefault();
                  setSessionTabContextMenu({ externalId: tab.externalId, kind: tab.kind, x: event.clientX, y: event.clientY });
                }}
              >
                <span className="pr-editor-session-tab-label">{tab.label}</span>
                {tab.dirty && <span className="pr-editor-session-tab-dirty" aria-label="Cambios sin guardar" />}
                {tab.affected && <span className="pr-editor-session-tab-affected" aria-label="Cambio relacionado">↗</span>}
              </button>
            ))}
          </nav>
        )}
        <div className="pr-editor-session-panel-row">
          {sessionMode && (
            <button type="button" className="pr-editor-session-arrow" aria-label="Obra anterior" title="Obra anterior" disabled={sessionTabs.length <= 1} onClick={() => navigate(activeIndex - 1)}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6" /></svg>
            </button>
          )}
          {panel}
          {sessionMode && (
            <button type="button" className="pr-editor-session-arrow" aria-label="Obra siguiente" title="Obra siguiente" disabled={sessionTabs.length <= 1} onClick={() => navigate(activeIndex + 1)}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6" /></svg>
            </button>
          )}
        </div>
      </div>
    );
  };

  useEffect(() => {
    if (!sessionTabContextMenu) return;
    const close = () => setSessionTabContextMenu(null);
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') close(); };
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [sessionTabContextMenu]);

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
    if (sessionMode) onDiscardSession?.();
    else onClose();
  };

  const sessionHandleRef = useRef<PrEditorSessionHandle | null>(null);
  sessionHandleRef.current = {
    hasChanges,
    affectedExternalIds,
    prepareProposal: () => handleSubmit(true),
  };
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

  if (githubGate === 'checking') {
    return createPortal(
      <div className="pr-editor-overlay" style={sessionActive ? undefined : { display: 'none' }}>
        {renderSessionLayout(<div className="pr-editor-modal pr-editor-modal--loading">
          <div className="spinner" />
        </div>)}
        <PrEditorChangelogPanel externalId={externalId} />
      </div>,
      document.body,
    );
  }

  if (githubGate === 'signed-out') {
    return createPortal(
      <div className="pr-editor-overlay" onClick={requestClose} style={sessionActive ? undefined : { display: 'none' }}>
        {renderSessionLayout(<div className="pr-editor-modal pr-editor-modal--narrow">
          <div className="pr-editor-body pr-editor-login-required">
            <p className="pr-editor-title">{pe.login_required_title}</p>
            <p className="pr-editor-subtitle">
              Cualquier edición aquí se propone como una Pull Request al catálogo comunitario —
              inicia sesión con GitHub en Settings antes de continuar.
            </p>
            <div className="pr-editor-login-actions">
              <button type="button" className="pr-editor-btn pr-editor-btn--cancel" onClick={requestClose}>{pe.close}</button>
              <button type="button" className="pr-editor-btn pr-editor-btn--submit" onClick={() => { window.location.href = '/settings'; }}>
                Ir a Settings
              </button>
            </div>
          </div>
        </div>)}
      </div>,
      document.body,
    );
  }

  if (loading) {
    return createPortal(
      <div className="pr-editor-overlay" style={sessionActive ? undefined : { display: 'none' }}>
        {renderSessionLayout(<div className="pr-editor-modal pr-editor-modal--loading">
          <div className="spinner" />
        </div>)}
        <PrEditorChangelogPanel externalId={externalId} />
      </div>,
      document.body,
    );
  }

  if (!entry) return null;

  // ── Render helpers (close over entry/handleChange/isFieldChanged) ─────────

  const isLocalOnly = (field: keyof MediaCatalogEntry) => nonGithubFields?.has(field) ?? false;

  const textField = (field: keyof MediaCatalogEntry, label: string) => (
    <Field label={label} changed={isFieldChanged(field)} dim={isLocalOnly(field)}>
      <input type="text" value={(entry[field] as string) || ''} onChange={e => handleChange(field, e.target.value)} />
    </Field>
  );

  const numberField = (field: keyof MediaCatalogEntry, label: string, disabled = false) => (
    <Field label={label} changed={isFieldChanged(field)} small dim={isLocalOnly(field)}>
      <input type="number" value={(entry[field] as number) ?? ''} disabled={disabled}
        onChange={e => handleChange(field, e.target.value ? parseInt(e.target.value, 10) : null)} />
    </Field>
  );

  const releaseDateField = (field: 'release_year' | 'release_month' | 'release_day', label: string) => {
    const daysInMonth = (month: number | null, year: number | null) =>
      month ? new Date(year ?? 2000, month, 0).getDate() : 31;
    const max = field === 'release_year' ? 9999
      : field === 'release_month' ? 12
        : daysInMonth(entry.release_month ?? null, entry.release_year ?? null);
    const min = field === 'release_year' ? 1 : 1;

    return (
      <Field label={label} changed={isFieldChanged(field)} small dim={isLocalOnly(field)}>
        <input
          type="number"
          min={min}
          max={max}
          step={1}
          value={entry[field] ?? ''}
          onChange={event => {
            const rawValue = event.target.value;
            const parsed = rawValue === '' ? null : Number.parseInt(rawValue, 10);
            const value = parsed == null || !Number.isFinite(parsed)
              ? null
              : Math.max(min, Math.min(max, parsed));
            const next = { ...entry, [field]: value };
            if (field === 'release_month' || field === 'release_year') {
              const nextMonth = field === 'release_month' ? value : entry.release_month ?? null;
              const nextYear = field === 'release_year' ? value : entry.release_year ?? null;
              const maxDay = daysInMonth(nextMonth, nextYear);
              if (next.release_day != null && next.release_day > maxDay) next.release_day = maxDay;
            }
            setEntry(next);
          }}
        />
      </Field>
    );
  };

  const primaryCountLabel = ({
    anime: 'Nº of episodes',
    series: 'Nº of episodes',
    movie: 'Nº of episodes',
    manga: 'Nº of chapters',
    comic: 'Nº of chapters',
    lnovel: 'Nº of chapters',
    book: 'Pages',
  } as Record<string, string>)[entry.type] ?? 'Total count';
  const secondaryCountLabel = ({
    anime: 'Nº of seasons',
    series: 'Nº of seasons',
    manga: 'Nº of volumes',
    lnovel: 'Nº of volumes',
    comic: 'Nº of volumes',
  } as Record<string, string>)[entry.type] ?? 'Secondary count';

  // Options come straight from the i18n formats dictionary (media.formats) —
  // it already carries every format key both AniList (TV/MOVIE/OVA/...) and
  // IGDB (GAME/REMAKE/REMASTER/.../VISUAL_NOVEL) mappers can produce, so this
  // never drifts out of sync with what a live fetch would set automatically.
  const mediaTypesDict = (getT().search?.types ?? {
    anime: 'Anime',
    manga: 'Manga',
    lnovel: 'Novela Ligera',
    game: 'Videojuego',
    vnovel: 'Novela Visual',
    movie: 'Película',
    series: 'Serie',
    book: 'Libro',
    comic: 'Cómic',
  }) as Record<string, string>;

  const typeField = (field: keyof MediaCatalogEntry, label: string, inline = false) => {
    const currentType = entry[field] as string;
    const isGameOrVn = currentType === 'game' || currentType === 'vnovel';

    if (!isGameOrVn) {
      return (
        <Field label={label} changed={isFieldChanged(field)} dim={isLocalOnly(field)} inline={inline}>
          <input type="text" value={mediaTypesDict[currentType] || currentType || ''} disabled className="pr-editor-readonly-input" />
        </Field>
      );
    }

    return (
      <Field label={label} changed={isFieldChanged(field)} dim={isLocalOnly(field)} inline={inline}>
        <select value={currentType || ''} onChange={e => handleChange(field, e.target.value || null)}>
          <option value="game">{mediaTypesDict.game || 'Videojuego'}</option>
          <option value="vnovel">{mediaTypesDict.vnovel || 'Novela Visual'}</option>
        </select>
      </Field>
    );
  };

  const formatField = (field: keyof MediaCatalogEntry, label: string, inline = false) => (
    <Field label={label} changed={isFieldChanged(field)} dim={isLocalOnly(field)} inline={inline}>
      <select value={(entry[field] as string) || ''} onChange={e => handleChange(field, e.target.value || null)}>
        <option value="">—</option>
        {Object.keys(tm.formats)
          .sort((a, b) => tm.formats[a as keyof typeof tm.formats].localeCompare(tm.formats[b as keyof typeof tm.formats]))
          .map(key => (
            <option key={key} value={key}>{tm.formats[key as keyof typeof tm.formats]}</option>
          ))}
      </select>
    </Field>
  );

  const slotField = (field: keyof MediaCatalogEntry, label: string, opts?: {
    allowed?: string[]; restrict?: boolean; preview?: boolean; fullWidth?: boolean; dotClass?: string;
    transformNewItem?: (raw: string) => string;
  }) => (
    <div className={`pr-editor-field-wrap${isLocalOnly(field) ? ' pr-editor-field--dim' : ''}`}>
      <SlotInput label={label} value={entry[field] as string | undefined} onChange={v => handleChange(field, v)}
        allowedSuggestions={opts?.allowed} restrictToSuggestions={opts?.restrict}
        preview={opts?.preview} fullWidth={opts?.fullWidth} transformNewItem={opts?.transformNewItem} />
      <ChangedDot show={isFieldChanged(field)}
        className={`pr-editor-changed-dot ${opts?.dotClass ?? 'pr-editor-changed-dot--slot'}`} />
    </div>
  );

  // Same domain-sniffing build_store_links (igdb.rs) already uses for a live
  // IGDB fetch's own store_links — mirrored here so a pasted bare URL
  // auto-gets its "platform|" prefix instead of the user having to type it.
  // Left as-is (no prefix added) when nothing matches, or when the user
  // already typed "platform|url" themselves.
  const detectShopLinkPlatform = (raw: string): string => {
    if (raw.includes('|')) return raw;
    const url = raw.toLowerCase();
    const platform = url.includes('store.steampowered.com') ? 'steam'
      : url.includes('gog.com') ? 'gog'
      : url.includes('epicgames.com') ? 'epic'
      : (url.includes('xbox.com') || url.includes('microsoft.com/store')) ? 'xbox'
      : url.includes('playstation.com') ? 'playstation'
      : null;
    return platform ? `${platform}|${raw}` : raw;
  };

  const sectionTitle = (title: string, fields: Array<keyof MediaCatalogEntry>) => (
    <span className="pr-editor-section-title">
      {title}
      {fields.some(isFieldChanged) && <span className="pr-editor-section-changed-dot" />}
    </span>
  );

  const resolveMeta = createMetaResolver(externalId, { title: entry.title_main ?? null, cover: entry.cover_url ?? null, release_year: entry.release_year ?? null }, sagaMeta);

  return createPortal(
    <div className="pr-editor-overlay" onClick={requestClose} style={sessionActive ? undefined : { display: 'none' }}>
      {renderSessionLayout(<div className="pr-editor-modal pr-editor-modal--narrow">
        <PrEditorHeader
          title={<>Entrada de <strong>{entry.title_main || externalId}</strong>{sessionAffected && <span className="pr-editor-session-affected" title="Este borrador se ve afectado por cambios relacionados"> · Cambio relacionado</span>}</>}
          subtitle={`ID: ${externalId}`}
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
              className="pr-editor-block-btn pr-editor-block-btn--icon pr-editor-header-action pr-editor-header-action--icon"
              title={pe.resync_tooltip}
              aria-label={pe.resync_tooltip}
              aria-busy={isResyncing}
              disabled={isResyncing}
              onClick={handleResync}
            >
              <RefreshCw size={16} aria-hidden="true" className={isResyncing ? 'pr-editor-spin' : undefined} />
            </button>
            <button
              type="button"
              className={`pr-editor-block-btn pr-editor-block-btn--icon pr-editor-header-action pr-editor-header-action--icon${entry.blocked_at ? ' pr-editor-block-btn--active' : ''}`}
              aria-pressed={!!entry.blocked_at}
              title={pe.block_tooltip}
              aria-label={pe.block_tooltip}
              onClick={() => handleChange('blocked_at', entry.blocked_at ? null : new Date().toISOString())}
            >
              <Trash2 size={16} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="pr-editor-btn pr-editor-btn--cancel pr-editor-header-action pr-editor-header-action--icon pr-editor-header-cancel"
              onClick={requestClose}
              disabled={submitting}
              title="Cancelar"
              aria-label="Cancelar"
            >
              <X size={17} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="pr-editor-btn pr-editor-btn--submit pr-editor-header-action"
              onClick={() => sessionMode ? onSubmitProposalSession?.() : void handleSubmit()}
              disabled={submitting || isLoadingIssuePreview || !!issuePreviewError || !(sessionMode ? sessionHasChanges : hasChanges())}
            >
              {submitting ? 'Submitting...' : 'Submit Proposal'}
            </button>
          </>
          }
        />

        <div className="pr-editor-content-shell">
          <nav className="pr-editor-sidebar" aria-label="Secciones del editor">
            <button
              type="button"
              className={`pr-editor-tab-btn${activeTab === 'general' ? ' active' : ''}`}
              onClick={() => setActiveTab('general')}
              title="General"
              aria-label="General"
              aria-current={activeTab === 'general' ? 'page' : undefined}
            >
              <Settings size={18} aria-hidden="true" />
            </button>
            <button
              type="button"
              className={`pr-editor-tab-btn${activeTab === 'cast' ? ' active' : ''}`}
              onClick={() => setActiveTab('cast')}
              title="Personajes"
              aria-label="Personajes"
              aria-current={activeTab === 'cast' ? 'page' : undefined}
            >
              <Users size={18} aria-hidden="true" />
              {charactersChanged() && <span className="pr-editor-tab-changed-dot" />}
            </button>
            <div className="pr-editor-sidebar-divider" />
            {relationsSubtabs.map(tab => {
              const Icon = RELATIONS_SUBTAB_ICONS[tab.id];
              const isActive = activeTab === 'relations' && relationsSubtab === tab.id;
              return (
                <React.Fragment key={tab.id}>
                  {tab.id === 'episodes' && <div className="pr-editor-sidebar-divider" />}
                  <button
                    type="button"
                    className={`pr-editor-tab-btn${isActive ? ' active' : ''}`}
                    onClick={() => { setActiveTab('relations'); setRelationsSubtab(tab.id); }}
                    title={tab.label}
                    aria-label={tab.label}
                    aria-current={isActive ? 'page' : undefined}
                  >
                    <Icon size={18} aria-hidden="true" />
                  </button>
                </React.Fragment>
              );
            })}
          </nav>

          <div className="pr-editor-main">
          <div className={`pr-editor-body${activeTab === 'cast' ? ' pr-editor-body--cast' : ''}`}>
          {errorMsg && <div className="pr-editor-alert pr-editor-alert--error pr-editor-field--full">{errorMsg}</div>}

          {activeTab === 'general' && (
            <div className="pr-editor-body--grid pr-editor-body--grid-2col">
              <div className="pr-editor-col pr-editor-col--left">
                <div className="pr-editor-section">
                  <div className="pr-editor-labeled-row">
                    <span className="pr-editor-vertical-label">Titles</span>
                    <div className="pr-editor-labeled-content">
                      <div className="pr-editor-form-grid">
                        {textField('title_main', 'Main Title')}
                        {textField('title_romaji', 'Romaji Title')}
                        {textField('title_native', 'Native Title')}
                      </div>
                    </div>
                  </div>
                  <div className="pr-editor-labeled-row">
                    <span className="pr-editor-vertical-label">
                      Synopsis
                      <ChangedDot show={isFieldChanged('synopsis')} className="pr-editor-section-changed-dot" />
                    </span>
                    <div className="pr-editor-labeled-content">
                      <div className={`pr-editor-field${isLocalOnly('synopsis') ? ' pr-editor-field--dim' : ''}`}>
                        <RichTextEditor
                          value={entry.synopsis || ''}
                          onChange={html => handleChange('synopsis', html)}
                          placeholder={tPr.synopsis_ph}
                        />
                      </div>
                    </div>
                  </div>
                </div>

                <div className="pr-editor-section pr-editor-section--release-progress">
                  <div className="pr-editor-field-row pr-editor-field-row--release-progress">
                    <div className="pr-editor-subgroup pr-editor-subgroup--vertical-label">
                      <span className="pr-editor-vertical-label">Release</span>
                      <div className="pr-editor-subgroup-fields">
                        {releaseDateField('release_year', 'Year')}
                        {releaseDateField('release_month', 'Month')}
                        {releaseDateField('release_day', 'Day')}
                      </div>
                    </div>

                    <div className="pr-editor-subgroup-divider" />

                    <div className="pr-editor-subgroup pr-editor-subgroup--vertical-label">
                      <span className="pr-editor-vertical-label">Progress</span>
                      <div className="pr-editor-subgroup-fields">
                        {numberField('total_count', primaryCountLabel, entry.type === 'movie')}
                        {numberField('total_count_2', secondaryCountLabel)}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="pr-editor-section pr-editor-section--shop-links">
                  <div className="pr-editor-labeled-row pr-editor-shop-links-row">
                    <span className="pr-editor-vertical-label">Shop Links</span>
                    <div className="pr-editor-shop-links-content">
                      {/* One slot per "platform|url" pair (steam|https://...,
                          gog|https://...) - the exact format
                          usePendingLaunchers/build_store_links already parse
                          this CSV into, so a game missing its own storefront
                          links (a common gap for anything the user never opened
                          /media on, see that hook's own comment) can get them
                          added here manually instead of only ever being backfilled
                          by a live IGDB fetch. */}
                      {slotField('shop_links_csv', 'platform|url pairs', { fullWidth: true, transformNewItem: detectShopLinkPlatform })}
                    </div>
                  </div>
                </div>
              </div>

              <div className="pr-editor-col pr-editor-col--right">
                <div className="pr-editor-section">
                  <div className="pr-editor-assets-box">
                    <div className="pr-editor-labeled-row pr-editor-asset-row">
                      <span className="pr-editor-vertical-label">
                        Cover URL
                        <ChangedDot show={isFieldChanged('cover_url')} />
                      </span>
                      <div className={`pr-editor-cover-section${isLocalOnly('cover_url') ? ' pr-editor-field--dim' : ''}`}>
                        <div className="pr-editor-cover-uploader">
                          <div className="pr-editor-cover-preview-card">
                            {entry.cover_url ? (
                              <img className="cover-image-fill" src={entry.cover_url} alt="" />
                            ) : (
                              <span className="pr-editor-cover-placeholder">{pe.no_cover}</span>
                            )}
                          </div>
                          <input
                            type="text"
                            placeholder={pe.cover_url_placeholder}
                            value={entry.cover_url || ''}
                            onChange={e => handleChange('cover_url', e.target.value)}
                          />
                        </div>
                      </div>
                    </div>

                    <div className="pr-editor-labeled-row pr-editor-asset-row">
                      <span className="pr-editor-vertical-label">Banner URLs</span>
                      <div className="pr-editor-banner-section">
                        {slotField('banners_csv', 'Banner URLs', { preview: true, fullWidth: true, dotClass: 'pr-editor-changed-dot--banner' })}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="pr-editor-section pr-editor-section--classification">
                  <div className="pr-editor-labeled-row">
                    <span className="pr-editor-vertical-label">Classification</span>
                    <div className="pr-editor-labeled-content">
                      <div className="pr-editor-classification-grid">
                        {typeField('type', 'Type', true)}
                        {formatField('format', 'Format', true)}
                        {slotField('genres_csv', 'Genres', { allowed: ALL_GENRES, restrict: true })}
                        {slotField('genres_tag_csv', 'Themes / Tags')}
                        {entry.type === 'game' && slotField('platforms_csv', 'Platforms', { allowed: ALL_PLATFORMS, restrict: true })}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'cast' && (
            <PrEditorCharactersSection
              t={t}
              characters={characters}
              onRemove={removeCharacter}
              onOpenCharacterEditor={(id, title) => {
                if (onEditCharacter) onEditCharacter(id, undefined, title);
                else (window as any).openCharacterEditor?.(id);
              }}
              onOpenSearch={role => {
                setCastSearchRole(role);
                setSelectedCastCharacters([]);
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
                if (onEditCharacter) onEditCharacter(characterId, initialAppearance, 'Nuevo personaje');
                else (window as any).openCharacterEditor?.(characterId, initialAppearance);
              }}
            />
          )}

          {activeTab === 'relations' && (
            <div className="pr-editor-relations-content">
              <div className="pr-editor-relations-grid">
              {relationsSubtab === 'saga' && (
              <div className="pr-editor-section">
                <PrEditorSagaOrderSection
                  externalId={externalId}
                  sagaOrder={sagaOrder}
                  sagaGroups={sagaGroups}
                  draggedIndex={draggedSagaIndex}
                  dragHandlers={sagaDragHandlers}
                  groupTargetIndex={sagaGroupTargetIndex}
                  groupDropReady={sagaGroupDropReady}
                  onRemove={removeFromSaga}
                  onUngroup={ungroupSagaItems}
                  onEditWork={onEditSagaEntry}
                  resolveMeta={resolveMeta}
                />
                <div className="pr-editor-saga-name-row">
                  <label htmlFor="pr-editor-saga-name">Saga name:</label>
                  <input
                    id="pr-editor-saga-name"
                    type="text"
                    placeholder={pe.saga_name_placeholder}
                    value={sagaName}
                    onChange={e => setSagaName(e.target.value)}
                    className="pr-editor-media-card-group-input pr-editor-saga-name-input"
                  />
                  <PrEditorAddButton onClick={() => setSearchPopupMode('saga')} />
                </div>
              </div>
              )}

              {relationsSubtab === 'relations' && <div className="pr-editor-section">
                <PrEditorRelationsSection
                  editableRelations={editableRelations}
                  relationOptions={EDITABLE_RELATION_OPTIONS}
                  relationLabels={canonicalRelationLabels}
                  draggedIndex={draggedRelationIndex}
                  dragHandlers={relationDragHandlers}
                  onRemove={removeEditableRelation}
                  onUpdateType={updateEditableRelationType}
                  onAdd={() => setSearchPopupMode('relations')}
                  onEditWork={onEditSagaEntry}
                />
              </div>}

              {relationsSubtab === 'recommendations' && <div className="pr-editor-section">
                <PrEditorRelationCardList
                  relations={recommendations}
                  draggedIndex={draggedRecommendationIndex}
                  dragHandlers={recommendationDragHandlers}
                  onRemove={removeRecommendation}
                  onAdd={() => setSearchPopupMode('recommendations')}
                  onEditWork={onEditSagaEntry}
                />
              </div>}

              {relationsSubtab === 'bundled' && <div className="pr-editor-section">
                <PrEditorRelationCardList
                  relations={bundledRelations}
                  draggedIndex={draggedBundledIndex}
                  dragHandlers={bundledDragHandlers}
                  onRemove={removeBundledRelation}
                  onAdd={() => setSearchPopupMode('bundled')}
                  onEditWork={onEditSagaEntry}
                />
              </div>}

              {relationsSubtab === 'arcs' && <PrEditorStoryArcsSection
                externalId={externalId}
                currentTitle={entry.title_main || externalId}
                currentCover={entry.cover_url || null}
                sagaOrder={sagaOrder}
                resolveSagaMeta={resolveMeta}
                onArcDeleted={arcId => setRemovedArcIds(prev => [...prev, arcId])}
              />}

              {/* ComicVine issues - split out into their own
                  section since their titles are often just a bare issue
                  number, which used to clutter the general Relations grid. */}
              {relationsSubtab === 'issues' && (issueRelations.length > 0 || entry.type === 'comic' || entry.type === 'manga' || entry.type === 'lnovel') && (
                <div className="pr-editor-section">
                  {(entry.type === 'comic' || entry.type === 'manga') && (
                    <div className="pr-editor-source-mapping-row">
                      <span>Fuente ComicVine: {entry.issue_source_id ? `#${entry.issue_source_id}` : 'automática'}</span>
                      <button type="button" className="pr-editor-add-btn" onClick={() => setSourceMappingSearch('issues')}>Seleccionar volumen</button>
                      {entry.issue_source_id && <button type="button" className="pr-editor-add-btn" onClick={resetIssueSource}>Restablecer</button>}
                    </div>
                  )}
                  {isLoadingIssuePreview && <div className="pr-editor-search-loading">Cargando issues de ComicVine…</div>}
                  {issuePreviewError && <div className="pr-editor-search-empty">{issuePreviewError}</div>}
                  {!isLoadingIssuePreview && issueRelations.length === 0 && entry.issue_source_id && !issuePreviewError && (
                    <div className="pr-editor-search-empty">El volumen seleccionado no tiene issues con portada disponibles.</div>
                  )}
                  {!isLoadingIssuePreview && (
                    <PrEditorRelationCardList
                      relations={issueRelations}
                      draggedIndex={draggedIssueIndex}
                      dragHandlers={issueDragHandlers}
                      onRemove={removeIssueRelation}
                      onEditWork={onEditSagaEntry}
                    />
                  )}
                </div>
              )}

              {relationsSubtab === 'episodes' && (entry.type === 'anime' || entry.type === 'series') && (
                <div className="pr-editor-section">
                  <div className="pr-editor-source-mapping-row">
                    <span>Fuente de episodios: {episodeSourceTitle || (episodePreviewLoading ? 'Cargando fuente…' : '—')}</span>
                    <button type="button" className="pr-editor-add-btn" onClick={() => setSourceMappingSearch('episodes')}>Seleccionar serie</button>
                    {entry.episode_source_id && <button type="button" className="pr-editor-add-btn" onClick={() => handleChange('episode_source_id', null)}>Restablecer</button>}
                  </div>
                  <div className="media-relations-grid pr-editor-episode-preview-grid" aria-label="Lista de episodios">
                    {episodePreview.map((episode, index) => (
                      <div className="media-relation-card media-relation-card--static" key={`${episode.source_key ?? episode.external_id}-${episode.season_number}-${episode.episode_number}-${index}`}>
                        <div className="media-relation-bg-layer media-episode-bg-layer">
                          {episode.cover_url && <img src={episode.cover_url} alt="" loading="lazy" />}
                        </div>
                        <div className="media-relation-card-overlay" />
                        <span className="media-relation-type">
                          {episode.season_number > 0
                            ? `S${String(episode.season_number).padStart(2, '0')}E${String(episode.episode_number).padStart(2, '0')}`
                            : episode.episode_number < 0 ? `Sp${-episode.episode_number}` : `#${episode.episode_number}`}
                        </span>
                        <div className="media-relation-card-content">
                          <div className="media-relation-info">
                            <span className="media-relation-title">{episode.name || `Episodio ${episode.episode_number}`}</span>
                          </div>
                        </div>
                      </div>
                    ))}
                    {episodePreviewLoading && <div className="pr-editor-search-loading pr-editor-episode-preview-state">Cargando episodios…</div>}
                    {!episodePreviewLoading && episodePreview.length === 0 && <div className="pr-editor-search-empty pr-editor-episode-preview-state">No hay episodios disponibles para esta fuente.</div>}
                  </div>
                </div>
              )}

              {relationsSubtab === 'themes' && entry.type === 'anime' && (
                <div className="pr-editor-section">
                  <h3 className="pr-editor-section-title">{tm.section_themes}</h3>
                  <div className="media-relations-grid pr-editor-theme-preview-grid">
                    {themePreview.map(theme => (
                      <PrEditorThemeCard
                        key={`${theme.external_id}-${theme.theme_type}-${theme.sequence}-${theme.slug}`}
                        theme={theme}
                        fallbackUrl={entry.banners_csv?.split(',')[0]?.trim() || entry.cover_url || undefined}
                      />
                    ))}
                    {themePreviewLoading && <div className="pr-editor-search-loading">Cargando temas…</div>}
                    {!themePreviewLoading && themePreview.length === 0 && <div className="pr-editor-search-empty">No hay temas disponibles para esta obra.</div>}
                  </div>
                </div>
              )}

              {/* Only shown once a bundle is actually referenced above - lets
                  you fill in the rest of that bundle's own contents right
                  here (this entry is already implied) instead of having to
                  separately open the bundle's own editor afterward. */}
              {relationsSubtab === 'bundle-children' && bundledRelations.length > 0 && (
                <div className="pr-editor-section">
                  <p className="pr-editor-bundle-children-hint">
                    Esta obra ya queda incluida automáticamente — añade aquí el resto de obras del bundle.
                  </p>
                  <PrEditorRelationCardList
                    relations={bundleChildren}
                    draggedIndex={draggedBundleChildIndex}
                    dragHandlers={bundleChildDragHandlers}
                    onRemove={removeBundleChild}
                    onAdd={() => setSearchPopupMode('bundle-children')}
                    onEditWork={onEditSagaEntry}
                  />
                </div>
              )}

              {/* Contains only makes sense for an entry that's itself a
                  container (format BUNDLE) — anything else "containing"
                  other works doesn't apply. */}
              {relationsSubtab === 'contains' && entry.format === 'BUNDLE' && (
                <div className="pr-editor-section">
                  <PrEditorRelationCardList
                    relations={containedRelations}
                    draggedIndex={draggedContainedIndex}
                    dragHandlers={containedDragHandlers}
                    onRemove={removeContainedRelation}
                    onAdd={() => setSearchPopupMode('contains')}
                    onEditWork={onEditSagaEntry}
                  />
                </div>
              )}
              </div>
            </div>
          )}
        </div>
          </div>
        </div>

      </div>)}

      {showUnsavedPrompt && !sessionMode && (
        <div key={unsavedPromptShake} className={`pr-unsaved-changes-toast${unsavedPromptShake ? ' pr-unsaved-changes-toast--shake' : ''}`} role="alertdialog" aria-live="assertive" onClick={event => event.stopPropagation()}>
          <span>Tienes cambios sin guardar</span>
          <button type="button" className="pr-editor-btn pr-editor-btn--submit" onClick={() => { setShowUnsavedPrompt(false); void handleSubmit(); }}>Submit proposal</button>
          <button type="button" className="pr-editor-btn pr-editor-btn--cancel" onClick={discardAndClose}>Descartar</button>
        </div>
      )}

      {sessionMode && sessionTabContextMenu && (onRequestCloseSessionEntry || onRequestCloseSessionTab) && createPortal(
        <div
          className="pr-editor-session-tab-context-menu"
          role="menu"
          style={{ left: Math.min(sessionTabContextMenu.x, window.innerWidth - 190), top: Math.min(sessionTabContextMenu.y, window.innerHeight - 58) }}
          onPointerDown={event => event.stopPropagation()}
          onClick={event => event.stopPropagation()}
        >
          <button type="button" role="menuitem" onClick={() => {
            const tab = sessionTabs.find(item => item.externalId === sessionTabContextMenu.externalId && item.kind === sessionTabContextMenu.kind);
            if (tab && onRequestCloseSessionTab) onRequestCloseSessionTab(tab);
            else onRequestCloseSessionEntry?.(sessionTabContextMenu.externalId);
            setSessionTabContextMenu(null);
          }}>
            Cerrar pestaña
          </button>
        </div>,
        document.body,
      )}

      <PrEditorChangelogPanel externalId={externalId} />

      {searchPopupMode === 'saga' && (
        <MediaSearchPopup
          onSelect={addToSaga}
          onClose={() => setSearchPopupMode(null)}
          excludeIds={sagaOrder}
          closeOnSelect={false}
          // A saga legitimately needs to reference an edition-type entry
          // (Final Fantasy VII's Expanded Edition node, say) as a member in
          // its own right, not just as a Relaciones/Bundled target — without
          // this, the regular search's own EXCLUDED_LOCAL_FORMATS/igdb_search
          // filtering (which hides these everywhere else on purpose, so a
          // plain "Persona 5" search doesn't get buried in its own editions)
          // made it impossible to find and add one here at all.
          includeIgdbExpandedEditions
          igdbRelationMediaType={igdbRelationMediaType}
        />
      )}

      {searchPopupMode === 'bundled' && (
        <MediaSearchPopup
          onSelect={addBundledRelation}
          onClose={() => setSearchPopupMode(null)}
          excludeIds={[externalId, ...bundledRelations.map(r => r.external_id)]}
          closeOnSelect={false}
          includeIgdbBundles
          igdbRelationMediaType={igdbRelationMediaType}
        />
      )}

      {searchPopupMode === 'bundle-children' && (
        <MediaSearchPopup
          onSelect={addBundleChild}
          onClose={() => setSearchPopupMode(null)}
          excludeIds={[externalId, ...(bundledRelations[0] ? [bundledRelations[0].external_id] : []), ...bundleChildren.map(r => r.external_id)]}
          closeOnSelect={false}
        />
      )}

      {searchPopupMode === 'contains' && (
        <MediaSearchPopup
          onSelect={addContainedRelation}
          onClose={() => setSearchPopupMode(null)}
          excludeIds={[externalId, ...containedRelations.map(r => r.external_id)]}
          closeOnSelect={false}
          includeIgdbExpandedEditions
          includeRemasters
          igdbRelationMediaType={igdbRelationMediaType}
        />
      )}

      {searchPopupMode === 'relations' && (
        <MediaSearchPopup
          onSelect={addEditableRelation}
          onClose={() => setSearchPopupMode(null)}
          excludeIds={[externalId, ...editableRelations.map(r => r.related_media_external_id), ...recommendations.map(r => r.external_id)]}
          closeOnSelect={false}
          // Unlike Bundled In/Contains, this general Relations picker isn't
          // scoped to one specific relation kind — a curator manually fixing
          // up a REMASTER/REMAKE/expanded-edition/bundle link (e.g. one the
          // live sync failed to pick up) needs to find it here too, not just
          // via those dedicated pickers.
          includeIgdbBundles
          includeIgdbExpandedEditions
          includeRemasters
          igdbRelationMediaType={igdbRelationMediaType}
        />
      )}

      {searchPopupMode === 'recommendations' && (
        <MediaSearchPopup
          onSelect={addRecommendation}
          onClose={() => setSearchPopupMode(null)}
          excludeIds={[externalId, ...recommendations.map(r => r.external_id), ...editableRelations.map(r => r.related_media_external_id)]}
          closeOnSelect={false}
        />
      )}

      {sourceMappingSearch && (
        <MediaSourceMappingSearchPopup
          kind={sourceMappingSearch}
          preferredIssueCount={sourceMappingSearch === 'issues' ? entry.total_count_2 : undefined}
          onSelect={result => setProviderSource(sourceMappingSearch, result)}
          onClose={() => setSourceMappingSearch(null)}
        />
      )}

      {showCharSearch && (
        <MediaSearchPopup
          onSelect={() => {}}
          onClose={() => setShowCharSearch(false)}
          castPicker={{
            title: 'Personajes de la obra',
            loadingLabel: 'Cargando personajes…',
            emptyLabel: 'Esta obra no tiene personajes disponibles.',
            backLabel: 'Obras',
            errorLabel: 'No se pudo cargar el reparto de esta obra.',
            confirmLabel: 'Añadir seleccionados',
            selectedIds: selectedCastCharacters.map(character => character.external_id),
            loadCast: async work => {
              const data = await fetchMediaDataInternal(work.externalId, true);
              return (data?.characters ?? []).flatMap(character => character.id ? [{
                external_id: character.id,
                name: character.name,
                image_url: character.image ?? null,
              }] : []);
            },
            onToggleCharacter: character => setSelectedCastCharacters(previous => (
              previous.some(item => item.external_id === character.external_id)
                ? previous.filter(item => item.external_id !== character.external_id)
                : [...previous, character]
            )),
            onConfirm: () => {
              const existingIds = new Set(characters.map(character => character.external_id));
              const additions = selectedCastCharacters
                .filter(character => !existingIds.has(character.external_id))
                .map(character => ({
                  external_id: character.external_id,
                  name: character.name,
                  image_url: character.image_url ?? null,
                  relation_type: castSearchRole,
                  character_name: null,
                }));
              if (additions.length) setCharacters(previous => [...previous, ...additions]);
              setSelectedCastCharacters([]);
              setShowCharSearch(false);
            },
          }}
        />
      )}
    </div>,
    document.body
  );
}
