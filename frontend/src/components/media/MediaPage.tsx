import { useState, useEffect, useRef, useCallback, Fragment } from 'react';
import type { ReactNode } from 'react';
import type { Translations } from '../../i18n/index';
import { fetchMediaData, fetchMediaDataWithFallback, fetchExtraRelations, fetchBookEditions, fetchComicIssues, patchCachedRelations, mergeAndPersistRelations, bucketRelations, mediaCharactersToSkeleton, mediaStaffToSkeleton, mapMediaDataToCatalogEntry, invalidateCachedMediaData, CACHE_PREFIX } from '../../lib/media/mediaService';
import { saveCatalogEntry, saveLibraryEntry, updateCatalogGenres } from '../../lib/tauri';
import type { LibraryEntry } from '../../lib/tauri';
import type { MediaPageData } from '../../lib/media/types';
import { MediaEditorModal } from './MediaEditorModal';
import { SagaViewerModal } from './SagaViewerModal';
import { PrEditorModal } from './PrEditorModal';
import { STAR_PATH } from '../../lib/media/constants';
import { dbRatingToStars5, getActiveRatingSystem, syncActiveRatingSystem, formatRatingHtml, formatAverageScore, averageScoreSuffix, type RatingSystem } from '../../lib/media/rating-utils';
import { IconPlus, IconCheck, IconTrayStatus, IconLayers, IconHeart, IconRefresh } from '../local/ui/icons';
import { useLibraryEntry } from './hooks/useLibraryEntry';
import { useAutoShrinkTitle } from './hooks/useAutoShrinkTitle';
import { useDiscordPresence } from './hooks/useDiscordPresence';
import { MediaStoreLinks, openLink } from './MediaStoreLinks';
import { MediaSourceLink } from './MediaSourceLink';
import { Pagination } from './Pagination';
import { saveCharactersSkeleton } from '../../lib/tauri/characters';
import { saveStaffSkeleton } from '../../lib/tauri/staff';
import { CONTAINS_RELATION_TYPES } from '../../lib/media/sagaTypes';
import { readUserFavorites, syncFavorites } from '../../lib/tauri/favorites';
import { fetchFollowedFriendsScores, type FriendScore } from '../../lib/anilist/friends';
import { mergePlatformVersions } from '../../lib/media/mapper-utils';
import { sanitizeHtml } from '../../lib/shared/sanitize-html';
import { ANILIST_TYPES } from '../../lib/constants/media';

// Breaks a "Prefix: Rest" relation title onto two lines after the colon
// (e.g. "Alan Wake II: The Lake House") instead of letting it wrap wherever
// it happens to run out of width — titles without a colon render unchanged.
function splitTitleAfterColon(title: string): ReactNode {
  const colonIdx = title.indexOf(':');
  if (colonIdx === -1) return title;
  return <>{title.slice(0, colonIdx + 1)}<br />{title.slice(colonIdx + 1).trim()}</>;
}

// ── StarRating ─────────────────────────────────────────────────────────────

function StarRating({
  rating,
  onRate,
}: {
  rating: number;           // 0-10 DB scale
  onRate: (stars: number) => void;  // 0.5-5 display scale
}) {
  const [hover, setHover] = useState<number | null>(null);
  const display = hover ?? dbRatingToStars5(rating);

  return (
    <div className="media-library-rating" onMouseLeave={() => setHover(null)}>
      {[1, 2, 3, 4, 5].map(v => {
        const isFull = display >= v;
        const isHalf = !isFull && display >= v - 0.5;

        return (
          <div key={v} className="star-container">
            <svg className="star-icon star-empty" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path d={STAR_PATH} />
            </svg>
            <div
              className="star-filled-wrap page-star-fill"
              style={{ width: isFull ? '100%' : isHalf ? '50%' : '0%' }}
            >
              <svg className="star-icon star-filled" viewBox="0 0 24 24" fill="currentColor">
                <path d={STAR_PATH} />
              </svg>
            </div>
            <button
              type="button"
              className="star-zone zone-left"
              aria-label={`${v - 0.5} estrellas`}
              onMouseEnter={() => setHover(v - 0.5)}
              onClick={() => onRate(v - 0.5)}
            />
            <button
              type="button"
              className="star-zone zone-right"
              aria-label={`${v} estrellas`}
              onMouseEnter={() => setHover(v)}
              onClick={() => onRate(v)}
            />
          </div>
        );
      })}
    </div>
  );
}

// ── StatusDropdown ─────────────────────────────────────────────────────────

function StatusDropdown({
  status,
  progressStatus,
  progressLabel,
  onChange,
  t,
}: {
  status: string;
  progressStatus: string;
  progressLabel: string;
  onChange: (next: string) => void;
  t: Translations['media'];
}) {
  const te = t.editor;
  const trayButtons = [
    { s: 'planning',     label: te.status_planning },
    { s: progressStatus, label: progressLabel },
    { s: 'completed',    label: te.status_completed },
    { s: 'paused',       label: te.status_paused },
    { s: 'dropped',      label: te.status_dropped },
  ];

  return (
    <div className="media-status-dropdown-container">
      <button
        className={`status-dropdown-trigger${status ? ` text-${status}` : ''}`}
        aria-label={t.change_status_aria}
      >
        <IconTrayStatus status={status} />
      </button>
      <div className="status-dropdown-tray">
        {trayButtons.map(btn => (
          <button
            key={btn.s}
            type="button"
            className={`tray-status-btn${status === btn.s ? ' active' : ''}`}
            data-status={btn.s}
            title={btn.label}
            onClick={e => {
              e.stopPropagation();
              onChange(status === btn.s ? '' : btn.s);
            }}
          >
            <IconTrayStatus status={btn.s} />
          </button>
        ))}
      </div>
    </div>
  );
}

// ── SectionTabs ────────────────────────────────────────────────────────────
// Shared "tabs vs. plain label" section header — a section's label becomes a
// row of switchable tabs once there's more than one thing to show (Related/
// Editions/Recommended, Personajes/Staff), falling back to a single static
// label + line otherwise. `tabs` must already be pre-filtered to only the
// ones actually visible right now (a tab always renders once included).

interface SectionTab {
  key: string;
  label: string;
  active: boolean;
  onClick: () => void;
}

function SectionTabs({ tabs, fallbackLabel }: { tabs: SectionTab[]; fallbackLabel: string }) {
  if (tabs.length === 0) {
    return (
      <>
        <p className="section-label">{fallbackLabel}</p>
        <div className="media-section-header-line" />
      </>
    );
  }
  return (
    <>
      {tabs.map((tab, i) => (
        <Fragment key={tab.key}>
          <button
            type="button"
            className={`section-label section-label--tab${tab.active ? ' active' : ''}`}
            onClick={tab.onClick}
          >
            {tab.label}
          </button>
          <div className={`media-section-header-line${i < tabs.length - 1 ? ' media-section-header-line--short' : ''}`} />
        </Fragment>
      ))}
    </>
  );
}

// ── MediaPage ──────────────────────────────────────────────────────────────

interface Props {
  i18n: Pick<Translations, 'media' | 'discord'>;
  // Renders a supplied MediaPageData instead of fetching (used by the PR
  // preview modal to show a proposal's simulated result). previewMode also
  // hides every write-triggering control (rating, status, edit/PR buttons).
  previewData?: MediaPageData;
  previewMode?: boolean;
}

export default function MediaPage({ i18n, previewData, previewMode = false }: Props) {
  const t  = i18n;
  const tm = t.media;

  // Estado para el ID actual de la obra
  const [currentId, setCurrentId] = useState('');
  const [pageState, setPageState] = useState<'loading' | 'error' | 'ready'>('loading');
  const [isFetchingFull,     setIsFetchingFull]     = useState(false);
  const [data,               setData]               = useState<MediaPageData | null>(null);
  const [showEditor,         setShowEditor]         = useState(false);
  const [showSaga,           setShowSaga]           = useState(false);
  const [showPrEditor,       setShowPrEditor]       = useState(false);
  const [relationPage,       setRelationPage]       = useState(1);
  const [relationsTab,       setRelationsTab]       = useState<'related' | 'recommended' | 'editions'>('related');
  const [characterPage,      setCharacterPage]      = useState(1);
  const [charTab,            setCharTab]            = useState<'characters' | 'staff'>('characters');
  const [friendsScores,      setFriendsScores]      = useState<FriendScore[]>([]);
  const [friendsLoading,     setFriendsLoading]     = useState(false);
  const [retryingSync,       setRetryingSync]       = useState(false);
  const [ratingSystem,       setRatingSystem]       = useState<RatingSystem>(getActiveRatingSystem());
  const [savedToast,         setSavedToast]         = useState<'hidden' | 'visible' | 'leaving'>('hidden');
  const [isFavorited,        setIsFavorited]        = useState(false);
  const savedToastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const usersScrollRef = useRef<HTMLDivElement | null>(null);
  const usersGridRef = useRef<HTMLDivElement | null>(null);
  const titleRef = useAutoShrinkTitle(data?.titleMain);
  const descriptionRef = useRef<HTMLDivElement>(null);
  const [descriptionOverflows, setDescriptionOverflows] = useState(false);

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

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const navs = window.performance.getEntriesByType("navigation") as PerformanceNavigationTiming[];
      if (navs.length > 0 && navs[0].type === 'reload') {
        // Was checking for 'media_data:'/'cached_saga:' — stale key prefixes
        // from before media-cache.ts's cache was renamed/versioned to
        // CACHE_PREFIX ('media_cache_v3:'). Neither ever matched, so this
        // purge-on-reload safety net has been a silent no-op.
        for (let i = sessionStorage.length - 1; i >= 0; i--) {
          const key = sessionStorage.key(i);
          if (key && key.startsWith(CACHE_PREFIX)) {
            sessionStorage.removeItem(key);
          }
        }
      }
    }
  }, []);

  useEffect(() => {
    syncActiveRatingSystem().then(setRatingSystem);
  }, []);

  // Caps the Usuarios grid to exactly 3 rows — computed purely from the
  // grid's own box width via ResizeObserver, never by measuring/counting
  // child cards. Every previous version of this effect keyed off the card
  // count (via the friendsScores dependency, then a MutationObserver on the
  // grid's children) and kept breaking the same way: whenever
  // fetchFollowedFriendsScores resolves fast enough (its own 10-minute
  // cache, or just a quick network response), the "how many cards are
  // there" signal and "did the effect actually re-measure yet" signal could
  // race, silently leaving max-height unset and showing the whole list
  // uncapped. A ResizeObserver on the container has nothing to race — it
  // fires once synchronously on observe() and then only on genuine width
  // changes, regardless of how or when the cards inside it change.
  useEffect(() => {
    const scrollEl = usersScrollRef.current;
    const gridEl = usersGridRef.current;
    if (!scrollEl || !gridEl) return;

    const PER_ROW = 5; // matches .media-users-grid's grid-template-columns
    const ROWS_VISIBLE = 3;

    const updateFade = () => {
      const atTop = scrollEl.scrollTop <= 0;
      const atBottom = scrollEl.scrollTop >= scrollEl.scrollHeight - scrollEl.clientHeight - 1;
      scrollEl.classList.toggle('at-top', atTop);
      scrollEl.classList.toggle('at-bottom', atBottom);
    };

    const recompute = () => {
      const cutoffIndex = ROWS_VISIBLE * PER_ROW;
      if (gridEl.children.length <= cutoffIndex) {
        scrollEl.style.maxHeight = '';
        updateFade();
        return;
      }
      const style = getComputedStyle(gridEl);
      const gap = parseFloat(style.columnGap || style.gap || '0') || 0;
      const paddingTop = parseFloat(style.paddingTop || '0') || 0;
      // Cards are square (aspect-ratio 1/1 on .media-user-avatar, and the
      // card itself is just that avatar plus a name/score line below it of
      // roughly fixed height) — cardWidth from the grid's own box width is
      // all that's needed, no child measurement required.
      const cardWidth = (gridEl.clientWidth - gap * (PER_ROW - 1)) / PER_ROW;
      const nameLineHeight = 34; // approx height of the star-rating line under each avatar
      const rowHeight = cardWidth + nameLineHeight;
      scrollEl.style.maxHeight = `${paddingTop + ROWS_VISIBLE * rowHeight + (ROWS_VISIBLE - 1) * gap}px`;
      updateFade();
    };

    recompute();
    scrollEl.addEventListener('scroll', updateFade);

    // ResizeObserver watches the grid's whole content-box, not just its
    // width — adding/removing cards changes its height too (more rows), so
    // this alone already re-fires recompute() on a card-count change; no
    // separate MutationObserver needed to catch that case.
    const resizeObserver = new ResizeObserver(recompute);
    resizeObserver.observe(gridEl);

    return () => {
      scrollEl.removeEventListener('scroll', updateFade);
      resizeObserver.disconnect();
    };
  }, [friendsScores]);

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
  }, [previewMode, previewData]);

  // Fetch page data cuando el currentId cambia
  useEffect(() => {
    if (previewMode) return;
    if (!currentId) return;

    const params = new URLSearchParams(window.location.search);
    const urlId = params.get('id') ?? '';
    
    // Solo inicializamos el esqueleto si la URL actual corresponde al juego que vamos a cargar
    if (urlId === currentId) {
      const skeletonTitle = params.get('t');
      const skeletonCover = params.get('c');

      if (skeletonTitle) {
        setData({
          externalId: currentId,
          type: currentId.split(':')[0],
          titleMain: skeletonTitle,
          cover: skeletonCover || undefined,
          bannerColor: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)',
          metaLines: [],
          stats: [],
          characters: [],
          relations: [],
        } as unknown as MediaPageData);
        setPageState('ready');
      } else {
        setPageState('loading');
        setData(null);
      }
    } else {
      setPageState('loading');
      setData(null);
    }
    
    setIsFetchingFull(true);
    setRelationPage(1);
    setRelationsTab('related');
    setCharacterPage(1);
    setCharTab('characters');
    setFriendsScores([]);

    let cancelled = false;

    // "Usuarios" (followed AniList friends' own scores for this exact entry)
    // only needs the numeric id from the URL — not any of the media data
    // itself — so it's fired here in parallel with the main fetch instead of
    // nested inside the `full` callback below, where it used to wait on the
    // live/catalog fetch to fully resolve first even though it has no real
    // dependency on that data.
    const [currentType, currentNumericIdStr] = currentId.split(':');
    if ((ANILIST_TYPES as readonly string[]).includes(currentType)) {
      const anilistId = parseInt(currentNumericIdStr, 10);
      if (anilistId) {
        setFriendsLoading(true);
        fetchFollowedFriendsScores(anilistId).then(scores => {
          if (!cancelled) setFriendsScores(scores);
        }).catch(() => {}).finally(() => {
          if (!cancelled) setFriendsLoading(false);
        });
      }
    }

    fetchMediaDataWithFallback(
      currentId,
      partial => {
        // A never-synced skeleton's first visit kicks off a full live fetch
        // that can take a moment — if the user has already navigated to a
        // different page (or back to this same one) by the time it resolves,
        // this late result must not overwrite whatever's on screen now.
        // Every other callback below already guards on `cancelled`; this one
        // and `full` below didn't, letting a stale fetch clobber the current
        // page's state instead of just being silently dropped.
        if (cancelled) return;
        setData(partial);
        setPageState('ready');
      },
      full    => {
        if (cancelled) return;
        setData(full);
        setPageState('ready');
        setIsFetchingFull(false);

        // Background fetches below resolve after the user may have already
        // navigated to a different media page — this guards every merge so
        // a late response can't clobber whatever's now on screen.
        const patchIfCurrent = (patch: Partial<MediaPageData>) => {
          setData(prev => (prev && prev.externalId === full.externalId) ? { ...prev, ...patch } : prev);
        };

        if (full.characters && full.characters.length > 0) {
          const isCastRole = full.type === 'movie' || full.type === 'series';
          const skeletonChars = mediaCharactersToSkeleton(full.characters, isCastRole);
          saveCharactersSkeleton(currentId, skeletonChars).catch(console.error);
        }
        if (full.staff && full.staff.length > 0) {
          saveStaffSkeleton(currentId, mediaStaffToSkeleton(full.staff)).catch(console.error);
        }

        // Transitive relations (remaster-of-an-expansion, port-of-a-remaster,
        // etc.) take a few extra sequential IGDB requests — fetch them after
        // the page is already showing instead of delaying first render.
        //
        // Only run this walk when the page being viewed is itself the true
        // base game — every other edition (remake/remaster/DLC/expansion/...)
        // only needs its own Fuente/parent relation (already set), and
        // walking IGDB's edition/content graph starting from a non-base
        // id kept surfacing siblings that don't belong to *this specific*
        // edition (e.g. a remake's page showing the original's remaster and
        // its non-remastered DLC, as if those were the remake's own).
        const isBaseGame = full.format === 'GAME' || full.format === 'VISUAL_NOVEL';
        const targetRelationsId = full.parentGame?.externalId || currentId;
        if (isBaseGame) {
          fetchExtraRelations(targetRelationsId, full).then(relations => {
            // `cancelled` covers "the user has since navigated away from this
            // page load" — skip the cache write too in that case, or a stale
            // response computed from *this* page's data could land in
            // whichever page's cache entry `targetRelationsId` now refers to
            // (a parent game's page, if the user navigated there), corrupting
            // it with relations that don't belong to it.
            if (cancelled || !relations) return;
            patchCachedRelations(targetRelationsId, relations);
            patchIfCurrent({ relations });
            // Transitive relations (remaster-of-an-expansion, etc.) used to
            // only ever land in the session cache — never media_relations —
            // so they rendered fine here but never showed up as an editable
            // relation in the collaborative catalog editor, which reads
            // straight from the DB. Persist them now that we know this
            // response still belongs to the current page.
            mergeAndPersistRelations(targetRelationsId, relations).catch(console.error);
          });
        }

        if (full.type === 'book') {
          fetchBookEditions(currentId, full.relations, tm.relations.EDITIONS).then(relations => {
            if (cancelled || !relations) return;
            patchCachedRelations(currentId, relations);
            patchIfCurrent({ relations });
            // Same gap the base-game relation walk used to have: caching
            // this in sessionStorage only meant editions rendered fine here
            // but never showed up as an editable relation in the
            // collaborative catalog editor, which reads straight from the DB.
            mergeAndPersistRelations(currentId, relations).catch(console.error);
          });
        }

        if (full.type === 'comic' || full.type === 'manga' || full.type === 'lnovel') {
          fetchComicIssues(currentId, full.relations, tm.relations.ISSUE, full.titleMain, full.titleRomaji || full.titleEnglish).then(({ relations, characters, genreDots, genreTagDots }) => {
            if (cancelled) return;

            // Full cast aggregated across every issue — supersedes the
            // first-issue-only sample the initial volume fetch showed.
            if (characters.length > 0) {
              const skeletonChars = mediaCharactersToSkeleton(characters, false);
              saveCharactersSkeleton(currentId, skeletonChars).catch(console.error);
              patchIfCurrent({ characters });
            }

            if (genreDots || genreTagDots) {
              updateCatalogGenres(currentId, genreDots ?? null, genreTagDots ?? null).catch(console.error);
              patchIfCurrent({ genreDots, genreTagDots });
            }

            if (!relations) return;
            patchCachedRelations(currentId, relations);
            patchIfCurrent({ relations });
            // Issues used to only ever land in the session cache — never
            // media_relations — so they never showed up as editable
            // relations in the collaborative catalog editor either.
            mergeAndPersistRelations(currentId, relations).catch(console.error);
          });
        }
      },
      ()      => { setPageState(prev => prev === 'ready' ? prev : 'error'); setIsFetchingFull(false); },
      ()      => cancelled,
    );

    return () => { cancelled = true; };
  }, [currentId, previewMode]);


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
  useEffect(() => {
    if (previewMode || !data) return;
    let cancelled = false;
    readUserFavorites().then(favs => {
      if (cancelled) return;
      setIsFavorited((favs[data.type] || []).includes(currentId));
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [currentId, data?.type, previewMode]);

  // The top/bottom fade on the synopsis should only appear when there's
  // actually more text than fits — otherwise a short synopsis gets its
  // first/last line faded out for no reason. Re-measured whenever the
  // description text itself changes.
  useEffect(() => {
    const el = descriptionRef.current;
    if (!el) { setDescriptionOverflows(false); return; }
    setDescriptionOverflows(el.scrollHeight > el.clientHeight + 1);
  }, [data?.description]);

  // Upsert catalog entry with the latest metadata from the API once we know the type
  // (library entry loading is handled by useLibraryEntry above)
  useEffect(() => {
    // data and currentId can briefly disagree when navigating quickly between
    // pages: currentId updates to the new page in the same render where
    // `data` still holds the *previous* page's fetch result (this effect and
    // the data-fetch effect above both run in the same commit, and the
    // fetch effect's setData(null) doesn't take effect until the next
    // render). Without this check, that stale `data` gets upserted under the
    // new currentId's row — e.g. quickly opening MGS3 then MGS2 could leave
    // MGS3's catalog entry overwritten with MGS2's data.
    if (previewMode || !data?.type || !currentId || data.externalId !== currentId) return;

    saveCatalogEntry(mapMediaDataToCatalogEntry(data, currentId)).catch(() => {});
  // Re-run when bannerImage/authors changes so partial→full transition saves the banner URL and authors to catalog.
  // currentId is included so navigating between two items of the same type (and same
  // transient bannerImage state) still re-fetches the library entry for the new item.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentId, data?.type, data?.bannerImage, data?.authors, previewMode]);

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

  // Manual "retry sync" — calls fetchMediaData directly instead of
  // fetchMediaDataWithFallback, which still gates its own live fetch behind
  // needsResync()/sync_state; that used to make this button a no-op
  // whenever the entry wasn't actually due yet (sync_state's backoff can
  // push that out to months on a title with a couple of past failures),
  // silently redisplaying the same stale local data instead of the fresh
  // fetch the button promises.
  const handleRetrySync = useCallback(() => {
    if (!currentId || retryingSync) return;
    setRetryingSync(true);
    invalidateCachedMediaData(currentId);
    fetchMediaData(currentId).then(fresh => {
      if (fresh) setData(fresh);
    }).finally(() => setRetryingSync(false));
  }, [currentId, retryingSync]);

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
    const draft = updateLocal({ status: next || null });
    try {
      const saved = await saveLibraryEntry(draft);
      applySaved(saved);
    } catch (e) {
      console.error('Failed to save status:', e);
      rollback();
    }
  }, [updateLocal, applySaved, rollback]);

  const handleRate = useCallback(async (stars: number) => {
    const dbRating = stars * 2;
    const nextRating = libRating === dbRating ? 0 : dbRating;
    const draft = updateLocal({ rating: nextRating || null });
    try {
      const saved = await saveLibraryEntry(draft);
      applySaved(saved);
    } catch (e) {
      console.error('Failed to save rating:', e);
      rollback();
    }
  }, [libRating, updateLocal, applySaved, rollback]);

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

  // ── States: loading / error ──────────────────────────────────────────────

  if (pageState === 'loading') {
    return <div className="media-loading"><div className="spinner" /></div>;
  }
  if (pageState === 'error' || !data) {
    return <div className="media-error"><span>{tm.not_found}</span></div>;
  }

  // ── Ready ────────────────────────────────────────────────────────────────

  // Only true expansions/bundled editions get redirected to their base game
  // and blocked from being logged separately — remakes/remasters are their
  // own standalone releases and stay fully trackable in the library.
  const isBlockedEdition = !!data.parentGame && (data.format === 'EXPANSION' || data.format === 'EXPANDED_GAME');
  // A bundle (e.g. "The Great Ace Attorney Chronicles") isn't a playable
  // title on its own — its contained works are — so it gets the same
  // "can't be logged/edited here" treatment as a blocked edition, just with
  // its own banner text instead of "is a version of {title}" (a bundle
  // doesn't have one single parent to point back to). Detected from having
  // at least two CONTAINS (EPISODE) relations of its own rather than from
  // `data.format === 'BUNDLE'` — an already-cataloged container can be stuck
  // with a stale format from before that value existed (persistToCatalog
  // preserves an existing format rather than recomputing it), so the
  // relation itself is the only reliable signal.
  const isBundle = data.relations.filter(r => !!r.relationType && CONTAINS_RELATION_TYPES.includes(r.relationType)).length >= 2;
  const isUneditable = isBlockedEdition || isBundle;
  const bannerStyle = !data.bannerImage
    ? ({ '--banner-color': data.bannerColor } as React.CSSProperties)
    : undefined;
  const isComicOrHasIssues = data.type === 'comic' || (Array.isArray(data.relations) && data.relations.some(r => r.relationType === 'ISSUE'));
  const editionsLabel = isComicOrHasIssues ? tm.relations.ISSUE : tm.relations.EDITIONS;
  const editionsRelationType = isComicOrHasIssues ? 'ISSUE' : 'EDITIONS';
  const {
    related: relatedRelations,
    recommended: recommendedRelations,
    editions: editionRelations,
  } = bucketRelations(data.relations, data.format, editionsRelationType);
  const hasRecommendedRelations = recommendedRelations.length > 0;
  const hasEditionRelations     = editionRelations.length > 0;
  const hasTabs = hasRecommendedRelations || hasEditionRelations;
  const visibleRelations = relationsTab === 'recommended'
    ? recommendedRelations
    : relationsTab === 'editions'
    ? editionRelations
    : relatedRelations;
  const pageSize = relationsTab === 'recommended' ? 8 : 12;
  const CHARACTER_PAGE_SIZE = 12;
  const hasStaff = !!(data.staff && data.staff.length > 0);
  const activeCharList = charTab === 'staff' ? (data.staff ?? []) : data.characters;
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
      {!previewMode && showSaga && (
        <SagaViewerModal externalId={currentId} i18n={tm} onClose={() => setShowSaga(false)} />
      )}
      {!previewMode && showPrEditor && (
        <PrEditorModal
          externalId={currentId}
          onClose={() => setShowPrEditor(false)}
          onSaved={() => {
            // Reload page data to reflect saved changes
            fetchMediaDataWithFallback(
              currentId,
              partial => setData(partial),
              full => setData(full),
              () => {}
            );
          }}
        />
      )}

      {/* Hero */}
      <div className={`media-hero${data.type === 'game' || data.type === 'vnovel' ? ' media-hero--game' : ''}`}>
        <div
          className={data.bannerImage ? 'media-banner' : 'media-banner media-banner--color'}
          style={bannerStyle}
        >
          {data.bannerImage && (
            <img className="media-banner-img" src={data.bannerImage} alt="" loading="lazy" />
          )}
        </div>

        <div className="media-banner-badges-container">
          {data.dateBadge && (
            <div className="media-banner-date-badge">{data.dateBadge}</div>
          )}
          {!previewMode && (
            <button
              type="button"
              className="media-banner-pr-btn"
              onClick={() => setShowPrEditor(true)}
              title={tm.propose_github_changes}
            >
              <IconPlus />
            </button>
          )}
          {!previewMode && (
            <button
              type="button"
              className={`media-banner-pr-btn${retryingSync ? ' media-banner-pr-btn--spinning' : ''}`}
              onClick={handleRetrySync}
              disabled={retryingSync}
              title={tm.retry_sync}
            >
              <IconRefresh />
            </button>
          )}
        </div>
        {data.companies?.find(c => c.role === 'developer') && (
          <div className="media-banner-developer-badge">{data.companies.find(c => c.role === 'developer')!.name}</div>
        )}

        <div className="media-hero-body">
          {/* Izquierda: títulos */}
          <div className="media-hero-left">
            <h1 className="media-title-main" ref={titleRef}>{data.titleMain}</h1>
            {/* Prefer the native-script title (Japanese kanji/kana, ...) —
                fall back to the romaji title only when it's missing and
                actually differs from the main heading above (titleMain is
                usually the romaji itself, so showing it again as a subtitle
                would just repeat the same text). Both come straight from the
                catalog row (title_native/title_romaji), no live fetch needed. */}
            {data.titleNative
              ? <p className="media-title-native">{data.titleNative}</p>
              : (data.titleRomaji && data.titleRomaji !== data.titleMain)
                ? <p className="media-title-native">{data.titleRomaji}</p>
                : null}
            {data.titleEnglish && <p className="media-title-english">{data.titleEnglish}</p>}
          </div>

          {/* Centro: cover + widget de biblioteca */}
          <div className="media-cover-column">
            {!previewMode && data.hasSaga && (
              <button type="button" className="media-saga-btn" onClick={() => setShowSaga(true)}>
                <IconLayers size={14} />
                {tm.saga_button}
              </button>
            )}
            <div className="media-cover-frame">
            <div
              className={`media-cover-wrap${inLibrary ? ' in-library' : ''}${isUneditable ? ' is-edition' : ''}${previewMode ? ' is-preview' : ''}`}
              role={previewMode ? undefined : 'button'}
              tabIndex={previewMode ? undefined : 0}
              aria-label={isBlockedEdition
                ? tm.is_version_of.replace('{title}', data.parentGame!.title)
                : isBundle
                ? tm.is_bundle
                : tm.add_to_library.replace('\n', ' ')}
              onClick={() => {
                if (previewMode) return;
                if (isBlockedEdition) {
                  window.location.href = `/media?id=${encodeURIComponent(data.parentGame!.externalId)}&openEditor=true&subId=${encodeURIComponent(currentId)}`;
                  return;
                }
                if (isBundle) return;
                handleCoverClick();
              }}
              onKeyDown={e => !previewMode && (e.key === 'Enter' || e.key === ' ') && (
                isBlockedEdition
                  ? (window.location.href = `/media?id=${encodeURIComponent(data.parentGame!.externalId)}&openEditor=true&subId=${encodeURIComponent(currentId)}`)
                  : isBundle
                  ? undefined
                  : handleCoverClick()
              )}
            >
              {data.cover && (
                <img className="media-cover-img" src={data.cover} alt={data.titleMain} />
              )}
              <div className="media-cover-overlay">
                <div className="media-cover-overlay-inner">
                  {isBlockedEdition ? (
                    <span className="media-cover-overlay-label">
                      {tm.is_version_of.replace('{title}', data.parentGame!.title)}
                    </span>
                  ) : isBundle ? (
                    <span className="media-cover-overlay-label">{tm.is_bundle}</span>
                  ) : (
                    <>
                      <span className="media-cover-overlay-icon">
                        {inLibrary ? <IconCheck size={22} strokeWidth={2.5} /> : <IconPlus size={22} strokeWidth={2.5} />}
                      </span>
                      <span
                        className="media-cover-overlay-label"
                        dangerouslySetInnerHTML={{
                          __html: (inLibrary ? tm.in_library : tm.add_to_library).replace('\n', '<br>'),
                        }}
                      />
                    </>
                  )}
                </div>
              </div>
            </div>
              {!previewMode && (
                // Same dual write MediaEditorModal's own heart button makes
                // on save (saveLibraryEntry's is_favorite column, then
                // syncFavorites for the separate favorites list) — this
                // started bundle-only (no library entry/editor of its own to
                // hold that button at all) doing just the syncFavorites half,
                // but favoriting straight from the cover is useful for every
                // media type, and needs the same is_favorite write the editor
                // makes or whatever elsewhere treats that column as the
                // source of truth never sees it. handleEditorSaved/Deleted
                // keep isFavorited in sync with the editor's own toggle too.
                // Lives outside .media-cover-wrap (not inside it) specifically
                // so it can straddle the cover's own bottom edge — that
                // wrap's overflow:hidden (it clips its own hover overlay)
                // would otherwise clip half the button off.
                <button
                  type="button"
                  className={`media-cover-favorite-btn${isFavorited ? ' active' : ''}`}
                  onClick={e => {
                    e.stopPropagation();
                    handleToggleFavorite();
                  }}
                  title={tm.editor.favorite}
                >
                  <IconHeart filled={isFavorited} size={18} />
                </button>
              )}
            </div>

            {!previewMode && !isUneditable && (
            <div className="media-library-widget-box">
              <div className="media-library-row-horizontal">
                <StatusDropdown
                  status={libStatus}
                  progressStatus={data.progressStatus}
                  progressLabel={data.progressLabel}
                  onChange={handleStatusChange}
                  t={tm}
                />
                <StarRating rating={libRating} onRate={handleRate} />
              </div>
            </div>
            )}
          </div>

          {/* Derecha: géneros + meta */}
          <div className="media-hero-right">
            {(data.genreDots || data.genreTagDots) && (
              <div className="media-genres-row">
                {data.genreDots    && <span className="media-genres-dots">{data.genreDots}</span>}
                {data.genreTagDots && <span className="media-genres-tags">{data.genreTagDots}</span>}
              </div>
            )}
            {data.metaLines?.[0] && <p className="media-studios-label">{data.metaLines[0]}</p>}
            {data.metaLines?.[1] && <p className="media-cover-meta">{data.metaLines[1]}</p>}
            {data.metaLines?.[2] && <p className="media-cover-meta">{data.metaLines[2]}</p>}
          </div>
        </div>
      </div>

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
              <div
                ref={descriptionRef}
                className={`media-description-text${descriptionOverflows ? ' has-overflow' : ''}`}
                dangerouslySetInnerHTML={{ __html: sanitizeHtml(data.description) }}
              />
            </>
          )}
        </div>

        {/* Relacionados — header bar always renders (even with zero
            relations) so this column isn't just blank space next to
            Sinopsis/Datos; only the grid+pagination are conditional. */}
        <div className="media-col-related">
          <div className="media-section-header-row">
            {/* TMDB recommendations ride in the same list as real
                relations (saga/adaptation/etc) — when both are present,
                each label becomes a tab switching which subset the grid
                below shows, instead of mixing recommendations into
                "Related". */}
            <SectionTabs
              fallbackLabel={tm.section_related}
              tabs={hasTabs ? [
                { key: 'related', label: tm.section_related, active: relationsTab === 'related', onClick: () => { setRelationsTab('related'); setRelationPage(1); } },
                ...(hasEditionRelations ? [{ key: 'editions', label: editionsLabel, active: relationsTab === 'editions', onClick: () => { setRelationsTab('editions'); setRelationPage(1); } }] : []),
                ...(hasRecommendedRelations ? [{ key: 'recommended', label: tm.relations.RECOMMENDATION, active: relationsTab === 'recommended', onClick: () => { setRelationsTab('recommended'); setRelationPage(1); } }] : []),
              ] : []}
            />
            {data.storeLinks && data.storeLinks.length > 0 && (
              <MediaStoreLinks links={data.storeLinks} />
            )}
          </div>
          {visibleRelations.length > 0 && (
            <>
              <div className="media-relations-grid">
                {visibleRelations
                  .slice((relationPage - 1) * pageSize, relationPage * pageSize)
                  .map((r, i) => {
                    // No url (manga's ComicVine issues — see comic-issues.ts) means
                    // purely visual, not a real navigable entry.
                    const Wrapper = r.url ? 'a' : 'div';
                    return (
                      <Wrapper
                        key={r.url ?? `${r.typeLabel}-${r.title}-${i}`}
                        href={r.url}
                        className={`media-relation-card${r.url ? '' : ' media-relation-card--static'}`}
                      >
                        <div className="media-relation-bg-layer">
                          {r.cover && <img src={r.cover} alt="" loading="lazy" />}
                        </div>
                        <div className="media-relation-card-overlay" />
                        <span className="media-relation-type">{r.typeLabel}</span>
                        <div className="media-relation-card-content">
                          <div className="media-relation-thumb">
                            {r.cover && <img src={r.cover} alt={r.title} loading="lazy" />}
                          </div>
                          <div className="media-relation-info">
                            <span className="media-relation-title">{splitTitleAfterColon(r.title)}</span>
                          </div>
                        </div>
                      </Wrapper>
                    );
                  })}
              </div>
              {visibleRelations.length > pageSize && (
                <Pagination
                  currentPage={relationPage}
                  totalPages={Math.ceil(visibleRelations.length / pageSize)}
                  onChange={setRelationPage}
                />
              )}
            </>
          )}
        </div>

        {/* Datos — always rendered, even with no stats/authors, since the
            link to the source page (MediaSourceLink) can always be built
            from data.source/sourceUrl regardless of whether anything else
            here has data. */}
          <div className="media-col-stats">
                <div className="media-section-header-row">
                  <p className="section-label">{tm.section_data}</p>
                  <div className="media-section-header-line" />
                  <MediaSourceLink source={data.source} sourceUrl={data.sourceUrl} />
                </div>

                {data.authors && data.authors.length > 0 && (
                  <div className="media-authors-box">
                    <div className="media-authors-list">
                      {data.authors.map((auth, idx) => (
                        <div key={idx} className="media-author-pill">
                          {auth.image ? (
                            <img src={auth.image} alt={auth.name} className="media-author-avatar" />
                          ) : (
                            <div className="media-author-avatar media-author-avatar--placeholder">
                              {auth.name.charAt(0).toUpperCase()}
                            </div>
                          )}
                          <div className="media-author-info">
                            {auth.url ? (
                              <span
                                className="media-author-name media-author-name--link"
                                onClick={() => (auth.url!.startsWith('http') ? openLink(auth.url!) : (window.location.href = auth.url!))}
                              >
                                {auth.name}
                              </span>
                            ) : (
                              <span className="media-author-name">{auth.name}</span>
                            )}
                            {auth.role && <span className="media-author-role">{auth.role}</span>}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="media-stats-list">
                  {data.stats
                    .filter(s => {
                      if (!data.authors || data.authors.length === 0) return true;
                      const labelLower = s.label.toLowerCase();
                      const isAuthorStat = labelLower.includes('autor') ||
                        labelLower.includes('author') ||
                        labelLower.includes('creator') ||
                        labelLower.includes('story') ||
                        labelLower.includes('director');
                      return !isAuthorStat;
                    })
                    .map((s, i) => (
                      s.isScore ? (
                        <div key={i} className="media-stat-item media-stat-item--score">
                          <span
                            title={`${formatAverageScore(Number(s.value), ratingSystem)}${averageScoreSuffix(ratingSystem)}`}
                            dangerouslySetInnerHTML={{ __html: formatRatingHtml(Number(s.value), ratingSystem, 'media-stat-score-value') }}
                          />
                        </div>
                      ) : s.label2 ? (
                        <div key={i} className="media-stat-item media-stat-item--split">
                          <span className="media-stat-col">
                            <span className="media-stat-label">{s.label}</span>
                            <span className="media-stat-value">{s.value}</span>
                          </span>
                          <span className="media-stat-divider" />
                          <span className="media-stat-col">
                            <span className="media-stat-label">{s.label2}</span>
                            <span className="media-stat-value">{s.value2}</span>
                          </span>
                        </div>
                      ) : (
                        <div key={i} className="media-stat-item">
                          <span className="media-stat-label">{s.label}</span>
                          <span className="media-stat-value">{s.value}</span>
                        </div>
                      )
                    ))}

                  {data.platforms && data.platforms.length > 0 && (
                    <div className="media-stat-item media-stat-item--platforms">
                      <span className="media-stat-label">{tm.stat_platforms}</span>
                      <span className="media-stat-divider" />
                      <span className="media-stat-value media-stat-platforms-value">
                        {mergePlatformVersions(data.platforms).map((p, i) => (
                          <span key={i}>{p}</span>
                        ))}
                      </span>
                    </div>
                  )}
                </div>
          </div>
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
            <div className={`media-chars-section${!showUsers ? ' media-chars-section--full' : ''}`}>
              <div className="media-section-header-row">
                {/* Staff (director, writer, composer, ...) rides the same
                    grid as Personajes, switched via a tab — same pattern as
                    Related/Editions/Recommended above. Only shown when the
                    provider actually returned staff data (AniList/TMDB). */}
                <SectionTabs
                  fallbackLabel={tm.section_characters}
                  tabs={hasStaff ? [
                    { key: 'characters', label: tm.section_characters, active: charTab === 'characters', onClick: () => { setCharTab('characters'); setCharacterPage(1); } },
                    { key: 'staff', label: tm.section_staff, active: charTab === 'staff', onClick: () => { setCharTab('staff'); setCharacterPage(1); } },
                  ] : []}
                />
              </div>
              <div className="media-chars-grid">
                {activeCharList
                  .slice((characterPage - 1) * CHARACTER_PAGE_SIZE, characterPage * CHARACTER_PAGE_SIZE)
                  .map((c, i) => {
                    // Characters have their own page; staff (director, writer,
                    // composer, ...) route to the author page instead — same
                    // id shape MediaAuthor cards already link to elsewhere.
                    // No href at all (rather than "#") when c.id is missing —
                    // an <a> without href isn't a link, so the card just
                    // stops being clickable instead of navigating nowhere.
                    const href = c.id
                      ? (charTab === 'staff' ? `/author?id=${encodeURIComponent(c.id)}` : `/character?id=${encodeURIComponent(c.id)}`)
                      : undefined;
                    return (
                  <a key={i} href={href} className="media-char-card">
                    <div className="media-char-bg-layer">
                      {c.image && <img src={c.image} alt="" loading="lazy" />}
                    </div>
                    <div className="media-char-card-overlay" />
                    <div className="media-char-card-content">
                      <div className="media-char-thumb">
                        {c.image && <img src={c.image} alt={c.name} loading="lazy" />}
                      </div>
                      <div className="media-char-info">
                        {c.role && <span className="media-char-role">{c.role}</span>}
                        <span className="media-char-name">{c.name}</span>
                      </div>
                    </div>
                  </a>
                    );
                  })}
              </div>
              {activeCharList.length > CHARACTER_PAGE_SIZE && (
                <Pagination
                  currentPage={characterPage}
                  totalPages={Math.ceil(activeCharList.length / CHARACTER_PAGE_SIZE)}
                  onChange={setCharacterPage}
                />
              )}
            </div>
          )}

          {showUsers && (
            <div className="media-users-section">
              <div className="media-section-header-row">
                <p className="section-label">{tm.section_users}</p>
                <div className="media-section-header-line" />
              </div>
              <div className="media-users-grid-scroll" ref={usersScrollRef}>
                <div className="media-users-grid" ref={usersGridRef}>
                  {friendsLoading && friendsScores.length === 0
                    // 5 per row × 3 rows — matches PER_ROW/ROWS_VISIBLE in the
                    // fade/cutoff effect above, so the skeleton fills exactly
                    // the same 3 rows the real grid caps itself to (instead of
                    // a half-filled row that looked broken).
                    ? Array.from({ length: 15 }).map((_, i) => (
                        <div key={i} className="media-user-card media-user-card--skeleton" />
                      ))
                    : friendsScores.map((f, i) => (
                    <div key={i} className="media-user-card" data-tooltip={f.name}>
                      <button
                        type="button"
                        className="media-user-avatar"
                        onClick={() => openLink(f.profileUrl)}
                        title={f.name}
                      >
                        {f.avatar
                          ? <img src={f.avatar} alt="" loading="lazy" />
                          : <div className="media-user-avatar-placeholder">{f.name[0]?.toUpperCase()}</div>}
                      </button>
                      {/* f.score is always 0-100 (POINT_100, see friends.ts) —
                          ÷10 to match this app's 0-10 DB rating scale before
                          formatting it per the user's own configured system.
                          formatRatingHtml already returns its own <span
                          class="media-user-score">, so no wrapper class here. */}
                      <span dangerouslySetInnerHTML={{ __html: formatRatingHtml(f.score / 10, ratingSystem, 'media-user-score') }} />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}
