import { useState, useEffect, useRef, useCallback } from 'react';
import { useKeyedState } from '../shared/hooks/useKeyedState';
import { createPortal } from 'react-dom';
import type { Translations } from '../../i18n/index';
import { getT } from '../../i18n/runtime';
import { fetchMediaDataWithFallback, invalidateCachedMediaData } from '../../lib/media/media-page-data';
import { getMediaRelations, saveLibraryEntry } from '../../lib/tauri';
import type { LibraryEntry } from '../../lib/tauri';
import type { MediaPageData } from '../../lib/media/types';
import { MediaEditorModal } from './MediaEditorModal';
import { SagaViewerModal } from './SagaViewerModal';
import { AnimatePresence } from 'motion/react';
import { isUnifySeasonsEnabled } from '../../lib/storage/preferences';
import { PrEditorModal } from './PrEditorModal';
import { getActiveRatingSystem, syncActiveRatingSystem, type RatingSystem } from '../../lib/media/rating-utils';
import { useLibraryEntry } from './hooks/useLibraryEntry';
import { useAutoShrinkTitle } from './hooks/useAutoShrinkTitle';
import { useDiscordPresence } from './hooks/useDiscordPresence';
import { readUserFavoritesTyped, syncFavorites } from '../../lib/tauri/favorites';
import { sanitizeHtml } from '../../lib/shared/text/sanitize-html';
import { ANILIST_TYPES } from '../../lib/media/media-types';
import { CONTAINS_RELATION_TYPES } from '../../lib/media/saga/saga-relation-types';
import { digitToDbRating } from '../../lib/media/rating-digit';
import { isAniListType, syncToAniList } from '../../lib/media/anilist-sync';
import { copyDeepLink } from '../../lib/deep-link/copy-deep-link';
import { shareableWorkFromPage } from '../../lib/deep-link/share-link';
import { showToast } from '../../lib/dom/toast';
import { useShortcuts } from '../shared/hooks/useShortcuts';

import { getPreferredCover } from '../../lib/media/cover-preferences';
import { invalidateMediaPageReads } from '../../lib/media/media-page-read-cache';
import { usePrEditorSession } from './media-page/usePrEditorSession';
import { ThemePlayerOverlay } from './media-page/ThemePlayerOverlay';
import { useMediaPageData } from './media-page/useMediaPageData';
import { useThemePlayer } from './media-page/useThemePlayer';
import { useEpisodesAndSeasons } from './media-page/useEpisodesAndSeasons';
import { useEventMatches } from './media-page/useEventMatches';
import { useFriendsScores } from './media-page/useFriendsScores';
import { useCustomImages } from './media-page/useCustomImages';
import { useRetrySync } from './media-page/useRetrySync';
import { useFriendsGridCutoff } from './media-page/useFriendsGridCutoff';
import { MediaHero } from './media-page/MediaHero';
import { MediaRelationsSection, EPISODE_PAGE_SIZE, type RelationsTab } from './media-page/MediaRelationsSection';
import { MediaStatsColumn } from './media-page/MediaStatsColumn';
import { MediaCastSection, type CharTab } from './media-page/MediaCastSection';
import { MediaScoresSection } from './media-page/MediaScoresSection';
import { useMediaSpoilers } from './media-page/useMediaSpoilers';
import { useEpisodeFiller } from './media-page/useEpisodeFiller';
import { FillerAttribution, FillerEpisodesToolbar } from './media-page/FillerEpisodesToolbar';
import { completionEpisode, nextCanonEpisode, skipsFiller } from '../../lib/anime/filler';
import { formatAppError } from '../../lib/errors/format-error';
import { SpoilerShield } from '../spoilers/SpoilerShield';


// ── MediaPage ──────────────────────────────────────────────────────────────

interface Props {
  i18n: Pick<Translations, 'media' | 'discord'>;
  // Renders a supplied MediaPageData instead of fetching (used by the PR
  // preview modal to show a proposal's simulated result). previewMode also
  // hides every write-triggering control (rating, status, edit/PR buttons).
  previewData?: MediaPageData;
  previewMode?: boolean;
  /** Relation ids changed by the open proposal; only used in preview mode. */
  previewAddedRelationIds?: string[];
  previewUpdatedRelationIds?: string[];
}

export default function MediaPage({ i18n, previewData, previewMode = false, previewAddedRelationIds = [], previewUpdatedRelationIds = [] }: Props) {
  const t  = i18n;
  const tm = t.media;
  const pe = getT().pr_editor;

  // Estado para el ID actual de la obra
  const [currentId, setCurrentId] = useState('');
  const [showEditor,         setShowEditor]         = useState(false);
  const [showSaga,           setShowSaga]           = useState(false);
  // Section tabs/pagination start over on every navigation (keyed on the
  // id the data hooks load for, so they don't need to know about page UI
  // state).
  const [relationPage,       setRelationPage]       = useKeyedState(currentId, 1);
  const [relationsTab,       setRelationsTab]       = useKeyedState<RelationsTab>(currentId, 'related');
  const [characterPage,      setCharacterPage]      = useKeyedState(currentId, 1);
  const [charTab,            setCharTab]            = useKeyedState<CharTab>(currentId, 'characters');
  const {
    data, setData,
    pageState, setPageState,
    isFetchingFull, setIsFetchingFull,
    episodes, setEpisodes,
    themes, setThemes,
  } = useMediaPageData({ currentId, previewMode, tm });
  const prSession = usePrEditorSession({
    currentId,
    currentTitle: data?.titleMain,
    pe,
    onSubmitted: () => {
      if (!currentId) return;
      // The proposal wrote catalog/relation rows the page may hold memoised.
      invalidateMediaPageReads();
      fetchMediaDataWithFallback(currentId, partial => setData(partial), full => setData(full), () => {});
    },
  });
  // localStorage is unavailable during Astro's server render.
  const unifySeasonsEnabled = typeof window !== 'undefined' && isUnifySeasonsEnabled();
  const {
    playingTheme, setPlayingTheme,
    selectedThemeVersion, selectVersion,
    videoSource,
    playerError,
    onVideoError,
    retry: retryThemePlayer,
  } = useThemePlayer({ currentId, themes });
  const { animeSeasonChain, animeSeasonChainResolvedFor, episodeOffset } = useEpisodesAndSeasons({
    currentId,
    previewMode,
    dataType: data?.type,
    dataHasSaga: data?.hasSaga,
    unifySeasonsEnabled,
    episodes,
    setEpisodes,
    setThemes,
  });
  const customImagesMap = useCustomImages(currentId, previewMode);
  // Spoiler shield (lib/spoilers/): off in preview mode — a proposal's own
  // content is never hidden from its author.
  const spoilers = useMediaSpoilers({ currentId, previewMode, data, animeSeasonChain, episodes });
  const { friendsScores, friendsLoading } = useFriendsScores(currentId, previewMode);
  const [ratingSystem,       setRatingSystem]       = useState<RatingSystem>(getActiveRatingSystem());
  const [savedToast,         setSavedToast]         = useState<'hidden' | 'visible' | 'leaving'>('hidden');
  const [isFavorited,        setIsFavorited]        = useState(false);
  const savedToastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { usersScrollRef, usersGridRef } = useFriendsGridCutoff(friendsScores);
  const titleRef = useAutoShrinkTitle(data?.titleMain);
  const descriptionRef = useRef<HTMLDivElement>(null);
  const [descriptionOverflows, setDescriptionOverflows] = useState(false);
  const [, refreshCoverPreference] = useState(0);
  useEffect(() => {
    const handleCoverPreferenceChange = () => refreshCoverPreference(value => value + 1);
    window.addEventListener('media-cover-preference-changed', handleCoverPreferenceChange);
    return () => window.removeEventListener('media-cover-preference-changed', handleCoverPreferenceChange);
  }, []);
  const displayCover = data ? getPreferredCover(data.externalId, data.cover) : null;

  const {
    entry: libEntry,
    status: libStatus,
    rating: libRating,
    inLibrary,
    updateLocal,
    applySaved,
    applyDeleted,
    rollback,
  } = useLibraryEntry(currentId, data?.type);
  // AnimeFillerList badges, "Hide filler" and the Watched/Skipped choice
  // (lib/anime/filler.ts).
  const filler = useEpisodeFiller({ currentId, previewMode, data, episodeOffset });
  const isEventCompetition = data?.type === 'event'
    && /^event:apisports:(football|basketball):\d+$/.test(currentId);

  const {
    matches,
    eventAggregateStatus,
    eventAggregateRating,
    mediaInLibrary,
    saveEventSeasonUpdates,
  } = useEventMatches({
    currentId,
    previewMode,
    dataType: data?.type,
    dataSeasons: data?.seasons,
    isEventCompetition,
    unifySeasonsEnabled,
    showEditor,
    setData,
    libStatus,
    libRating,
    inLibrary,
  });

  useEffect(() => {
    syncActiveRatingSystem().then(setRatingSystem);
  }, []);

  // Escuchar cambios de navegación (Astro View Transitions y Popstate)
  useEffect(() => {
    if (previewMode) return;
    const updateId = () => {
      const id = new URLSearchParams(window.location.search).get('id') ?? '';
      setCurrentId(id);
    };

    updateId();

    // Eventos de Astro para transiciones de página
    document.addEventListener('astro:page-load', updateId);
    window.addEventListener('popstate', updateId);
    return () => {
      document.removeEventListener('astro:page-load', updateId);
      window.removeEventListener('popstate', updateId);
    };
  }, [previewMode]);

  // Preview mode: render the supplied data directly, skip every fetch below.
  useEffect(() => {
    if (!previewMode) return;
    if (previewData) {
      setCurrentId(previewData.externalId);
      setData(previewData);
      setPageState('ready');
      setIsFetchingFull(false);
    }
  }, [previewMode, previewData, setData, setPageState, setIsFetchingFull]);

  // Auto-open editor when ?edit=1 is in the URL (e.g. navigating from library)
  useEffect(() => {
    if (previewMode || !data) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('edit') === '1') setShowEditor(true);
  }, [data, previewMode]);

  // A bundle has no library entry of its own (see isBundle below) — the
  // usual "favorite" toggle lives inside MediaEditorModal's library log,
  // which a bundle never gets to open, so its favorite state is tracked
  // standalone here instead, straight off the shared favorites list.
  const dataType = data?.type;
  useEffect(() => {
    if (previewMode || !dataType) return;
    let cancelled = false;
    readUserFavoritesTyped().then(favs => {
      if (cancelled) return;
      setIsFavorited((favs[dataType] || []).includes(currentId));
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [currentId, dataType, previewMode]);

  // The top/bottom fade on the synopsis should only appear when there's
  // actually more text than fits — otherwise a short synopsis gets its
  // first/last line faded out for no reason. Re-measured whenever the
  // description text itself changes.
  useEffect(() => {
    const el = descriptionRef.current;
    if (!el) { setDescriptionOverflows(false); return; }
    setDescriptionOverflows(el.scrollHeight > el.clientHeight + 1);
  }, [data?.description]);

  useDiscordPresence(data, t.discord);

  const [activeLogIdOverride, setActiveLogIdOverride] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (pageState === 'ready' && typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      if (params.get('openEditor') === 'true') {
        const subId = params.get('subId');
        if (subId) setActiveLogIdOverride(subId);
        setShowEditor(true);
        params.delete('openEditor');
        params.delete('subId');
        const newSearch = params.toString() ? `?${params.toString()}` : '';
        window.history.replaceState({}, '', `${window.location.pathname}${newSearch}`);
      }
    }
  }, [pageState]);

  const handleCoverClick = useCallback(() => {
    setShowEditor(true);
  }, []);

  const handleEditorSaved = useCallback((entry: LibraryEntry) => {
    applySaved(entry);
    // The editor's own heart button (MediaEditorModal) writes favorite state
    // independently of the cover's — without this, saving a favorite change
    // there wouldn't show up on the cover heart until the next full reload.
    setIsFavorited(!!entry.is_favorite);
    setSavedToast('visible');
    if (savedToastTimer.current) clearTimeout(savedToastTimer.current);
    // After 2s start exit animation, then hide after animation (300ms)
    savedToastTimer.current = setTimeout(() => {
      setSavedToast('leaving');
      savedToastTimer.current = setTimeout(() => setSavedToast('hidden'), 320);
    }, 2000);
  }, [applySaved]);

  const handleEditorDeleted = useCallback(() => {
    applyDeleted();
    // Deleting the library entry unfavorites it too (MediaEditorModal's own
    // delete flow calls syncFavorites(..., false)) — mirror that here.
    setIsFavorited(false);
  }, [applyDeleted]);

  const { retryingSync, handleRetrySync } = useRetrySync({
    currentId,
    unifySeasonsEnabled,
    animeSeasonChain,
    tm,
    setData,
    setEpisodes,
    setThemes,
  });

  const handleBlockedProposalSubmitted = useCallback(async (blockedExternalId: string) => {
    const relationRows = await getMediaRelations(blockedExternalId).catch(() => null);
    const pageRelations = data?.externalId === blockedExternalId ? data.relations : [];
    const sourceId = relationRows
      ? relationRows.find(relation => ['SOURCE', 'REL_SOURCE', 'PARENT'].includes(relation.relation_type))?.related_media_external_id
      : pageRelations.find(relation => ['SOURCE', 'REL_SOURCE', 'PARENT'].includes(relation.relationType ?? ''))?.relatedExternalId;
    const baseEditionId = relationRows
      ? relationRows.find(relation => relation.relation_type === 'BASE_EDITION')?.related_media_external_id
      : pageRelations.find(relation => relation.relationType === 'BASE_EDITION')?.relatedExternalId;
    const prequelId = relationRows
      ? relationRows.find(relation => relation.relation_type === 'PREQUEL')?.related_media_external_id
      : pageRelations.find(relation => relation.relationType === 'PREQUEL')?.relatedExternalId;
    const destinationId = sourceId || baseEditionId || prequelId;

    if (destinationId) {
      // Drop any cached relation graph so the destination reloads against
      // the visible catalog view, which filters this newly blocked entry.
      invalidateCachedMediaData(destinationId);
      window.location.replace(`/media?id=${encodeURIComponent(destinationId)}`);
      return;
    }

    window.location.replace('/profile');
  }, [data]);

  // Closing without saving: roll back any optimistic quick-click draft to
  // the last confirmed DB state, so a re-open (or the hero widget) doesn't
  // keep showing changes that were never actually persisted.
  const handleEditorClose = useCallback(() => {
    setShowEditor(false);
    rollback();
  }, [rollback]);

  // Quick hero-widget edits persist immediately instead of opening the full
  // editor — previously both just staged an optimistic local draft and
  // always opened MediaEditorModal, so a click that didn't end in an
  // explicit Save (closing the modal, or not noticing it opened at all)
  // silently rolled back, making the star/status click look like it did
  // nothing. saveLibraryEntry writes the same merged draft updateLocal
  // already builds, so no other field on the entry is touched.
  const handleStatusChange = useCallback(async (next: string) => {
    if (isEventCompetition && unifySeasonsEnabled) {
      try {
        await saveEventSeasonUpdates({ status: next || null });
      } catch (e) {
        console.error('Failed to save event season status:', e);
      }
      return;
    }
    const draft = updateLocal({ status: next || null });
    try {
      const saved = await saveLibraryEntry(draft);
      applySaved(saved);
    } catch (e) {
      console.error('Failed to save status:', e);
      rollback();
    }
  }, [isEventCompetition, unifySeasonsEnabled, saveEventSeasonUpdates, updateLocal, applySaved, rollback]);

  const handleRate = useCallback(async (stars: number) => {
    const dbRating = stars * 2;
    const currentRating = isEventCompetition && unifySeasonsEnabled ? eventAggregateRating : libRating;
    const nextRating = currentRating === dbRating ? 0 : dbRating;
    if (isEventCompetition && unifySeasonsEnabled) {
      try {
        await saveEventSeasonUpdates({ rating: nextRating || null });
      } catch (e) {
        console.error('Failed to save event season rating:', e);
      }
      return;
    }
    const draft = updateLocal({ rating: nextRating || null });
    try {
      const saved = await saveLibraryEntry(draft);
      applySaved(saved);
    } catch (e) {
      console.error('Failed to save rating:', e);
      rollback();
    }
  }, [isEventCompetition, unifySeasonsEnabled, eventAggregateRating, libRating, saveEventSeasonUpdates, updateLocal, applySaved, rollback]);

  // Cover heart — same quick-edit pattern as handleStatusChange/handleRate,
  // but favorite is the one field MediaEditorModal persists in two places at
  // once (saveLibraryEntry's is_favorite column AND the separate
  // user_lists-based favorites list via syncFavorites — see its own
  // handleSubmit). The cover heart used to only do the second half, so
  // whatever elsewhere in the app treats the library entry's is_favorite
  // column as the source of truth never saw a cover-only favorite at all.
  const handleToggleFavorite = useCallback(async () => {
    const next = !isFavorited;
    setIsFavorited(next);
    const draft = updateLocal({ is_favorite: next ? 1 : 0 });
    try {
      const saved = await saveLibraryEntry(draft);
      applySaved(saved);
      await syncFavorites(draft.type, currentId, next);
    } catch (e) {
      console.error('Failed to save favorite:', e);
      setIsFavorited(!next);
      rollback();
    }
  }, [isFavorited, updateLocal, applySaved, rollback, currentId]);

  // "Copy link" — puts the https share link of this work on the clipboard:
  // the rich preview link (share-link.ts) built from the loaded page data,
  // or the plain /open/ redirect while it is still loading. Shared by the
  // hero's button and the `l` shortcut.
  const handleCopyLink = useCallback(async () => {
    const deepLinkText = getT().deep_link;
    const work = data && data.externalId === currentId ? shareableWorkFromPage(data) : undefined;
    const copied = await copyDeepLink({ kind: 'media', external_id: currentId }, work);
    showToast(copied ? deepLinkText.copied : deepLinkText.copy_failed, copied ? 'success' : 'error');
  }, [currentId, data]);

  // `+` / `-`: progress ±1 through the same quick-edit persistence as the
  // hero (saveLibraryEntry + applySaved) followed by the editor's AniList
  // sync, with the editor's "reaching the total completes it" rule.
  const handleStepProgress = useCallback(async (delta: 1 | -1) => {
    if (!data) return;
    const current = libEntry?.progress ?? 0;
    const total = data.totalCount && data.totalCount > 0 ? data.totalCount : null;
    // Filler: Skipped → `+` jumps to the next canon/mixed episode and the
    // entry completes at its last one. Progress stays the real episode number.
    const skipping = skipsFiller(libEntry, filler.ownInfo, total);
    const stepped = skipping && delta === 1
      ? nextCanonEpisode(current, filler.ownInfo, total).episode ?? (total ?? current + 1)
      : current + delta;
    const next = Math.max(0, total ? Math.min(total, stepped) : stepped);
    if (next === current) return;
    const overrides: Partial<LibraryEntry> = { progress: next };
    const completeAt = completionEpisode(libEntry, filler.ownInfo, total);
    if (completeAt && next >= completeAt && data.status !== 'NOT_YET_RELEASED' && libStatus !== 'completed') overrides.status = 'completed';
    const draft = updateLocal(overrides);
    try {
      const saved = await saveLibraryEntry(draft);
      applySaved(saved);
      if (isAniListType(data.type)) {
        void syncToAniList({
          externalId: currentId, type: data.type,
          status: saved.status ?? '', rating: saved.rating ?? 0,
          progress: saved.progress ?? 0, progressVolumes: saved.progress_2 ?? 0,
          startedAt: saved.started_at ?? '', finishedAt: saved.finished_at ?? '', notes: saved.notes ?? '',
        }).then(result => { if (!result.ok) console.warn('AniList sync failed:', result.error); });
      }
    } catch (e) {
      console.error('Failed to save progress:', e);
      rollback();
    }
  }, [data, libEntry, libStatus, currentId, updateLocal, applySaved, rollback, filler.ownInfo]);

  // "Filler: Watched / Skipped" from the episodes toolbar. Display and
  // counting only; nothing is synced to AniList/MAL.
  const handleSkipFillerChange = useCallback(async (skip: boolean) => {
    const draft = updateLocal({ skip_filler: skip ? 1 : 0 });
    try {
      applySaved(await saveLibraryEntry(draft));
    } catch (e) {
      rollback();
      showToast(formatAppError(e, getT()), 'error');
    }
  }, [updateLocal, applySaved, rollback]);

  // Hiding filler reshapes the pages, so it goes back to the first one.
  const fillerView = { ...filler, setHideFiller: (hide: boolean) => { filler.setHideFiller(hide); setRelationPage(1); } };
  const fillerSection = filler.applies ? {
    view: fillerView,
    toolbar: (
      <FillerEpisodesToolbar
        t={tm.filler}
        currentId={currentId}
        view={fillerView}
        entry={inLibrary ? libEntry : null}
        total={data?.totalCount}
        onSkipFillerChange={skip => void handleSkipFillerChange(skip)}
      />
    ),
    footer: filler.anyFiller ? <FillerAttribution t={tm.filler} slug={filler.ownInfo?.slug} /> : null,
  } : undefined;

  // ── Keyboard shortcuts (page context) ────────────────────────────────────
  // Only while nothing sits on top of the page: the editors register their
  // own `modal` bindings, but keys they do not bind would otherwise fall
  // through to these (and the saga viewer / theme overlay bind nothing).
  const isBlockedEdition = !!data?.parentGame && data.format !== 'EXPANSION';
  const isBundle = (data?.relations ?? []).filter(r => !!r.relationType && CONTAINS_RELATION_TYPES.includes(r.relationType)).length >= 2;
  const noOverlayOpen = () => !showEditor && !showSaga && !prSession.showPrEditor && !playingTheme;
  const progressSteppable = !isEventCompetition && data?.type !== 'game' && data?.type !== 'vnovel';
  useShortcuts('page', [
    { id: 'media.open_editor', keys: 'e', description: 'shortcuts.media_open_editor', when: () => noOverlayOpen() && !isBlockedEdition && !isBundle, handler: handleCoverClick },
    { id: 'media.propose', keys: 'p', description: 'shortcuts.media_propose', when: noOverlayOpen, handler: prSession.start },
    { id: 'media.copy_link', keys: 'l', description: 'shortcuts.media_copy_link', when: noOverlayOpen, handler: () => void handleCopyLink() },
    { id: 'media.toggle_favorite', keys: 'f', description: 'shortcuts.media_toggle_favorite', when: () => noOverlayOpen() && !isBlockedEdition, handler: () => void handleToggleFavorite() },
    { id: 'media.progress_increment', keys: '+', description: 'shortcuts.media_progress_increment', when: () => noOverlayOpen() && inLibrary && progressSteppable, handler: () => void handleStepProgress(1) },
    { id: 'media.progress_decrement', keys: '-', description: 'shortcuts.media_progress_decrement', when: () => noOverlayOpen() && inLibrary && progressSteppable, handler: () => void handleStepProgress(-1) },
    {
      id: 'media.rate', keys: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'], description: 'shortcuts.media_rate',
      when: () => noOverlayOpen() && !isBlockedEdition && !isBundle && digitToDbRating('1', ratingSystem) !== null,
      // handleRate takes the 0.5–5 star scale the hero's StarRating uses;
      // the DB value is twice that.
      handler: event => {
        const dbRating = digitToDbRating(event.key, ratingSystem);
        if (dbRating !== null) void handleRate(dbRating / 2);
      },
    },
    { id: 'media.play_theme', keys: 't', description: 'shortcuts.media_play_theme', when: () => noOverlayOpen() && themes.length > 0, handler: () => setPlayingTheme(themes[0]) },
  ], { enabled: !!data && pageState === 'ready' && !previewMode });

  // ── States: loading / error ──────────────────────────────────────────────

  const navigateToThemeEpisodes = (formatted: string) => {
    const match = formatted.match(/\b\d+\b/);
    if (match) {
      const targetEpNum = parseInt(match[0], 10);
      const regularEps = episodes
        .filter(e => e.episode_number > 0)
        .sort((a, b) => a.episode_number - b.episode_number);
      const specialEps = episodes
        .filter(e => e.episode_number < 0)
        .sort((a, b) => Math.abs(a.episode_number) - Math.abs(b.episode_number));

      const regularPages = Math.ceil(regularEps.length / EPISODE_PAGE_SIZE);

      if (targetEpNum > 0) {
        const regIdx = regularEps.findIndex(e => e.episode_number === targetEpNum);
        if (regIdx !== -1) {
          setRelationPage(Math.floor(regIdx / EPISODE_PAGE_SIZE) + 1);
        }
      } else {
        const spIdx = specialEps.findIndex(e => e.episode_number === targetEpNum);
        if (spIdx !== -1) {
          setRelationPage(regularPages + Math.floor(spIdx / EPISODE_PAGE_SIZE) + 1);
        }
      }
    }
    setRelationsTab('episodes');
    setPlayingTheme(null);
    setTimeout(() => {
      const section = document.querySelector('.media-relations-section');
      section?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 100);
  };

  if (pageState === 'loading') {
    return <div className="media-loading"><div className="spinner" /></div>;
  }
  if (pageState === 'error' || !data) {
    return <div className="media-error"><span>{tm.not_found}</span></div>;
  }

  // ── Ready ────────────────────────────────────────────────────────────────

  // With the "Unificar temporadas" setting on, an anime's own PREQUEL/SEQUEL
  // rows move to the Temporadas tab instead of sitting in Relacionados —
  // with it off (or for every other media type), Relacionados is untouched,
  // exactly as it's always been.
  const sagaUsesOnlySeasonMedia = animeSeasonChain.length <= 1 || animeSeasonChain.every(
    entry => entry.mediaType === 'anime' || entry.mediaType === 'series',
  );
  const showsSeasonsTab = data.type === 'anime' && unifySeasonsEnabled && sagaUsesOnlySeasonMedia;
  const waitingForAnimeSeasonChain = data.type === 'anime'
    && unifySeasonsEnabled
    && animeSeasonChainResolvedFor !== currentId;
  const isFirstSeasonInChain = !showsSeasonsTab || animeSeasonChain.length <= 1 || currentId === animeSeasonChain[0].externalId;
  const hasEpisodes             = !waitingForAnimeSeasonChain && isFirstSeasonInChain && episodes.length > 0;
  const hasThemes               = !waitingForAnimeSeasonChain && isFirstSeasonInChain && themes.length > 0;
  const isAnilistType = (ANILIST_TYPES as readonly string[]).includes(data.type);
  const showUsers = isAnilistType && (friendsLoading || friendsScores.length > 0);
  return (
    <>
      {isFetchingFull && <div className="media-bottom-progress" />}
      {savedToast !== 'hidden' && (
        <div
          className={`media-saved-toast${savedToast === 'leaving' ? ' media-saved-toast--out' : ''}`}
          role="status"
          aria-live="polite"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
          {tm.editor.saved_toast}
        </div>
      )}
      <AnimatePresence>
        {!previewMode && showEditor && (
          <MediaEditorModal
            externalId={currentId}
            data={data}
            i18n={tm}
            initialEntry={libEntry ?? undefined}
            initialActiveLogId={activeLogIdOverride}
            onClose={handleEditorClose}
            onSaved={handleEditorSaved}
            onDeleted={handleEditorDeleted}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {!previewMode && showSaga && (
          <SagaViewerModal externalId={currentId} i18n={tm} onClose={() => setShowSaga(false)} />
        )}
      </AnimatePresence>
      {playingTheme && (
        <ThemePlayerOverlay
          theme={playingTheme}
          themes={themes}
          mediaTitle={data?.titleMain ?? ''}
          mediaCover={data?.cover}
          videoSource={videoSource}
          playerError={playerError}
          selectedVersion={selectedThemeVersion}
          animeSeasonChain={animeSeasonChain}
          episodes={episodes}
          currentId={currentId}
          episodeOffset={episodeOffset}
          hasEpisodes={hasEpisodes}
          t={tm}
          onClose={() => setPlayingTheme(null)}
          onSelectTheme={setPlayingTheme}
          onSelectVersion={selectVersion}
          onVideoError={onVideoError}
          onRetry={retryThemePlayer}
          onNavigateToEpisodes={navigateToThemeEpisodes}
        />
      )}
      {!previewMode && prSession.showPrEditor && prSession.sessionIds.map(externalId => {
        return (
          <PrEditorModal
            key={externalId}
            externalId={externalId}
            sessionActive={prSession.activeCharacterId === null && prSession.activeId === externalId}
            sessionMode
            sessionHasChanges={Object.values(prSession.dirtyById).some(Boolean) || Object.values(prSession.characterEntries).some(item => item.dirty)}
            sessionAffected={prSession.affectedIds.has(externalId)}
            sessionTabs={prSession.allSessionTabs}
            onNavigateSessionEntry={prSession.setActiveId}
            onNavigateSessionTab={prSession.navigateTab}
            onRequestCloseSessionEntry={prSession.requestCloseEntry}
            onRequestCloseSessionTab={prSession.requestCloseTab}
            onSessionTitleChange={prSession.updateSessionTitle}
            onSessionSagaOrderChange={prSession.updateSagaOrder}
            onSessionDirtyChange={prSession.updateDirty}
            onEditSagaEntry={prSession.addEntry}
            onEditCharacter={prSession.openCharacterTab}
            onSubmitProposalSession={() => void prSession.submit()}
            onRequestSessionClose={prSession.requestClose}
            onDiscardSession={prSession.discard}
            onRegisterSessionEditor={prSession.registerSession}
            onBlockedSubmitted={handleBlockedProposalSubmitted}
            onClose={prSession.requestClose}
            onSaved={() => {
              if (externalId !== currentId) return;
              invalidateMediaPageReads();
              fetchMediaDataWithFallback(currentId, partial => setData(partial), full => setData(full), () => {});
            }}
          />
        );
      })}
      {!previewMode && prSession.showExitPrompt && (prSession.pendingTabCloseId || prSession.pendingCharacterCloseId || Object.values(prSession.dirtyById).some(Boolean) || Object.values(prSession.characterEntries).some(entry => entry.dirty)) && createPortal(
        <div key={prSession.exitPromptShake} className={`pr-unsaved-changes-toast${prSession.exitPromptShake ? ' pr-unsaved-changes-toast--shake' : ''}`} role="alertdialog" aria-live="assertive" onClick={event => event.stopPropagation()}>
          {prSession.pendingTabCloseId ? (
            <span>{pe.session_entry_unsaved.replace('{title}', prSession.sessionTitles[prSession.pendingTabCloseId] || prSession.pendingTabCloseId)}</span>
          ) : prSession.pendingCharacterCloseId ? (
            <span>{pe.session_entry_unsaved.replace('{title}', prSession.characterEntries[prSession.pendingCharacterCloseId]?.title || prSession.pendingCharacterCloseId)}</span>
          ) : Object.values(prSession.dirtyById).some(Boolean) || Object.values(prSession.characterEntries).some(entry => entry.dirty) ? (
            <span>{pe.unsaved_changes_title}</span>
          ) : (
            <span>{pe.session_exit_confirm}</span>
          )}
          {!prSession.pendingTabCloseId && !prSession.pendingCharacterCloseId && Object.values(prSession.dirtyById).some(Boolean) && prSession.status && <span className="pr-unsaved-changes-toast__status">{prSession.status}</span>}
          {!prSession.pendingTabCloseId && !prSession.pendingCharacterCloseId && Object.values(prSession.dirtyById).some(Boolean) && prSession.exitError && <span className="pr-unsaved-changes-toast__error">{prSession.exitError}</span>}
          {!prSession.pendingTabCloseId && !prSession.pendingCharacterCloseId && (Object.values(prSession.dirtyById).some(Boolean) || Object.values(prSession.characterEntries).some(entry => entry.dirty)) && <button type="button" className="pr-editor-btn pr-editor-btn--submit" onClick={() => void prSession.submit()} disabled={prSession.submitting}>
            {prSession.submitting ? pe.sending : pe.submit_proposal}
          </button>}
          {prSession.pendingTabCloseId && <button type="button" className="pr-editor-btn pr-editor-btn--cancel" onClick={prSession.confirmCloseEntry}>{pe.close_without_saving}</button>}
          {prSession.pendingTabCloseId && <button type="button" className="pr-editor-btn pr-editor-btn--secondary" onClick={() => { prSession.setPendingTabCloseId(null); prSession.setShowExitPrompt(false); prSession.setExitPromptShake(0); }}>{pe.cancel}</button>}
          {prSession.pendingCharacterCloseId && <button type="button" className="pr-editor-btn pr-editor-btn--cancel" onClick={prSession.confirmCloseCharacterEntry}>{pe.close_without_saving}</button>}
          {prSession.pendingCharacterCloseId && <button type="button" className="pr-editor-btn pr-editor-btn--secondary" onClick={() => { prSession.setPendingCharacterCloseId(null); prSession.setShowExitPrompt(false); prSession.setExitPromptShake(0); }}>{pe.cancel}</button>}
          {!prSession.pendingTabCloseId && !prSession.pendingCharacterCloseId && (Object.values(prSession.dirtyById).some(Boolean) || Object.values(prSession.characterEntries).some(entry => entry.dirty)) && <button type="button" className="pr-editor-btn pr-editor-btn--cancel" onClick={prSession.discard} disabled={prSession.submitting}>{pe.discard}</button>}
        </div>,
        document.body,
      )}

      {/* Hero */}
      <MediaHero
        data={data}
        currentId={currentId}
        previewMode={previewMode}
        t={tm}
        titleRef={titleRef}
        displayCover={displayCover}
        showsSeasonsTab={showsSeasonsTab}
        mediaInLibrary={mediaInLibrary}
        isFavorited={isFavorited}
        retryingSync={retryingSync}
        eventAggregateStatus={eventAggregateStatus}
        eventAggregateRating={eventAggregateRating}
        onProposeChanges={prSession.start}
        onRetrySync={handleRetrySync}
        onCopyLink={() => void handleCopyLink()}
        onOpenSaga={() => setShowSaga(true)}
        onCoverClick={handleCoverClick}
        onToggleFavorite={handleToggleFavorite}
        onStatusChange={handleStatusChange}
        onRate={handleRate}
        coverSpoiler={spoilers.coverHidden ? spoilers.revealCover : undefined}
      />

      {/* Body: 3 columnas — Datos (the 3rd column) always renders now (at
          minimum its header + source link), so the grid never collapses to
          2 columns anymore; doing so used to reflow/flicker the whole body
          every time stats/authors loaded in after the initial partial
          fetch. */}
      <div className="media-body">

        {/* Sinopsis */}
        <div className="media-col-synopsis">
          {data.description && (
            <>
              <div className="media-section-header-row">
                <p className="section-label">{tm.section_synopsis}</p>
                <div className="media-section-header-line" />
              </div>
              <SpoilerShield hidden={spoilers.synopsisHidden} onReveal={spoilers.revealSynopsis}>
                <div
                  ref={descriptionRef}
                  className={`media-description-text${descriptionOverflows ? ' has-overflow' : ''}${spoilers.synopsisPending ? ' spoiler-shield-pending' : ''}`}
                  dangerouslySetInnerHTML={{ __html: sanitizeHtml(data.description) }}
                />
              </SpoilerShield>
            </>
          )}
        </div>

        {/* Relacionados — header bar always renders (even with zero
            relations) so this column isn't just blank space next to
            Sinopsis/Datos; only the grid+pagination are conditional. */}
        <MediaRelationsSection
          data={data}
          currentId={currentId}
          previewMode={previewMode}
          previewAddedRelationIds={previewAddedRelationIds}
          previewUpdatedRelationIds={previewUpdatedRelationIds}
          t={tm}
          relationsTab={relationsTab}
          setRelationsTab={setRelationsTab}
          relationPage={relationPage}
          setRelationPage={setRelationPage}
          episodes={episodes}
          themes={themes}
          matches={matches}
          animeSeasonChain={animeSeasonChain}
          showsSeasonsTab={showsSeasonsTab}
          isEventCompetition={isEventCompetition}
          hasEpisodes={hasEpisodes}
          hasThemes={hasThemes}
          displayCover={displayCover}
          onPlayTheme={setPlayingTheme}
          spoilers={spoilers}
          filler={fillerSection}
        />

        <MediaStatsColumn
          data={data}
          t={tm}
          ratingSystem={ratingSystem}
          timeToBeat={previewMode ? undefined : {
            t: getT().time_to_beat,
            // Games and VNs log hours played in `progress`.
            playedMinutes: libEntry?.progress ? libEntry.progress * 60 : undefined,
          }}
        />
      </div>

      {/* Personajes + Usuarios — side by side, Usuarios pinned to the same
          width as the Datos column above (.media-body's 0.9fr share) since
          it's a much shorter list than the characters grid next to it.
          Usuarios always reserves its slot for AniList-typed entries (even
          before the friends fetch — which runs independently of the main
          media fetch, see above — resolves) so the layout doesn't jump once
          it comes back with real cards. */}
      {(data.characters.length > 0 || showUsers) && (
        <div className="media-chars-users-row">
          {data.characters.length > 0 && (
            <MediaCastSection
              data={data}
              t={tm}
              charTab={charTab}
              setCharTab={setCharTab}
              characterPage={characterPage}
              setCharacterPage={setCharacterPage}
              customImagesMap={customImagesMap}
              showUsers={showUsers}
              spoilers={spoilers}
            />
          )}

          {showUsers && (
            <MediaScoresSection
              t={tm}
              friendsScores={friendsScores}
              friendsLoading={friendsLoading}
              ratingSystem={ratingSystem}
              scrollRef={usersScrollRef}
              gridRef={usersGridRef}
            />
          )}
        </div>
      )}
    </>
  );
}
