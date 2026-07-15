import { useState, useEffect, useRef, useCallback } from 'react';
import type { Translations } from '../../i18n/index';
import { fetchMediaDataWithFallback, fetchExtraRelations, fetchBookEditions, fetchComicIssues, patchCachedRelations, mergeAndPersistRelations, sortMediaRelations } from '../../lib/media/mediaService';
import { saveCatalogEntry, saveLibraryEntry, updateCatalogGenres } from '../../lib/tauri';
import type { LibraryEntry } from '../../lib/tauri';
import type { MediaPageData } from '../../lib/media/types';
import { MediaEditorModal } from './MediaEditorModal';
import { SagaViewerModal } from './SagaViewerModal';
import { PrEditorModal } from './PrEditorModal';
import { STAR_PATH } from '../../lib/media/constants';
import { dbRatingToStars5 } from '../../lib/media/rating-utils';
import { IconPlus, IconCheck, IconTrayStatus, IconLayers } from '../local/ui/icons';
import { useLibraryEntry } from './hooks/useLibraryEntry';
import { useAutoShrinkTitle } from './hooks/useAutoShrinkTitle';
import { useDiscordPresence } from './hooks/useDiscordPresence';
import { MediaStoreLinks } from './MediaStoreLinks';
import { saveCharactersSkeleton } from '../../lib/tauri/characters';

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
        aria-label="Cambiar estado"
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

// ── MediaPage ──────────────────────────────────────────────────────────────

interface Props {
  i18n: Pick<Translations, 'media' | 'discord'>;
}

export default function MediaPage({ i18n }: Props) {
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
  const [displayedCharacters, setDisplayedCharacters] = useState(12);
  const [savedToast,         setSavedToast]         = useState<'hidden' | 'visible' | 'leaving'>('hidden');
  const savedToastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
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
        for (let i = sessionStorage.length - 1; i >= 0; i--) {
          const key = sessionStorage.key(i);
          if (key && (key.startsWith('media_data:') || key.startsWith('cached_saga:'))) {
            sessionStorage.removeItem(key);
          }
        }
      }
    }
  }, []);

  // Escuchar cambios de navegación (Astro View Transitions y Popstate)
  useEffect(() => {
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
  }, []);

  // Fetch page data cuando el currentId cambia
  useEffect(() => {
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

    let cancelled = false;

    fetchMediaDataWithFallback(
      currentId,
      partial => { setData(partial); setPageState('ready'); },
      full    => {
        setData(full);
        setPageState('ready');
        setIsFetchingFull(false);

        if (full.characters && full.characters.length > 0) {
          // char.role is overloaded per source: TMDB (movie/series) puts the
          // actual character name played there, while AniList (anime/manga/
          // etc.) puts the MAIN/SUPPORTING relation kind — they need to land
          // in different DB columns instead of both piling into relation_type.
          const isCastRole = full.type === 'movie' || full.type === 'series';
          const seen = new Set<string>();
          const skeletonChars = full.characters
            .map(char => ({
              external_id: char.id || `character:${char.name}`,
              name: char.name,
              image_url: char.image || null,
              relation_type: isCastRole ? null : (char.role || null),
              character_name: isCastRole ? (char.role || null) : null,
            }))
            .filter(char => {
              if (seen.has(char.external_id)) return false;
              seen.add(char.external_id);
              return true;
            });
          saveCharactersSkeleton(currentId, skeletonChars).catch(console.error);
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
            setData(prev => (prev && prev.externalId === full.externalId) ? { ...prev, relations } : prev);
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
            setData(prev => (prev && prev.externalId === full.externalId) ? { ...prev, relations } : prev);
          });
        }

        if (full.type === 'comic') {
          fetchComicIssues(currentId, full.relations, tm.relations.ISSUE).then(({ relations, characters, genreDots, genreTagDots }) => {
            if (cancelled) return;

            // Full cast aggregated across every issue — supersedes the
            // first-issue-only sample the initial volume fetch showed.
            if (characters.length > 0) {
              const skeletonChars = characters.map(char => ({
                external_id: char.id || `character:${char.name}`,
                name: char.name,
                image_url: char.image || null,
                relation_type: null,
                character_name: null,
              }));
              saveCharactersSkeleton(currentId, skeletonChars).catch(console.error);
              setData(prev => (prev && prev.externalId === full.externalId) ? { ...prev, characters } : prev);
            }

            if (genreDots || genreTagDots) {
              updateCatalogGenres(currentId, genreDots ?? null, genreTagDots ?? null).catch(console.error);
              setData(prev => (prev && prev.externalId === full.externalId) ? { ...prev, genreDots, genreTagDots } : prev);
            }

            if (!relations) return;
            patchCachedRelations(currentId, relations);
            setData(prev => (prev && prev.externalId === full.externalId) ? { ...prev, relations } : prev);
          });
        }
      },
      ()      => { setPageState(prev => prev === 'ready' ? prev : 'error'); setIsFetchingFull(false); },
    );

    return () => { cancelled = true; };
  }, [currentId]);


  // Auto-open editor when ?edit=1 is in the URL (e.g. navigating from library)
  useEffect(() => {
    if (!data) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('edit') === '1') setShowEditor(true);
  }, [data]);

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
    if (!data?.type || !currentId || data.externalId !== currentId) return;

    saveCatalogEntry({
      id:                    '',
      external_id:           currentId,
      parent_id:             data.parentGame?.externalId ?? null,

      type:                  data.type,
      format:                data.format,
      source:                data.source,
      title_main:            data.titleMain   || undefined,
      title_native:          data.titleNative || undefined,
      title_romaji:          data.titleEnglish || undefined,
      synopsis:              data.description || undefined,
      cover_url:             data.cover       || undefined,
      banners_csv:           data.bannerImage || undefined,
      release_year:          data.releaseYear,
      release_month:         data.releaseMonth,
      release_day:           data.releaseDay,
      score_global:          data.scoreGlobal,
      time_length:           data.timeLength,
      status:                data.status,
      total_count:           data.totalCount,
      total_count_2:         data.totalCount_2,
      genres_csv:            data.genreDots    ? data.genreDots.split(' · ').join(',')    : undefined,
      genres_tag_csv:        data.genreTagDots ? data.genreTagDots.split(' · ').join(',') : undefined,
      platforms_csv:         data.platforms?.join(',') || undefined,
      // "platform|url" pairs — IGDB store links (Steam, GOG, ...). Neither
      // token can contain a comma so a flat CSV join/split round-trips safely.
      // data.storeLinks is null once the backend has checked this game *and*
      // its ports and found nothing — persisted as an explicit NULL rather
      // than left untouched, so "confirmed no links" is distinguishable from
      // "never checked" (undefined, non-game media types).
      shop_links_csv:        data.storeLinks === null
        ? null
        : data.storeLinks?.length
          ? data.storeLinks.map(l => `${l.platform}|${l.url}`).join(',')
          : undefined,
      companies_cache_csv:   data.companies?.length ? data.companies.join(',') : undefined,
      // Names only, same convention as companies_cache_csv — this is a flat
      // display cache for the instant partial-load path (mapCatalogEntryToPartialData),
      // not a relation store. The real author relations (id, image, role, url)
      // are synced separately via saveMediaAuthors below, into media_author/media_by_author.
      authors_csv:           data.authors?.length ? data.authors.map(a => a.name).join(',') : undefined,
      created_at:            new Date().toISOString(),
      updated_at:            new Date().toISOString(),
    }).catch(() => {});
  // Re-run when bannerImage/authors changes so partial→full transition saves the banner URL and authors to catalog.
  // currentId is included so navigating between two items of the same type (and same
  // transient bannerImage state) still re-fetches the library entry for the new item.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentId, data?.type, data?.bannerImage, data?.authors]);

  useDiscordPresence(data, t.discord);

  const handleCoverClick = useCallback(() => {
    setShowEditor(true);
  }, []);

  const handleEditorSaved = useCallback((entry: LibraryEntry) => {
    applySaved(entry);
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
  }, [applyDeleted]);

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
  const bannerStyle = !data.bannerImage
    ? ({ '--banner-color': data.bannerColor } as React.CSSProperties)
    : undefined;
  // Books and comics never share a page — reuse the same "editions" tab
  // slot for comics' issues, just swapping the label/i18n key.
  const editionsLabel = data.type === 'comic' ? tm.relations.ISSUE : tm.relations.EDITIONS;
  // A "full edition" of the base game (remake/remaster/expanded edition/
  // port/fork) tends to inherit the base game's whole sibling-editions web
  // in IGDB's own data — e.g. a remaster's own relations pointing at the
  // *original, non-remastered* content — so those only ever show their
  // Fuente/parent relation. Content attached to a specific release (DLC,
  // expansion, standalone expansion, episode, season, mod, update) doesn't
  // have that inheritance problem — its own remakes/remasters genuinely
  // describe that piece of content, so those keep their full relations.
  // mapIgdbToMedia already stops fetching the excluded ones fresh; this also
  // filters out any leftover rows saved to the DB before that fix.
  const isFullEdition = new Set(['REMAKE', 'REMASTER', 'EXPANDED_GAME', 'PORT', 'FORK']).has(data.format ?? '');
  // For full-edition pages (remakes, remasters…) only show their own content
  // (DLCs, expansions, standalone, remasters, expanded games) and their source (PARENT). Everything else
  // IGDB inherits from the base game (sibling remakes, etc.) is blocked.
  const FULL_EDITION_ALLOWED = new Set([
    tm.relations.PARENT,
    tm.relations.DLC,
    tm.relations.EXPANSION,
    tm.relations.STANDALONE,
    tm.relations.REMASTER,
    tm.relations.EXPANDED_GAME,
    tm.relations.REL_UPDATE
  ]);
  const relatedRelations    = sortMediaRelations(data.relations.filter(r =>
    r.typeLabel !== tm.relations.RECOMMENDATION && r.typeLabel !== editionsLabel &&
    (!isFullEdition || FULL_EDITION_ALLOWED.has(r.typeLabel))
  ));
  const recommendedRelations = sortMediaRelations(data.relations.filter(r => r.typeLabel === tm.relations.RECOMMENDATION));
  const editionRelations    = data.relations.filter(r => r.typeLabel === editionsLabel);
  const hasRecommendedRelations = recommendedRelations.length > 0;
  const hasEditionRelations     = editionRelations.length > 0;
  const hasTabs = hasRecommendedRelations || hasEditionRelations;
  const visibleRelations = relationsTab === 'recommended'
    ? recommendedRelations
    : relationsTab === 'editions'
    ? editionRelations
    : relatedRelations;
  const pageSize = relationsTab === 'recommended' ? 8 : 12;

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
      {showEditor && (
        <MediaEditorModal
          externalId={currentId}
          data={data}
          i18n={tm}
          initialEntry={libEntry ?? undefined}
          onClose={handleEditorClose}
          onSaved={handleEditorSaved}
          onDeleted={handleEditorDeleted}
        />
      )}
      {showSaga && (
        <SagaViewerModal externalId={currentId} i18n={tm} onClose={() => setShowSaga(false)} />
      )}
      {showPrEditor && (
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
          <button
            type="button"
            className="media-banner-pr-btn"
            onClick={() => setShowPrEditor(true)}
            title="Proponer cambios o añadir datos en GitHub"
          >
            <IconPlus />
          </button>
        </div>
        {data.developerBadge && (
          <div className="media-banner-developer-badge">{data.developerBadge}</div>
        )}

        <div className="media-hero-body">
          {/* Izquierda: títulos */}
          <div className="media-hero-left">
            <h1 className="media-title-main" ref={titleRef}>{data.titleMain}</h1>
            {data.titleNative  && <p className="media-title-native">{data.titleNative}</p>}
            {data.titleEnglish && <p className="media-title-english">{data.titleEnglish}</p>}
          </div>

          {/* Centro: cover + widget de biblioteca */}
          <div className="media-cover-column">
            {data.hasSaga && (
              <button type="button" className="media-saga-btn" onClick={() => setShowSaga(true)}>
                <IconLayers size={14} />
                {tm.saga_button}
              </button>
            )}
            <div
              className={`media-cover-wrap${inLibrary ? ' in-library' : ''}${isBlockedEdition ? ' is-edition' : ''}`}
              role="button"
              tabIndex={0}
              aria-label={isBlockedEdition
                ? tm.is_version_of.replace('{title}', data.parentGame!.title)
                : tm.add_to_library.replace('\n', ' ')}
              onClick={() => {
                if (isBlockedEdition) {
                  window.location.href = `/media?id=${encodeURIComponent(data.parentGame!.externalId)}`;
                  return;
                }
                handleCoverClick();
              }}
              onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && (
                isBlockedEdition
                  ? (window.location.href = `/media?id=${encodeURIComponent(data.parentGame!.externalId)}`)
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

            {!isBlockedEdition && (
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

      {/* Body: 3 columnas */}
      <div className={`media-body${((data.stats ?? []).length === 0 && !(data.authors && data.authors.length > 0)) ? ' media-body--no-stats' : ''}`}>
        {/* The 3rd grid column only collapses (media-body--no-stats) when the
            Datos panel below is truly not rendering — otherwise Datos must
            keep its own column, landing to the right of Sinopsis regardless
            of whether Relacionados (the middle column) has any content. */}

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
                dangerouslySetInnerHTML={{ __html: data.description }}
              />
            </>
          )}
        </div>

        {/* Relacionados */}
        <div className="media-col-related">
          {(relatedRelations.length > 0 || hasRecommendedRelations || hasEditionRelations) && (
            <>
              <div className="media-section-header-row">
                {/* TMDB recommendations ride in the same list as real
                    relations (saga/adaptation/etc) — when both are present,
                    each label becomes a tab switching which subset the grid
                    below shows, instead of mixing recommendations into
                    "Related". */}
                {hasTabs ? (
                  <>
                    <button
                      type="button"
                      className={`section-label section-label--tab${relationsTab === 'related' ? ' active' : ''}`}
                      onClick={() => { setRelationsTab('related'); setRelationPage(1); }}
                    >
                      {tm.section_related}
                    </button>
                    <div className="media-section-header-line media-section-header-line--short" />
                    {hasEditionRelations && (
                      <button
                        type="button"
                        className={`section-label section-label--tab${relationsTab === 'editions' ? ' active' : ''}`}
                        onClick={() => { setRelationsTab('editions'); setRelationPage(1); }}
                      >
                        {editionsLabel}
                      </button>
                    )}
                    {hasEditionRelations && hasRecommendedRelations && (
                      <div className="media-section-header-line media-section-header-line--short" />
                    )}
                    {hasRecommendedRelations && (
                      <button
                        type="button"
                        className={`section-label section-label--tab${relationsTab === 'recommended' ? ' active' : ''}`}
                        onClick={() => { setRelationsTab('recommended'); setRelationPage(1); }}
                      >
                        {tm.relations.RECOMMENDATION}
                      </button>
                    )}
                    <div className="media-section-header-line" />
                  </>
                ) : (
                  <>
                    <p className="section-label">{tm.section_related}</p>
                    <div className="media-section-header-line" />
                  </>
                )}
                {data.storeLinks && data.storeLinks.length > 0 && (
                  <MediaStoreLinks links={data.storeLinks} />
                )}
              </div>
              <div className="media-relations-grid">
                {visibleRelations
                  .slice((relationPage - 1) * pageSize, relationPage * pageSize)
                  .map((r, i) => (
                    <a key={r.url ?? `${r.typeLabel}-${r.title}-${i}`} href={r.url ?? '#'} className="media-relation-card">
                      <div className="media-relation-bg-layer">
                        {r.cover && <img src={r.cover} alt="" loading="lazy" />}
                      </div>
                      <div className="media-relation-card-overlay" />
                      <div className="media-relation-card-content">
                        <div className="media-relation-thumb">
                          {r.cover && <img src={r.cover} alt={r.title} loading="lazy" />}
                        </div>
                        <div className="media-relation-info">
                          <span className="media-relation-type">{r.typeLabel}</span>
                          <span className="media-relation-title">{r.title}</span>
                        </div>
                      </div>
                    </a>
                  ))}
              </div>
              {visibleRelations.length > pageSize && (
                <div className="media-pagination">
                  {Array.from({ length: Math.ceil(visibleRelations.length / pageSize) }).map((_, i) => (
                    <button
                      key={i + 1}
                      type="button"
                      className={`media-pagination-page${relationPage === i + 1 ? ' active' : ''}`}
                      onClick={() => setRelationPage(i + 1)}
                    >
                      {i + 1}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        {/* Datos */}
        {(data.stats.length > 0 || (data.authors && data.authors.length > 0)) && (
          <div className="media-col-stats">
            {(data.stats.length > 0 || (data.authors && data.authors.length > 0)) && (
              <>
                <div className="media-section-header-row">
                  <p className="section-label">{tm.section_data}</p>
                  <div className="media-section-header-line" />
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
                                onClick={() => {
                                  if (auth.url!.startsWith('http')) {
                                    const tauri = window.__TAURI__;
                                    if (tauri?.opener?.openUrl) {
                                      tauri.opener.openUrl(auth.url!);
                                    } else {
                                      window.open(auth.url!, '_blank');
                                    }
                                  } else {
                                    window.location.href = auth.url!;
                                  }
                                }}
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
                      <div key={i} className="media-stat-item">
                        <span className="media-stat-label">{s.label}</span>
                        <span className="media-stat-value">{s.value}</span>
                      </div>
                    ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* Personajes */}
      {data.characters.length > 0 && (
        <div className="media-chars-section">
          <div className="media-section-header-row">
            <p className="section-label">{tm.section_characters}</p>
            <div className="media-section-header-line" />
          </div>
          <div className="media-chars-grid">
            {data.characters.slice(0, displayedCharacters).map((c, i) => (
              <div key={i} className="media-char-card">
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
              </div>
            ))}
          </div>
          {data.characters.length > displayedCharacters && (
            <button
              type="button"
              className="media-load-more-btn"
              onClick={() => setDisplayedCharacters(prev => prev + 12)}
            >
              {tm.load_more}
            </button>
          )}
        </div>
      )}
    </>
  );
}
