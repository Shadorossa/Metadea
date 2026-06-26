import { useState, useEffect, useRef, useCallback } from 'react';
import { es } from '../../i18n/es';
import { en } from '../../i18n/en';
import { fetchMediaData, getCachedMediaData } from '../../lib/media/mediaService';
import { getLibraryItems, saveLibraryItem } from '../../lib/tauri';
import type { MediaPageData } from '../../lib/media/types';

// ── SVG shared props ───────────────────────────────────────────────────────

const SVG = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2.5,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

const STAR_PATH = 'M12 17.75l-6.172 3.245 1.179-6.873-4.993-4.867 6.9-1.002L12 2l3.086 6.253 6.9 1.002-4.993 4.867 1.179 6.873z';

// ── Icon components ────────────────────────────────────────────────────────

function IconPlus() {
  return (
    <svg width={22} height={22} {...SVG}>
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function IconCheck() {
  return (
    <svg width={22} height={22} {...SVG}>
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function StatusIcon({ status }: { status: string }) {
  switch (status) {
    case 'planning':
      return (
        <svg {...SVG}>
          <path d="M6 20v-2a6 6 0 1 1 12 0v2a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1z" />
          <path d="M6 4v2a6 6 0 1 0 12 0v-2a1 1 0 0 0-1-1H7a1 1 0 0 0-1 1z" />
        </svg>
      );
    case 'watching':
    case 'reading':
      return <svg {...SVG}><polygon points="5 3 19 12 5 21 5 3" /></svg>;
    case 'playing':
      return (
        <svg {...SVG}>
          <rect x="2" y="6" width="20" height="12" rx="2"/>
          <path d="M6 12h4M8 10v4"/>
          <circle cx="15" cy="12" r="1" fill="currentColor"/>
          <circle cx="18" cy="10" r="1" fill="currentColor"/>
        </svg>
      );
    case 'completed':
      return <svg {...SVG}><polyline points="20 6 9 17 4 12" /></svg>;
    case 'paused':
      return (
        <svg {...SVG}>
          <rect x="6" y="4" width="4" height="16" rx="1" />
          <rect x="14" y="4" width="4" height="16" rx="1" />
        </svg>
      );
    case 'dropped':
      return (
        <svg {...SVG}>
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      );
    default:
      return (
        <svg {...SVG}>
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
      );
  }
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
  const display = hover ?? rating / 2;

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
}: {
  status: string;
  progressStatus: string;
  progressLabel: string;
  onChange: (next: string) => void;
}) {
  const trayButtons = [
    { s: 'planning',     label: 'Pendiente' },
    { s: progressStatus, label: progressLabel },
    { s: 'completed',    label: 'Terminado' },
    { s: 'paused',       label: 'Pausa' },
    { s: 'dropped',      label: 'Abandonado' },
  ];

  return (
    <div className="media-status-dropdown-container">
      <button
        className={`status-dropdown-trigger${status ? ` text-${status}` : ''}`}
        aria-label="Cambiar estado"
      >
        <StatusIcon status={status} />
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
            <StatusIcon status={btn.s} />
          </button>
        ))}
      </div>
    </div>
  );
}

// ── MediaPage ──────────────────────────────────────────────────────────────

export default function MediaPage({ lang }: { lang: string }) {
  const t  = lang === 'en' ? en : es;
  const tm = t.media;

  // rawId es constante durante la vida del componente — se lee una vez del URL
  const rawId = useRef(
    typeof window !== 'undefined'
      ? new URLSearchParams(window.location.search).get('id') ?? ''
      : ''
  );

  // Lectura síncrona de la caché: si se prefetcheó al hacer hover, no hay spinner
  const prefetched = typeof window !== 'undefined' ? getCachedMediaData(rawId.current) : null;

  const [pageState, setPageState] = useState<'loading' | 'error' | 'ready'>(
    prefetched ? 'ready' : 'loading'
  );
  const [data,               setData]               = useState<MediaPageData | null>(prefetched);
  const [libStatus,          setLibStatus]          = useState('');
  const [libRating,          setLibRating]          = useState(0);
  const [relationPage,       setRelationPage]       = useState(1);
  const [displayedCharacters, setDisplayedCharacters] = useState(12);

  useEffect(() => {
    // Siempre carga el estado de biblioteca (puede haber cambiado)
    getLibraryItems()
      .then(items => {
        const item = items.find(i => i.external_id === rawId.current);
        if (item) {
          setLibStatus(item.status ?? '');
          setLibRating(item.rating ?? 0);
        }
      })
      .catch(() => {});

    // Solo fetcha si no teníamos datos en caché
    if (prefetched) return;

    if (!rawId.current) { setPageState('error'); return; }

    fetchMediaData(rawId.current)
      .then(result => {
        if (!result) { setPageState('error'); return; }
        setData(result);
        setPageState('ready');
      })
      .catch(() => setPageState('error'));
  }, []);

  const persist = useCallback(async (status: string, rating: number) => {
    try {
      await saveLibraryItem(rawId.current, data?.type ?? '', {
        status: status  || undefined,
        rating: rating  || undefined,
      });
    } catch (err) {
      console.error('Error saving library item:', err);
    }
  }, [data?.type]);

  const handleCoverClick = useCallback(() => {
    const next = libStatus ? '' : 'planning';
    setLibStatus(next);
    persist(next, libRating);
  }, [libStatus, libRating, persist]);

  const handleStatusChange = useCallback((next: string) => {
    setLibStatus(next);
    persist(next, libRating);
  }, [libRating, persist]);

  const handleRate = useCallback((stars: number) => {
    const dbRating  = stars * 2;
    const nextRating = libRating === dbRating ? 0 : dbRating;
    const nextStatus = libStatus || 'planning';
    setLibRating(nextRating);
    setLibStatus(nextStatus);
    persist(nextStatus, nextRating);
  }, [libRating, libStatus, persist]);

  // ── States: loading / error ──────────────────────────────────────────────

  if (pageState === 'loading') {
    return <div className="media-loading"><div className="spinner" /></div>;
  }
  if (pageState === 'error' || !data) {
    return <div className="media-error"><span>{tm.not_found}</span></div>;
  }

  // ── Ready ────────────────────────────────────────────────────────────────

  const inLibrary  = !!libStatus;
  const bannerStyle = !data.bannerImage
    ? ({ '--banner-color': data.bannerColor } as React.CSSProperties)
    : undefined;

  return (
    <>
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
              className={`media-cover-wrap${inLibrary ? ' in-library' : ''}`}
              role="button"
              tabIndex={0}
              aria-label={tm.add_to_library.replace('\n', ' ')}
              onClick={handleCoverClick}
              onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && handleCoverClick()}
            >
              {data.cover && (
                <img className="media-cover-img" src={data.cover} alt={data.titleMain} />
              )}
              <div className="media-cover-overlay">
                <div className="media-cover-overlay-inner">
                  <span className="media-cover-overlay-icon">
                    {inLibrary ? <IconCheck /> : <IconPlus />}
                  </span>
                  <span
                    className="media-cover-overlay-label"
                    dangerouslySetInnerHTML={{
                      __html: (inLibrary ? tm.in_library : tm.add_to_library).replace('\n', '<br>'),
                    }}
                  />
                </div>
              </div>
            </div>

            <div className="media-library-widget-box">
              <div className="media-library-row-horizontal">
                <StatusDropdown
                  status={libStatus}
                  progressStatus={data.progressStatus}
                  progressLabel={data.progressLabel}
                  onChange={handleStatusChange}
                />
                <StarRating rating={libRating} onRate={handleRate} />
              </div>
            </div>
          </div>

          {/* Derecha: géneros + meta */}
          <div className="media-hero-right">
            {data.genreDots    && <p className="media-genres-dots">{data.genreDots}</p>}
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
                    <a key={i} href={r.url ?? '#'} className="media-relation-card">
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
                {data.storeLinks.map((link, i) => (
                  <button
                    key={i}
                    type="button"
                    className="media-store-link"
                    title={link.platform}
                    onClick={() => {
                      const tauri = (window as any).__TAURI__;
                      if (tauri?.opener?.openUrl) {
                        tauri.opener.openUrl(link.url);
                      } else {
                        window.open(link.url, '_blank');
                      }
                    }}
                  >
                    <img
                      src={`/platforms/${link.platform}_logo.png`}
                      alt={link.platform}
                      draggable={false}
                    />
                  </button>
                ))}
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
              Cargar más
            </button>
          )}
        </div>
      )}
    </>
  );
}
