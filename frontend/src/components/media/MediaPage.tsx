import { useState, useEffect, useRef, useCallback } from 'react';
import { getT } from '../../i18n/client';
import { fetchMediaDataWithFallback, fetchExtraRelations } from '../../lib/media/mediaService';
import { saveCatalogEntry, updateDiscordPresence, resetDiscordPresence } from '../../lib/tauri';
import type { LibraryEntry } from '../../lib/tauri';
import type { MediaPageData } from '../../lib/media/types';
import { MediaEditorModal } from './MediaEditorModal';
import { STAR_PATH } from '../../lib/media/constants';
import { dbRatingToStars5 } from '../../lib/media/rating-utils';
import { IconPlus, IconCheck, IconTrayStatus } from '../local/ui/icons';
import { useLibraryEntry } from './hooks/useLibraryEntry';

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
  t: ReturnType<typeof getT>['media'];
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

export default function MediaPage() {
  const t  = getT();
  const tm = t.media;

  // Estado para el ID actual de la obra
  const [currentId, setCurrentId] = useState('');
  const [pageState, setPageState] = useState<'loading' | 'error' | 'ready'>('loading');
  const [isFetchingFull,     setIsFetchingFull]     = useState(false);
  const [data,               setData]               = useState<MediaPageData | null>(null);
  const [showEditor,         setShowEditor]         = useState(false);
  const [relationPage,       setRelationPage]       = useState(1);
  const [displayedCharacters, setDisplayedCharacters] = useState(12);
  const [savedToast,         setSavedToast]         = useState<'hidden' | 'visible' | 'leaving'>('hidden');
  const savedToastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  // Escuchar cambios de navegación (Astro View Transitions)
  useEffect(() => {
    const updateId = () => {
      const id = new URLSearchParams(window.location.search).get('id') ?? '';
      setCurrentId(id);
    };

    updateId();

    // Eventos de Astro para transiciones de página
    document.addEventListener('astro:page-load', updateId);
    return () => {
      document.removeEventListener('astro:page-load', updateId);
    };
  }, []);

  // Fetch page data cuando el currentId cambia
  useEffect(() => {
    if (!currentId) return;

    setPageState('loading');
    setData(null);
    setIsFetchingFull(true);

    let cancelled = false;

    fetchMediaDataWithFallback(
      currentId,
      partial => { setData(partial); setPageState('ready'); },
      full    => {
        setData(full);
        setPageState('ready');
        setIsFetchingFull(false);

        // Transitive relations (remaster-of-an-expansion, port-of-a-remaster,
        // etc.) take a few extra sequential IGDB requests — fetch them after
        // the page is already showing instead of delaying first render.
        const targetRelationsId = full.parentGame?.externalId || currentId;
        fetchExtraRelations(targetRelationsId, full).then(relations => {
          if (cancelled || !relations) return;
          setData(prev => (prev && prev.externalId === full.externalId) ? { ...prev, relations } : prev);
        });
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

  // Upsert catalog entry with the latest metadata from the API once we know the type
  // (library entry loading is handled by useLibraryEntry above)
  useEffect(() => {
    if (!data?.type || !currentId) return;

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
      companies_cache_csv:   data.companies?.length ? data.companies.join(',') : undefined,
      created_at:            new Date().toISOString(),
      updated_at:            new Date().toISOString(),
    }).catch(() => {});
  // Re-run when bannerImage changes so partial→full transition saves the banner URL to catalog.
  // currentId is included so navigating between two items of the same type (and same
  // transient bannerImage state) still re-fetches the library entry for the new item.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentId, data?.type, data?.bannerImage]);

  // ── Discord Rich Presence ──────────────────────────────────────────────────
  useEffect(() => {
    if (!data?.externalId) return;

    const baseType = data.type?.split('_')[0];
    
    // Obtener la línea principal de i18n ("Viendo la ficha de...", etc.)
    const detailsText =
      baseType === 'anime' || baseType === 'movie' || baseType === 'series'
        ? t.discord.watching_details
        : baseType === 'manga' || baseType === 'novel' || baseType === 'book'
        ? t.discord.reading_details
        : baseType === 'game' || baseType === 'vnovel'
        ? t.discord.playing_details
        : 'Metadea';

    // Normalizar la URL de la portada para asegurar que Discord la acepte (debe llevar https:)
    let coverUrl = data.cover || '';
    if (coverUrl.startsWith('//')) {
      coverUrl = 'https:' + coverUrl;
    }


    updateDiscordPresence(
      detailsText,      // Línea 1: "Detalles del juego:"
      data.titleMain,   // Línea 2: Título de la obra
      'metadea',        // Tu logotipo de Metadea subido a Art Assets
      'Metadea',
    ).catch(() => {});

    // Al desmontar (salir de la ficha), restablecemos el estado por defecto
    return () => {
      resetDiscordPresence().catch(() => {});
    };

  // Re-disparar si cambia la obra
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.externalId]);



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

  const handleStatusChange = useCallback((next: string) => {
    updateLocal({ status: next || null });
    setShowEditor(true);
  }, [updateLocal]);

  const handleRate = useCallback((stars: number) => {
    const dbRating = stars * 2;
    const nextRating = libRating === dbRating ? 0 : dbRating;
    updateLocal({ rating: nextRating || null });
    setShowEditor(true);
  }, [libRating, updateLocal]);

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
          initialEntry={libEntry ?? undefined}
          onClose={handleEditorClose}
          onSaved={handleEditorSaved}
          onDeleted={handleEditorDeleted}
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

        {data.dateBadge && (
          <div className="media-banner-date-badge">{data.dateBadge}</div>
        )}
        {data.developerBadge && (
          <div className="media-banner-developer-badge">{data.developerBadge}</div>
        )}

        <div className="media-hero-body">
          {/* Izquierda: títulos */}
          <div className="media-hero-left">
            <h1 className="media-title-main">{data.titleMain}</h1>
            {data.titleNative  && <p className="media-title-native">{data.titleNative}</p>}
            {data.titleEnglish && <p className="media-title-english">{data.titleEnglish}</p>}
          </div>

          {/* Centro: cover + widget de biblioteca */}
          <div className="media-cover-column">
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
            {data.metaLines[0] && <p className="media-studios-label">{data.metaLines[0]}</p>}
            {data.metaLines[1] && <p className="media-cover-meta">{data.metaLines[1]}</p>}
            {data.metaLines[2] && <p className="media-cover-meta">{data.metaLines[2]}</p>}
          </div>
        </div>
      </div>

      {/* Body: 3 columnas */}
      <div className={`media-body${data.stats.length === 0 ? ' media-body--no-stats' : ''}`}>

        {/* Sinopsis */}
        <div className="media-col-synopsis">
          {data.description && (
            <>
              <p className="section-label">{tm.section_synopsis}</p>
              <div
                className="media-description-text"
                dangerouslySetInnerHTML={{ __html: data.description }}
              />
            </>
          )}
        </div>

        {/* Relacionados */}
        <div className="media-col-related">
          {data.relations.length > 0 && (
            <>
              <p className="section-label">{tm.section_related}</p>
              <div className="media-relations-grid">
                {data.relations
                  .slice((relationPage - 1) * 12, relationPage * 12)
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
              {data.relations.length > 12 && (
                <div className="media-pagination">
                  {Array.from({ length: Math.ceil(data.relations.length / 12) }).map((_, i) => (
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
        {(data.stats.length > 0 || (data.storeLinks && data.storeLinks.length > 0)) && (
          <div className="media-col-stats">
            {data.storeLinks && data.storeLinks.length > 0 && (
              <div className="media-store-links">
                {data.storeLinks.map((link, i) => {
                  const platformLower = link.platform.toLowerCase();
                  const logoMap: Record<string, string> = {
                    'steam': 'steam_logo.png',
                    'epic': 'epic_logo.png',
                    'gog': 'gog_logo.png',
                    'playstation': 'playstation_logo.png',
                    'xbox': 'xbox_logo.png',
                    'nintendo': 'nintendo_logo.png',
                    'ea': 'EA_logo.png'
                  };
                  const logoFile = logoMap[platformLower] || 'steam_logo.png';
                  const logoUrl = `/platforms/${logoFile}`;

                  return (
                    <button
                      key={link.platform}
                      type="button"
                      className="media-store-link"
                      title={link.platform}
                      onClick={() => {
                        const tauri = window.__TAURI__;
                        if (tauri?.opener?.openUrl) {
                          tauri.opener.openUrl(link.url);
                        } else {
                          window.open(link.url, '_blank');
                        }
                      }}
                    >
                      <img src={logoUrl} alt={link.platform} className="media-store-icon" />
                    </button>
                  );
                })}
              </div>
            )}
            {data.stats.length > 0 && (
              <>
                <p className="section-label">{tm.section_data}</p>
                <div className="media-stats-list">
                  {data.stats.map((s, i) => (
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
          <p className="section-label">{tm.section_characters}</p>
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
