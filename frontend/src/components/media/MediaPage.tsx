import { useState, useEffect, useRef, useCallback, Fragment, memo, useMemo } from 'react';
import { createPortal } from 'react-dom';
import type { ReactNode } from 'react';
import type { Translations } from '../../i18n/index';
import { fetchMediaData, fetchMediaDataWithFallback, fetchExtraRelations, fetchExtraCharacters, fetchBookEditions, fetchComicIssues, fetchComicCollectedEditions, fetchMediaEpisodes, fetchMediaThemes, patchCachedRelations, patchCachedCharacters, mergeAndPersistRelations, bucketRelations, mediaCharactersToSkeleton, mediaStaffToSkeleton, mapMediaDataToCatalogEntry, invalidateCachedMediaData, CACHE_PREFIX } from '../../lib/media/mediaService';
import { saveCatalogEntry, saveLibraryEntry, updateCatalogGenres, updateCatalogTotalCount, getCustomImagesMap, wrapAssetUrl, type FavoriteCustomImage } from '../../lib/tauri';
import type { LibraryEntry, MediaEpisode, MediaTheme } from '../../lib/tauri';
import type { MediaPageData } from '../../lib/media/types';
import { MediaEditorModal } from './MediaEditorModal';
import { SagaViewerModal } from './SagaViewerModal';
import { ThemePreviewCardVideo } from './ThemePreviewCardVideo';
import { prefetchSagaData } from '../../lib/media/sagaData';
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
import { parseStatSectionLabel, StatSectionTracker } from '../../lib/shared/stat-sections';
import { saveCharactersSkeleton } from '../../lib/tauri/characters';
import { saveStaffSkeleton, getThemeVideoPath, cacheThemeVideo } from '../../lib/tauri/misc-commands';
import { getAnimePrequelEpisodeOffset } from '../../lib/media/anime-tmdb-match';
import { CONTAINS_RELATION_TYPES } from '../../lib/media/sagaTypes';
import { readUserFavorites, syncFavorites } from '../../lib/tauri/favorites';
import { fetchFollowedFriendsScores, type FriendScore } from '../../lib/anilist/friends';
import { mergePlatformVersions } from '../../lib/media/mapper-utils';
import { sanitizeHtml } from '../../lib/shared/sanitize-html';
import { ANILIST_TYPES } from '../../lib/constants/media';

function splitTitleAfterColon(title: string): ReactNode {
  const colonIdx = title.indexOf(':');
  if (colonIdx === -1) return title;
  return <>{title.slice(0, colonIdx + 1)}<br />{title.slice(colonIdx + 1).trim()}</>;
}

function formatEpisodeNumber(episodeNumber: number): string {
  if (episodeNumber < 0) {
    return `Sp${-episodeNumber}`;
  }
  return String(episodeNumber);
}

function formatThemeEpisodes(rawEpisodes: string | null | undefined, episodeOffset: number): string | null {
  if (!rawEpisodes) return null;
  const trimmed = rawEpisodes.trim();
  if (!trimmed) return null;
  if (episodeOffset <= 0) return trimmed;

  const nums = trimmed.match(/\b\d+\b/g);
  if (!nums || nums.length === 0) return trimmed;

  const firstNum = parseInt(nums[0], 10);
  if (firstNum > episodeOffset) return trimmed;

  return trimmed.replace(/\b\d+\b/g, m => String(parseInt(m, 10) + episodeOffset));
}

const EpisodeCard = memo(function EpisodeCard({ ep }: { ep: MediaEpisode }) {
  return (
    <div className="media-relation-card media-relation-card--static">
      <div className="media-relation-bg-layer media-episode-bg-layer">
        {ep.cover_url && <img src={ep.cover_url} alt="" loading="lazy" />}
      </div>
      <div className="media-relation-card-overlay" />
      <span className="media-relation-type">{`#${formatEpisodeNumber(ep.episode_number)}`}</span>
      <div className="media-relation-card-content">
        <div className="media-relation-info">
          <span className="media-relation-title">{ep.name ?? `#${formatEpisodeNumber(ep.episode_number)}`}</span>
        </div>
      </div>
    </div>
  );
});

const RelationCard = memo(function RelationCard({ relation }: { relation: any }) {
  const Wrapper = relation.url ? 'a' : 'div';
  return (
    <Wrapper
      href={relation.url}
      className={`media-relation-card${relation.url ? '' : ' media-relation-card--static'}`}
    >
      <div className="media-relation-bg-layer">
        {relation.cover && <img src={relation.cover} alt="" loading="lazy" />}
      </div>
      <div className="media-relation-card-overlay" />
      <span className="media-relation-type">{relation.typeLabel}</span>
      <div className="media-relation-card-content">
        <div className="media-relation-thumb">
          {relation.cover && <img src={relation.cover} alt={relation.title} loading="lazy" />}
        </div>
        <div className="media-relation-info">
          <span className="media-relation-title">{splitTitleAfterColon(relation.title)}</span>
        </div>
      </div>
    </Wrapper>
  );
});

interface CharacterCardProps {
  character: any;
  charTab: 'characters' | 'staff';
  customImagesMap: Map<string, FavoriteCustomImage>;
}

const CharacterCard = memo(function CharacterCard({ character: c, charTab, customImagesMap }: CharacterCardProps) {
  const href = c.id
    ? (charTab === 'staff' ? `/author?id=${encodeURIComponent(c.id)}` : `/character?id=${encodeURIComponent(c.id)}`)
    : undefined;
  const customImg = c.id ? customImagesMap.get(c.id) : undefined;
  const displayImg = customImg ? wrapAssetUrl(customImg.image_url) : c.image;

  return (
    <a href={href} className="media-char-card">
      <div className="media-char-bg-layer">
        {displayImg && <img src={displayImg} alt="" loading="lazy" />}
      </div>
      <div className="media-char-card-overlay" />
      <div className="media-char-card-content">
        <div className="media-char-thumb">
          {displayImg && <img src={displayImg} alt={c.name} loading="lazy" />}
        </div>
        <div className="media-char-info">
          {c.role && <span className="media-char-role">{c.role}</span>}
          <span className="media-char-name">{c.name}</span>
        </div>
      </div>
    </a>
  );
});

interface UserScoreCardProps {
  score: FriendScore;
  ratingSystem: RatingSystem;
}

const UserScoreCard = memo(function UserScoreCard({ score: f, ratingSystem }: UserScoreCardProps) {
  return (
    <div className="media-user-card" data-tooltip={f.name}>
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
      <span dangerouslySetInnerHTML={{ __html: formatRatingHtml(f.score / 10, ratingSystem, 'media-user-score') }} />
    </div>
  );
});

function ThemeCardItem({
  theme,
  onPlay,
  fallbackUrl,
}: {
  theme: MediaTheme;
  onPlay: () => void;
  fallbackUrl?: string;
}) {
  const [isHovered, setIsHovered] = useState(false);
  return (
    <div
      className={`media-relation-card media-relation-card--static media-theme-card${theme.video_url ? ' media-theme-card--playable' : ''}`}
      onClick={() => theme.video_url && onPlay()}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div className="media-relation-bg-layer media-theme-bg-layer">
        <ThemePreviewCardVideo
          externalId={theme.external_id}
          slug={theme.slug}
          src={theme.video_url ?? undefined}
          initialPreviewUrl={theme.preview_url ?? undefined}
          fallbackUrl={fallbackUrl}
          isHovered={isHovered}
        />
      </div>
      <div className="media-relation-card-overlay" />
      <span className={`media-relation-type media-theme-badge media-theme-badge--${theme.theme_type.toLowerCase()}`}>
        {theme.theme_type}{theme.sequence}
      </span>
      <div className="media-relation-card-content">
        <div className="media-relation-info">
          <span className="media-relation-title">{theme.song_title ?? `${theme.theme_type}${theme.sequence}`}</span>
          {theme.artists && <span className="media-theme-artist">{theme.artists}</span>}
        </div>
      </div>
    </div>
  );
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
  const [relationsTab,       setRelationsTab]       = useState<'related' | 'recommended' | 'editions' | 'episodes' | 'themes'>('related');
  const [episodes,           setEpisodes]           = useState<MediaEpisode[]>([]);
  const [themes,             setThemes]             = useState<MediaTheme[]>([]);
  const [playingTheme,       setPlayingTheme]       = useState<MediaTheme | null>(null);
  const [playingVideoSrc,    setPlayingVideoSrc]    = useState<string | null>(null);
  const [episodeOffset,      setEpisodeOffset]      = useState(0);
  const [characterPage,      setCharacterPage]      = useState(1);
  const [charTab,            setCharTab]            = useState<'characters' | 'staff'>('characters');
  const [customImagesMap,    setCustomImagesMap]    = useState<Map<string, FavoriteCustomImage>>(new Map());
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

  // Warms SagaViewerModal's saga-chain + story-arcs caches (lib/media/sagaData.ts)
  // as soon as the page is known to have a saga, instead of only starting
  // that fetch once the user clicks the Saga button — by then it's typically
  // already resolved, so opening the modal reads a cached result instantly.
  useEffect(() => {
    if (!previewMode && data?.hasSaga && currentId) prefetchSagaData(currentId);
  }, [previewMode, data?.hasSaga, currentId]);

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
      const nameLineHeight = 40; // height of the star-rating line under each avatar
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
    setEpisodes([]);
    setThemes([]);
    setPlayingTheme(null);
    setPlayingVideoSrc(null);
    setEpisodeOffset(0);
    setCharacterPage(1);
    setCharTab('characters');
    getCustomImagesMap().then(setCustomImagesMap).catch(() => {});
    setRelationsTab('related');

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
      (full, isFinal) => {
        if (cancelled) return;
        setData(full);
        setPageState('ready');
        // isFinal is false for a stub/local-data row that's about to be
        // followed by a background live resync (see fetchMediaDataWithFallback)
        // — the bottom progress bar must stay up through that resync, not
        // disappear the moment the mostly-empty stub renders.
        if (isFinal) setIsFetchingFull(false);

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

        // A cast over 50 (AniList's per-page cap) no longer blocks the page
        // itself — see fetchAniListDetail/fetchExtraCharacters — so the rest
        // of it is topped up here, after the page is already showing.
        if (full.charactersHasMore) {
          fetchExtraCharacters(currentId, full).then(characters => {
            if (cancelled || !characters) return;
            patchCachedCharacters(currentId, characters);
            patchIfCurrent({ characters, charactersHasMore: false });
            const isCastRole = full.type === 'movie' || full.type === 'series';
            saveCharactersSkeleton(currentId, mediaCharactersToSkeleton(characters, isCastRole)).catch(console.error);
          });
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
          fetchBookEditions(currentId, full.relations, tm.relations.EDITIONS).then(result => {
            if (cancelled || !result) return;
            const { relations, totalPages } = result;
            patchCachedRelations(currentId, relations);
            patchIfCurrent(totalPages !== null ? { relations, totalCount: totalPages } : { relations });
            // Same gap the base-game relation walk used to have: caching
            // this in sessionStorage only meant editions rendered fine here
            // but never showed up as an editable relation in the
            // collaborative catalog editor, which reads straight from the DB.
            mergeAndPersistRelations(currentId, relations).catch(console.error);
            // OpenLibrary has no page count on the Work itself, only on its
            // editions (see fetchBookEditions) — persisted here the same way
            // a comic's aggregated genres are, once this background fetch
            // actually finds one.
            if (totalPages !== null) updateCatalogTotalCount(currentId, totalPages).catch(console.error);
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

            if (relations) {
              patchCachedRelations(currentId, relations);
              patchIfCurrent({ relations });
              // Issues used to only ever land in the session cache — never
              // media_relations — so they never showed up as editable
              // relations in the collaborative catalog editor either.
              mergeAndPersistRelations(currentId, relations).catch(console.error);
            }

            // Chained (not a separate top-level fetch) so it builds off
            // whatever fetchComicIssues just resolved rather than racing it
            // — both would otherwise start from the same `full.relations`
            // snapshot and independently strip+append their own relation
            // type, so whichever finished last would silently wipe out the
            // other's additions.
            if (full.type === 'comic') {
              fetchComicCollectedEditions(currentId, relations ?? full.relations, tm.relations.EDITIONS, full.titleMain, full.totalCount, full.releaseYear).then(editionRelations => {
                if (cancelled || !editionRelations) return;
                patchCachedRelations(currentId, editionRelations);
                patchIfCurrent({ relations: editionRelations });
                mergeAndPersistRelations(currentId, editionRelations).catch(console.error);
              });
            }
          });
        }

        if (full.type === 'anime' || full.type === 'series') {
          // totalCount_2 is already this series' season count (see
          // tmdb-mapper.ts) — passing it through skips fetchMediaEpisodes
          // re-fetching TMDB's full detail request a second time just to
          // read that one field back.
          fetchMediaEpisodes(currentId, false, full.type === 'series' ? full.totalCount_2 : undefined).then(eps => {
            if (cancelled || eps.length === 0) return;
            setEpisodes(eps);
          }).catch(console.error);
        }

        if (full.type === 'anime') {
          fetchMediaThemes(currentId).then(t => {
            if (cancelled || t.length === 0) return;
            setThemes(t);
          }).catch(console.error);
        }
      },
      ()      => { setPageState(prev => prev === 'ready' ? prev : 'error'); setIsFetchingFull(false); },
      ()      => cancelled,
    );

    return () => { cancelled = true; };
  }, [currentId, previewMode]);


  useEffect(() => {
    if (!playingTheme) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') {
        const idx = themes.findIndex(t => t.slug === playingTheme.slug);
        if (idx > 0) setPlayingTheme(themes[idx - 1]);
      } else if (e.key === 'ArrowRight') {
        const idx = themes.findIndex(t => t.slug === playingTheme.slug);
        if (idx >= 0 && idx < themes.length - 1) setPlayingTheme(themes[idx + 1]);
      } else if (e.key === 'Escape') {
        setPlayingTheme(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [playingTheme, themes]);

  useEffect(() => {
    if (!currentId) return;
    let cancelled = false;
    getAnimePrequelEpisodeOffset(currentId).then(off => {
      if (!cancelled && off > 0) setEpisodeOffset(off);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [currentId]);

  useEffect(() => {
    if (episodes.length > 0 && episodes[0].episode_number > 1) {
      setEpisodeOffset(episodes[0].episode_number - 1);
    }
  }, [episodes]);

  useEffect(() => {
    if (!playingTheme) {
      setPlayingVideoSrc(null);
      return;
    }
    let cancelled = false;
    setPlayingVideoSrc(playingTheme.video_url ?? null);

    getThemeVideoPath(playingTheme.external_id, playingTheme.slug).then(path => {
      if (cancelled) return;
      if (path) {
        setPlayingVideoSrc(wrapAssetUrl(path));
      } else if (playingTheme.video_url) {
        cacheThemeVideo(playingTheme.video_url, playingTheme.external_id, playingTheme.slug)
          .then(cachedPath => {
            if (!cancelled && cachedPath) {
              setPlayingVideoSrc(wrapAssetUrl(cachedPath));
            }
          })
          .catch(() => {});
      }
    }).catch(() => {});

    return () => { cancelled = true; };
  }, [playingTheme]);

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
    fetchMediaData(currentId, { refreshAniListTotalCount: true, refreshSourceAdaptation: true }).then(fresh => {
      if (fresh) {
        setData(fresh);
        if (fresh.characters && fresh.characters.length > 0) {
          const isCastRole = fresh.type === 'movie' || fresh.type === 'series';
          saveCharactersSkeleton(currentId, mediaCharactersToSkeleton(fresh.characters, isCastRole)).catch(console.error);
        }
        if (fresh.staff && fresh.staff.length > 0) {
          saveStaffSkeleton(currentId, mediaStaffToSkeleton(fresh.staff)).catch(console.error);
        }
        if (fresh.charactersHasMore) {
          fetchExtraCharacters(currentId, fresh).then(characters => {
            if (!characters) return;
            patchCachedCharacters(currentId, characters);
            setData(prev => (prev && prev.externalId === currentId) ? { ...prev, characters, charactersHasMore: false } : prev);
            const isCastRole = fresh.type === 'movie' || fresh.type === 'series';
            saveCharactersSkeleton(currentId, mediaCharactersToSkeleton(characters, isCastRole)).catch(console.error);
          });
        }
      }
      // Chained off the fresh fetch (not fired alongside it) so a series'
      // already-known season count (totalCount_2) can be passed through —
      // same duplicate-TMDB-detail-request avoidance as the main load
      // effect above, otherwise this ran its own full TMDB detail fetch in
      // parallel with the one fetchMediaData just made.
      // Forced (not the cache-checked default) so this also backfills a
      // series/anime that was saved before the Episodios tab existed — and
      // refreshes one that's already had episodes fetched but has since
      // aired new ones, which a plain revisit wouldn't do on its own.
      fetchMediaEpisodes(currentId, true, fresh?.type === 'series' ? fresh.totalCount_2 : undefined).then(eps => {
        if (eps.length > 0) setEpisodes(eps);
      }).catch(console.error);
      if (fresh?.type === 'anime') {
        fetchMediaThemes(currentId, true).then(t => {
          if (t.length > 0) setThemes(t);
        }).catch(console.error);
      }
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

  // Only certain edition types get redirected to their base game and blocked
  // from being logged separately. Expansions are allowed as independent entries
  // since they're typically sold and played separately (e.g., RE4 Separate Ways).
  const isBlockedEdition = !!data.parentGame && data.format !== 'EXPANSION';
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
  const hasEpisodes             = episodes.length > 0;
  const hasThemes               = themes.length > 0;
  const hasTabs = hasRecommendedRelations || hasEditionRelations || hasEpisodes || hasThemes;
  const visibleRelations = relationsTab === 'recommended'
    ? recommendedRelations
    : relationsTab === 'editions'
    ? editionRelations
    : relatedRelations;
  const pageSize = relationsTab === 'recommended' ? 8 : 12;
  // .media-relations-grid is a fixed 4-column grid — 3 rows worth per page.
  const EPISODE_PAGE_SIZE = 12;
  const CHARACTER_PAGE_SIZE = 12;
  const roleOrder = (role?: string) => {
    const normalizedRole = role?.toLowerCase().trim() || '';
    if (normalizedRole === 'main') return 0;
    if (normalizedRole === 'supporting') return 1;
    if (normalizedRole === 'background') return 2;
    return 3; // Unknown roles go last
  };

  const sortCharactersByRole = (chars: typeof data.characters) => {
    return [...chars].sort((a, b) => roleOrder(a.role) - roleOrder(b.role));
  };

  const hasStaff = !!(data.staff && data.staff.length > 0);
  const activeCharList = sortCharactersByRole(charTab === 'staff' ? (data.staff ?? []) : data.characters);
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
      {playingTheme && (() => {
        const currentThemeIdx = themes.findIndex(t => t.slug === playingTheme.slug);
        const prevTheme = currentThemeIdx > 0 ? themes[currentThemeIdx - 1] : null;
        const nextTheme = currentThemeIdx !== -1 && currentThemeIdx < themes.length - 1 ? themes[currentThemeIdx + 1] : null;
        const formattedEps = formatThemeEpisodes(playingTheme.episodes, episodeOffset);

        const handleNavigateToThemeEpisodes = (formatted: string) => {
          const match = formatted.match(/\b\d+\b/);
          if (match) {
            const targetEpNum = parseInt(match[0], 10);
            const targetIdx = episodes.findIndex(e => e.episode_number === targetEpNum);
            if (targetIdx !== -1) {
              setRelationPage(Math.floor(targetIdx / EPISODE_PAGE_SIZE) + 1);
            }
          }
          setRelationsTab('episodes');
          setPlayingTheme(null);
          setTimeout(() => {
            const section = document.querySelector('.media-relations-section');
            section?.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }, 100);
        };

        return createPortal(
          <div className="theme-player-overlay" onClick={() => setPlayingTheme(null)}>
            <div className="theme-player-container" onClick={e => e.stopPropagation()}>
              <button
                type="button"
                className="theme-player-nav theme-player-nav--prev"
                disabled={!prevTheme}
                onClick={() => prevTheme && setPlayingTheme(prevTheme)}
                aria-label="Anterior"
                title={prevTheme ? (prevTheme.song_title ?? `${prevTheme.theme_type}${prevTheme.sequence}`) : undefined}
              >
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="15 18 9 12 15 6" />
                </svg>
              </button>

              <div className="theme-player-modal">
                <button type="button" className="theme-player-close" onClick={() => setPlayingTheme(null)} aria-label="Close">×</button>
                <video
                  key={playingTheme.slug}
                  className="theme-player-video"
                  src={playingVideoSrc ?? undefined}
                  controls
                  autoPlay
                  preload="auto"
                />
                <div className="theme-player-info">
                  <span className={`media-theme-badge media-theme-badge--${playingTheme.theme_type.toLowerCase()}`}>
                    {playingTheme.theme_type}{playingTheme.sequence}
                  </span>
                  <div className="theme-player-text">
                    <span className="theme-player-title">{playingTheme.song_title ?? `${playingTheme.theme_type}${playingTheme.sequence}`}</span>
                    {playingTheme.artists && <span className="theme-player-artist">{playingTheme.artists}</span>}
                  </div>
                  {formattedEps && (
                    <button
                      type="button"
                      className={`theme-player-episodes${hasEpisodes ? ' theme-player-episodes--interactive' : ''}`}
                      onClick={() => hasEpisodes && handleNavigateToThemeEpisodes(formattedEps)}
                      title={hasEpisodes ? 'Ir a los episodios' : undefined}
                    >
                      {formattedEps.includes('-') || formattedEps.includes(',') ? 'Episodios ' : 'Episodio '}
                      {formattedEps}
                    </button>
                  )}
                </div>
              </div>

              <button
                type="button"
                className="theme-player-nav theme-player-nav--next"
                disabled={!nextTheme}
                onClick={() => nextTheme && setPlayingTheme(nextTheme)}
                aria-label="Siguiente"
                title={nextTheme ? (nextTheme.song_title ?? `${nextTheme.theme_type}${nextTheme.sequence}`) : undefined}
              >
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </button>
            </div>
          </div>,
          document.body,
        );
      })()}
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
                ...(hasEpisodes ? [{ key: 'episodes', label: tm.stat_episodes, active: relationsTab === 'episodes', onClick: () => { setRelationsTab('episodes'); setRelationPage(1); } }] : []),
                ...(hasThemes ? [{ key: 'themes', label: tm.section_themes, active: relationsTab === 'themes', onClick: () => { setRelationsTab('themes'); setRelationPage(1); } }] : []),
              ] : []}
            />
            {data.storeLinks && data.storeLinks.length > 0 && (
              <MediaStoreLinks links={data.storeLinks} />
            )}
          </div>
          {relationsTab === 'themes' ? (
            themes.length > 0 && (
              <>
                <div className="media-relations-grid">
                  {themes
                    .slice((relationPage - 1) * EPISODE_PAGE_SIZE, relationPage * EPISODE_PAGE_SIZE)
                    .map(t => (
                      <ThemeCardItem
                        key={t.slug}
                        theme={t}
                        onPlay={() => setPlayingTheme(t)}
                        fallbackUrl={data.bannerImage || data.cover}
                      />
                    ))}
                </div>
                {themes.length > EPISODE_PAGE_SIZE && (
                  <Pagination
                    currentPage={relationPage}
                    totalPages={Math.ceil(themes.length / EPISODE_PAGE_SIZE)}
                    onChange={setRelationPage}
                  />
                )}
              </>
            )
          ) : relationsTab === 'episodes' ? (
            episodes.length > 0 && (
              <>
                <div className="media-relations-grid">
                  {episodes
                    .slice((relationPage - 1) * EPISODE_PAGE_SIZE, relationPage * EPISODE_PAGE_SIZE)
                    .map(ep => (
                      <EpisodeCard key={`${ep.season_number}-${ep.episode_number}`} ep={ep} />
                    ))}
                </div>
                {episodes.length > EPISODE_PAGE_SIZE && (
                  <Pagination
                    currentPage={relationPage}
                    totalPages={Math.ceil(episodes.length / EPISODE_PAGE_SIZE)}
                    onChange={setRelationPage}
                  />
                )}
              </>
            )
          ) : visibleRelations.length > 0 && (
            <>
              <div className="media-relations-grid">
                {visibleRelations
                  .slice((relationPage - 1) * pageSize, relationPage * pageSize)
                  .map((r, i) => (
                    <RelationCard key={r.url ?? `${r.typeLabel}-${r.title}-${i}`} relation={r} />
                  ))}
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
                  {(() => {
                    const sectionTracker = new StatSectionTracker();
                    const filtered = data.stats.filter(s => {
                      if (!data.authors || data.authors.length === 0) return true;
                      const labelLower = s.label.toLowerCase();
                      const isAuthorStat = labelLower.includes('autor') ||
                        labelLower.includes('author') ||
                        labelLower.includes('creator') ||
                        labelLower.includes('story') ||
                        labelLower.includes('director');
                      return !isAuthorStat;
                    });

                    return filtered.map((s, i) => {
                      const { section, cleanLabel } = parseStatSectionLabel(s.label);
                      const sectionHeader = sectionTracker.next(section);

                      return (
                        <Fragment key={i}>
                          {sectionHeader && (
                            <div className="media-stat-section-header">{sectionHeader}</div>
                          )}
                          {s.isScore ? (
                            <div className="media-stat-item media-stat-item--score">
                              <span
                                title={`${formatAverageScore(Number(s.value), ratingSystem)}${averageScoreSuffix(ratingSystem)}`}
                                dangerouslySetInnerHTML={{ __html: formatRatingHtml(Number(s.value), ratingSystem, 'media-stat-score-value') }}
                              />
                            </div>
                          ) : s.label2 ? (
                            <div className="media-stat-item media-stat-item--split">
                              <span className="media-stat-col">
                                <span className="media-stat-label">{cleanLabel}</span>
                                <span className="media-stat-value">{s.value}</span>
                              </span>
                              <span className="media-stat-divider" />
                              <span className="media-stat-col">
                                <span className="media-stat-label">{s.label2}</span>
                                <span className="media-stat-value">{s.value2}</span>
                              </span>
                            </div>
                          ) : (
                            <div className="media-stat-item">
                              <span className="media-stat-label">{cleanLabel}</span>
                              <span className="media-stat-value">{s.value}</span>
                            </div>
                          )}
                        </Fragment>
                      );
                    });
                  })()}

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
                  .map((c, i) => (
                    <CharacterCard key={i} character={c} charTab={charTab} customImagesMap={customImagesMap} />
                  ))}
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
                    <UserScoreCard key={i} score={f} ratingSystem={ratingSystem} />
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
