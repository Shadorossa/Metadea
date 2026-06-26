import React, { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  pickFolder, scanFolderContents,
  readRoutes, writeRoutes, debugScanInfo,
  igdbGetCoverBySteamId, readMetadataIndex, readGameInfo, pathToDataUrl,
  steamGetPlayerAchievements, steamAchievementIcon, steamAchievementsDownload,
  type LocalGame, type LocalFolderEntry, type MetaEntry, type GameInfo, type SteamAchievement,
} from '../../lib/tauri';
import { scanGamesWithSteam } from '../../lib/local/steam-merge';

// ── Platform config ───────────────────────────────────────────────────────────

type PlatformId = 'steam' | 'epic' | 'gog' | 'xbox' | 'ea' | 'nintendo' | 'playstation';
type CategoryId = 'videojuegos' | 'visual-novel' | 'anime' | 'manga' | 'light-novel' | 'books' | 'series' | 'movies';

const PLATFORM_LABEL: Record<PlatformId, string> = {
  steam:       'Steam',
  epic:        'Epic Games',
  gog:         'GOG',
  xbox:        'Xbox',
  ea:          'EA',
  nintendo:    'Nintendo',
  playstation: 'PlayStation',
};

const CATEGORIES: Array<{ id: CategoryId; label: string }> = [
  { id: 'videojuegos', label: 'Videojuegos' },
  { id: 'visual-novel', label: 'Novela visual' },
  { id: 'anime', label: 'Anime' },
  { id: 'manga', label: 'Manga' },
  { id: 'light-novel', label: 'Novela Ligera' },
  { id: 'books', label: 'Libros' },
  { id: 'series', label: 'Series' },
  { id: 'movies', label: 'Películas' },
];

const LAUNCHER_ORDER: PlatformId[] = ['steam', 'epic', 'gog', 'xbox', 'ea', 'nintendo', 'playstation'];

const STEAM_COVER = (appId: string) =>
  `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/library_600x900_2x.jpg`;

// ── Platform logo paths ───────────────────────────────────────────────────────
// Drop PNGs into: public/platforms/
const PLATFORM_LOGO: Record<PlatformId, string> = {
  steam:       '/platforms/steam_logo.png',
  xbox:        '/platforms/xbox_logo.png',
  epic:        '/platforms/epic_logo.png',
  gog:         '/platforms/gog_logo.png',
  ea:          '/platforms/EA_logo.png',
  nintendo:    '/platforms/nintendo_logo.png',
  playstation: '/platforms/playstation_logo.png',
};

// ── Utility icons ─────────────────────────────────────────────────────────────

function IconMonitor() {
  return (
    <svg width={48} height={48} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="3" width="20" height="14" rx="2"/>
      <line x1="8" y1="21" x2="16" y2="21"/>
      <line x1="12" y1="17" x2="12" y2="21"/>
    </svg>
  );
}

function IconFolder() {
  return (
    <svg width={40} height={40} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
    </svg>
  );
}

function IconFile() {
  return (
    <svg width={32} height={32} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/>
      <polyline points="13 2 13 9 20 9"/>
    </svg>
  );
}

function IconRefresh() {
  return (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <polyline points="23 4 23 10 17 10"/>
      <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
    </svg>
  );
}

function IconPlus() {
  return (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="5" x2="12" y2="19"/>
      <line x1="5" y1="12" x2="19" y2="12"/>
    </svg>
  );
}

function IconX() {
  return (
    <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18"/>
      <line x1="6" y1="6" x2="18" y2="18"/>
    </svg>
  );
}

// ── Game card ─────────────────────────────────────────────────────────────────

interface GameCardProps {
  game: LocalGame;
  pathCache: Record<string, MetaEntry>;
  coverCache: Record<string, { cover?: string; banner?: string }>;
  onClick: (game: LocalGame) => void;
}

function GameCard({ game, pathCache, coverCache, onClick }: GameCardProps) {
  const [cover, setCover] = useState<string | null>(null);

  const pathEntry = game.app_id ? pathCache[game.app_id] : undefined;
  const cachedEntry = game.app_id ? coverCache[game.app_id] : undefined;

  // Load from cache first, or load directly from path if available
  useEffect(() => {
    const loadCover = async () => {
      if (cachedEntry?.cover) {
        setCover(cachedEntry.cover);
      } else if (pathEntry?.cover_path) {
        const url = await pathToDataUrl(pathEntry.cover_path);
        setCover(url);
      }
    };
    loadCover();
  }, [cachedEntry, pathEntry]);

  return (
    <div className="local-game-card" onClick={() => onClick(game)} role="button" tabIndex={0} onKeyDown={e => e.key === 'Enter' && onClick(game)}>
      <div className="local-game-cover">
        {cover
          ? <img src={cover} alt={game.name} loading="lazy" onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
          : <div className="local-game-cover-placeholder"><IconMonitor /></div>
        }
      </div>
      <p className="local-game-name">{game.name}</p>
    </div>
  );
}

// ── Game detail panel ─────────────────────────────────────────────────────────

interface GameDetailPanelProps {
  game: LocalGame;
  coverCache: Record<string, MetaEntry>;
  onClose: () => void;
}

function AchievementCell({ ach, appId }: { ach: SteamAchievement; appId: string }) {
  const localFile = ach.achieved ? ach.icon_unlocked : ach.icon_locked;
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    if (localFile) {
      steamAchievementIcon(appId, localFile).then(url => {
        if (url) setSrc(url);
        else setSrc(ach.icon ?? null);
      });
    } else {
      setSrc(ach.icon ?? null);
    }
  }, [appId, localFile, ach.icon]);

  const unlockDate = ach.achieved && ach.unlocktime > 0
    ? new Date(ach.unlocktime * 1000).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' })
    : null;

  return (
    <div className={`local-game-detail-ach-cell${ach.achieved ? ' achieved' : ''}`}>
      {src ? (
        <img src={src} alt={ach.name || ach.apiname} className="local-game-detail-ach-img" />
      ) : (
        <div className="local-game-detail-ach-img local-game-detail-ach-placeholder">
          <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
            <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/>
            <path d="M4 22h16"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2z"/>
          </svg>
        </div>
      )}
      <div className="local-game-detail-ach-tooltip">
        <span className="local-game-detail-ach-tooltip-name">{ach.name || ach.apiname}</span>
        {ach.description && <span className="local-game-detail-ach-tooltip-desc">{ach.description}</span>}
        {unlockDate && <span className="local-game-detail-ach-tooltip-date">Desbloqueado: {unlockDate}</span>}
      </div>
    </div>
  );
}

function formatPlaytime(minutes?: number): string {
  if (!minutes || minutes === 0) return '—';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

function formatLastPlayed(ts?: number): string {
  if (!ts || ts === 0) return '—';
  const d = new Date(ts * 1000);
  return d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' });
}

function GameDetailPanel({ game, coverCache, onClose }: GameDetailPanelProps) {
  const [gameInfo, setGameInfo] = useState<GameInfo | null>(null);
  const [achievements, setAchievements] = useState<{ unlocked: number; total: number; list: SteamAchievement[] } | null>(null);

  useEffect(() => {
    if (!game.app_id) return;
    readGameInfo(game.app_id).then(info => setGameInfo(info));
  }, [game.app_id]);

  useEffect(() => {
    if (game.launcher !== 'steam' || !game.app_id) return;
    steamGetPlayerAchievements(Number(game.app_id)).then(res => {
      if (res) setAchievements(res);
    });
  }, [game.app_id, game.launcher]);

  const entry  = game.app_id ? coverCache[game.app_id] : undefined;
  const banner = entry?.banner ?? entry?.cover ?? null;

  const handlePlay = () => {
    console.log('Jugar:', game.name, game.install_path);
  };

  const formatDate = (timestamp?: number) => {
    if (!timestamp) return null;
    try {
      return new Date(timestamp * 1000).toLocaleDateString('es-ES', {
        year: 'numeric', month: 'long', day: 'numeric',
      });
    } catch { return null; }
  };

  const releaseDateStr = formatDate(gameInfo?.release_date ?? undefined);
  const metaDots = [
    releaseDateStr,
    gameInfo?.genres?.join(', '),
  ].filter(Boolean).join('  ·  ');

  return (
    <div className="local-game-detail-panel">
      <div className="local-game-detail-header">
        {banner ? (
          <img src={banner} alt={game.name} />
        ) : (
          <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-elevated)' }}>
            <IconMonitor />
          </div>
        )}
        <div className="local-game-detail-backdrop" />
        <button className="local-game-detail-close" onClick={onClose}>
          <IconX />
        </button>
      </div>

      <div className="local-game-detail-content">
        <div className="local-game-detail-title-block">
          <p className="local-game-detail-title">{game.name}</p>
          {gameInfo?.developers && gameInfo.developers.length > 0 && (
            <p className="local-game-detail-by">by {gameInfo.developers.join(', ')}</p>
          )}
        </div>

        <div className="local-game-detail-bottom">
          <button className="local-game-detail-play" onClick={handlePlay}>
            <svg width={16} height={16} viewBox="0 0 24 24" fill="currentColor">
              <polygon points="5 3 19 12 5 21 5 3" />
            </svg>
            Jugar
          </button>

          <div className="local-game-detail-stats">
            <div className="local-game-detail-stat">
              <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
              </svg>
              <span>{formatPlaytime(game.playtime_minutes)}</span>
              <span className="local-game-detail-stat-label">Tiempo</span>
            </div>
            <div className="local-game-detail-stat">
              <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
              </svg>
              <span>{formatLastPlayed(game.last_played)}</span>
              <span className="local-game-detail-stat-label">Última vez</span>
            </div>
            <div className="local-game-detail-stat">
              <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2z"/>
              </svg>
              <span>{achievements ? `${achievements.unlocked}/${achievements.total}` : '—'}</span>
              <span className="local-game-detail-stat-label">Logros</span>
            </div>
          </div>

          {gameInfo?.igdb_id && (
            <a href={`/media?id=game:${gameInfo.igdb_id}`} className="local-game-detail-catalog-link">
              <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                <polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
              </svg>
              Ver en catálogo
            </a>
          )}
        </div>

        {metaDots && (
          <p className="local-game-detail-metadots">{metaDots}</p>
        )}

        {gameInfo?.summary && (
          <p className="local-game-detail-summary">{gameInfo.summary}</p>
        )}

        {achievements?.list && achievements.list.length > 0 && (
          <div className="local-game-detail-achievements">
            <p className="local-game-detail-achievements-title">
              Logros — {achievements.unlocked}/{achievements.total}
            </p>
            <div className="local-game-detail-achievement-grid">
              {achievements.list.map((ach: SteamAchievement) => (
                <AchievementCell key={ach.apiname} ach={ach} appId={game.app_id!} />
              ))}
            </div>
          </div>
        )}

      </div>
    </div>
  );
}

// ── Folder entry card ─────────────────────────────────────────────────────────

function FolderEntryCard({ entry }: { entry: LocalFolderEntry }) {
  const fmt = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  };

  return (
    <div className="local-folder-entry">
      <div className="local-folder-entry-icon">
        {entry.is_dir ? <IconFolder /> : <IconFile />}
      </div>
      <div className="local-folder-entry-info">
        <p className="local-folder-entry-name">{entry.name}</p>
        <p className="local-folder-entry-meta">
          {entry.is_dir ? `${entry.child_count ?? 0} elementos` : fmt(entry.size)}
        </p>
      </div>
    </div>
  );
}

// ── Metadata type selector modal ──────────────────────────────────────────────

type MetaType = 'basic' | 'achievements';

interface MetaTypeSelectorProps {
  onConfirm: (types: MetaType[]) => void;
  onCancel:  () => void;
}

function MetaTypeSelector({ onConfirm, onCancel }: MetaTypeSelectorProps) {
  const [selected, setSelected] = useState<Set<MetaType>>(new Set(['basic']));

  function toggle(t: MetaType) {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(t) ? next.delete(t) : next.add(t);
      return next;
    });
  }

  return (
    <div className="meta-modal-overlay">
      <div className="meta-modal">
        <h3 className="meta-modal-title">¿Qué metadatos descargar?</h3>
        <p className="meta-modal-subtitle">Selecciona uno o varios tipos</p>

        <div className="meta-type-list">
          {([
            { id: 'basic' as MetaType,        label: 'Básico',            desc: 'Portada, banner, géneros, sinopsis, fecha de lanzamiento y editor' },
            { id: 'achievements' as MetaType, label: 'Logros de Steam',   desc: 'Iconos y textos de todos los logros del juego (requiere API key de Steam)' },
          ] as { id: MetaType; label: string; desc: string }[]).map(({ id, label, desc }) => (
            <button
              key={id}
              type="button"
              className={`meta-type-option${selected.has(id) ? ' selected' : ''}`}
              onClick={() => toggle(id)}
            >
              <span className="meta-type-check">
                {selected.has(id) && (
                  <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                )}
              </span>
              <span className="meta-type-text">
                <span className="meta-type-label">{label}</span>
                <span className="meta-type-desc">{desc}</span>
              </span>
            </button>
          ))}
        </div>

        <div className="meta-modal-actions">
          <button type="button" className="meta-modal-cancel" onClick={onCancel}>Cancelar</button>
          <button
            type="button"
            className="meta-modal-confirm"
            disabled={selected.size === 0}
            onClick={() => onConfirm(Array.from(selected))}
          >
            Descargar
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Metadata progress modal ───────────────────────────────────────────────────

interface MetaProgress {
  total:       number;
  current:     number;
  currentName: string;
  cancelled:   boolean;
}

interface MetaModalProps {
  progress: MetaProgress;
  onCancel: () => void;
}

function MetadataModal({ progress, onCancel }: MetaModalProps) {
  const pct = progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0;
  return (
    <div className="meta-modal-overlay">
      <div className="meta-modal">
        <h3 className="meta-modal-title">Actualizando metadatos</h3>
        <p className="meta-modal-subtitle">{progress.currentName || 'Iniciando…'}</p>
        <div className="meta-modal-bar-track">
          <div className="meta-modal-bar-fill" style={{ width: `${pct}%` }} />
        </div>
        <p className="meta-modal-count">{progress.current} / {progress.total}</p>
        <button type="button" className="meta-modal-cancel" onClick={onCancel}>
          Cancelar
        </button>
      </div>
    </div>
  );
}

// ── Platform sidebar ──────────────────────────────────────────────────────────

interface PlatformSidebarProps {
  activePlatform: PlatformId | null;
  availablePlatforms: Set<string>;
  onSelect: (id: PlatformId) => void;
  onFetchMetadata: () => void;
}

function PlatformSidebar({ activePlatform, availablePlatforms, onSelect, onFetchMetadata }: PlatformSidebarProps) {
  return (
    <aside className="local-platform-sidebar">
      {LAUNCHER_ORDER.map(id => {
        const available = availablePlatforms.has(id);
        return (
          <button
            key={id}
            type="button"
            className={[
              'local-platform-btn',
              activePlatform === id ? 'active'      : '',
              !available            ? 'unavailable' : '',
            ].filter(Boolean).join(' ')}
            onClick={() => onSelect(id)}
            title={PLATFORM_LABEL[id]}
            aria-label={PLATFORM_LABEL[id]}
          >
            <span className="local-platform-icon">
              <img src={PLATFORM_LOGO[id]} alt={PLATFORM_LABEL[id]} draggable={false} />
            </span>
            <span className="local-platform-label">{PLATFORM_LABEL[id]}</span>
          </button>
        );
      })}

      <div className="local-platform-divider" />

      <button
        type="button"
        className="local-platform-btn local-metadata-btn"
        onClick={onFetchMetadata}
        title="Obtener metadatos de IGDB"
      >
        <span className="local-platform-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2v13M5 9l7 7 7-7"/>
            <line x1="5" y1="21" x2="19" y2="21"/>
          </svg>
        </span>
        <span className="local-platform-label">Metadatos</span>
      </button>
    </aside>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function LocalLibrary() {
  const [activeCategory, setActiveCategory] = useState<CategoryId>('videojuegos');
  const [games,          setGames]          = useState<LocalGame[]>([]);
  const [gamesState,     setGamesState]     = useState<'idle' | 'loading' | 'done' | 'empty'>('idle');
  const [routes,         setRoutes]         = useState<Record<string, string>>({});
  const [folderFiles,    setFolderFiles]    = useState<LocalFolderEntry[]>([]);
  const [folderLoading,  setFolderLoading]  = useState(false);
  const [activePlatform, setActivePlatform] = useState<PlatformId | null>(null);
  const [selectedGame,   setSelectedGame]   = useState<LocalGame | null>(null);
  const [scanError,      setScanError]      = useState<string | null>(null);
  const [debugInfo,      setDebugInfo]      = useState<string | null>(null);
  const [pathCache,      setPathCache]      = useState<Record<string, MetaEntry>>({});
  const [coverCache,     setCoverCache]     = useState<Record<string, { cover?: string; banner?: string }>>({});
  const [metaProgress,   setMetaProgress]   = useState<MetaProgress | null>(null);
  const [metaSelector,   setMetaSelector]   = useState(false);

  const cancelRef = useRef(false);
  const sectionRefs = useRef<Map<string, HTMLElement>>(new Map());

  // Load saved routes and existing covers on mount (once)
  useEffect(() => {
    readRoutes().then(setRoutes).catch(() => {});
    readMetadataIndex()
      .then(index => {
        console.log('[LocalLibrary] Loaded metadata index on mount:', Object.keys(index).length, 'entries');
        setPathCache(index);
      })
      .catch((err) => {
        console.error('[LocalLibrary] Failed to load metadata index:', err);
      });
  }, []);

  // Convert paths to data URLs
  useEffect(() => {
    const convertPaths = async () => {
      const result: Record<string, { cover?: string; banner?: string }> = {};
      for (const [appId, entry] of Object.entries(pathCache)) {
        const urls: { cover?: string; banner?: string } = {};
        if (entry.cover_path) {
          const url = await pathToDataUrl(entry.cover_path);
          if (url) urls.cover = url;
        }
        if (entry.banner_path) {
          const url = await pathToDataUrl(entry.banner_path);
          if (url) urls.banner = url;
        }
        if (Object.keys(urls).length > 0) {
          result[appId] = urls;
        }
      }
      setCoverCache(result);
    };
    convertPaths();
  }, [pathCache]);

  // Scan folder when category changes and has a route
  useEffect(() => {
    if (activeCategory === 'videojuegos') return;
    const path = routes[activeCategory];
    if (!path) { setFolderFiles([]); return; }
    setFolderLoading(true);
    setFolderFiles([]);
    scanFolderContents(path)
      .then(setFolderFiles)
      .catch(() => setFolderFiles([]))
      .finally(() => setFolderLoading(false));
  }, [activeCategory, routes]);

  const loadGames = useCallback(() => {
    setGamesState('loading');
    setScanError(null);
    setDebugInfo(null);
    scanGamesWithSteam()
      .then(g => {
        const list: LocalGame[] = Array.isArray(g) ? g : [];
        setGames(list);
        setGamesState(list.length === 0 ? 'empty' : 'done');
      })
      .catch((e: unknown) => {
        setScanError(typeof e === 'string' ? e : String(e));
        setGamesState('empty');
      });
  }, []);

  useEffect(() => {
    if (activeCategory === 'videojuegos' && gamesState === 'idle') loadGames();
  }, [activeCategory, gamesState, loadGames]);

  // IntersectionObserver for platform sections
  useEffect(() => {
    if (activeCategory !== 'videojuegos' || gamesState !== 'done') return;
    const observer = new IntersectionObserver(
      entries => {
        const visible = entries
          .filter(e => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible.length > 0) {
          setActivePlatform(visible[0].target.id.replace('launcher-', '') as PlatformId);
        }
      },
      { threshold: 0.25 },
    );
    sectionRefs.current.forEach(el => observer.observe(el));
    return () => observer.disconnect();
  }, [activeCategory, gamesState, games]);

  const scrollToPlatform = useCallback((id: PlatformId) => {
    sectionRefs.current.get(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  const handleSetRoute = useCallback(async (category: CategoryId) => {
    const path = await pickFolder().catch(() => null);
    if (!path) return;
    const updated = { ...routes, [category]: path };
    setRoutes(updated);
    await writeRoutes(updated).catch(() => {});
  }, [routes]);

  const handleClearRoute = useCallback(async (category: CategoryId) => {
    const updated = { ...routes };
    delete updated[category];
    setRoutes(updated);
    setFolderFiles([]);
    await writeRoutes(updated).catch(() => {});
  }, [routes]);

  // ── Fetch metadata ────────────────────────────────────────────────────────

  const handleFetchMetadata = useCallback(async (types: MetaType[]) => {
    const doBasic        = types.includes('basic');
    const doAchievements = types.includes('achievements');

    const allSteam = (Array.isArray(games) ? games : []).filter(g => g.launcher === 'steam' && g.app_id);

    // Skip games that already have everything they need
    const pending = allSteam.filter(g => {
      const cached = pathCache[g.app_id!];
      const basicDone = !doBasic || !!(cached?.cover_path && cached?.banner_path);
      // achievements skip logic is handled Rust-side
      return !basicDone || doAchievements;
    });

    if (pending.length === 0) return;
    setMetaSelector(false);
    cancelRef.current = false;

    const total   = pending.length;
    let   done    = 0;
    setMetaProgress({ total, current: 0, currentName: 'Iniciando…', cancelled: false });

    // Sequential (1 worker): each game makes 3-5 IGDB requests internally.
    // Rust handles 429s with exponential backoff — no need for JS-side concurrency.
    const CONCURRENCY = 1;
    const queue = [...pending];

    async function processOne(game: LocalGame) {
      setMetaProgress({ total, current: done + 1, currentName: game.name, cancelled: false });
      try {
        if (doBasic) await igdbGetCoverBySteamId(game.app_id!, game.name);
        if (doAchievements) await steamAchievementsDownload(game.app_id!).catch(() => {});
      } catch (err) {
        console.error('[META]', game.name, err);
      }
      done++;
    }

    // Worker: pulls from queue until empty or cancelled
    async function worker() {
      while (queue.length > 0 && !cancelRef.current) {
        const game = queue.shift()!;
        await processOne(game);
      }
    }

    await Promise.all(Array.from({ length: CONCURRENCY }, worker));

    readMetadataIndex().then(setCoverCache).catch(() => {});
    setMetaProgress(null);
  }, [games, pathCache]);

  // Group games by launcher
  const safeGames: LocalGame[] = Array.isArray(games) ? games : [];
  const groupedGames = LAUNCHER_ORDER.reduce<Map<PlatformId, LocalGame[]>>((acc, id) => {
    const list = safeGames.filter(g => g.launcher === id);
    if (list.length > 0) acc.set(id, list);
    return acc;
  }, new Map());

  const availablePlatforms = new Set(safeGames.map(g => g.launcher));

  // ── Render ──────────────────────────────────────────────────────────────────

  const navCenterSlot = typeof document !== 'undefined'
    ? document.getElementById('nav-center-slot')
    : null;

  const tabBar = (
    <div className="local-tab-bar">
      {CATEGORIES.map(cat => (
        <button
          key={cat.id}
          type="button"
          className={`local-tab${activeCategory === cat.id ? ' active' : ''}`}
          onClick={() => setActiveCategory(cat.id)}
        >
          {cat.label}
        </button>
      ))}
    </div>
  );

  return (
    <>
      {navCenterSlot ? createPortal(tabBar, navCenterSlot) : tabBar}

      {metaSelector && !metaProgress && (
        <MetaTypeSelector
          onConfirm={handleFetchMetadata}
          onCancel={() => setMetaSelector(false)}
        />
      )}

      {metaProgress && (
        <MetadataModal
          progress={metaProgress}
          onCancel={() => { cancelRef.current = true; setMetaProgress(null); }}
        />
      )}

    <div className="local-library">

      {/* Platform sidebar */}
      {activeCategory === 'videojuegos' && (
        <PlatformSidebar
          activePlatform={activePlatform}
          availablePlatforms={availablePlatforms}
          onSelect={scrollToPlatform}
          onFetchMetadata={() => setMetaSelector(true)}
        />
      )}

      {/* Main area */}
      <div className={`local-games-container${selectedGame ? ' with-detail' : ''}`}>
        <div className="local-main-content">

        {/* ── Content area ──────────────────────────────────────────────────── */}

        {activeCategory === 'videojuegos' ? (
          <div className="local-content">
            <div className="local-content-header">
              <span className="local-content-count">
                {gamesState === 'done' ? `${games.length} juego${games.length !== 1 ? 's' : ''} encontrado${games.length !== 1 ? 's' : ''}` : ''}
              </span>
              <button type="button" className="local-refresh-btn" onClick={loadGames} disabled={gamesState === 'loading'} title={gamesState === 'loading' ? 'Escaneando…' : 'Escanear de nuevo'}>
                <IconRefresh />
              </button>
            </div>

            {gamesState === 'idle' || gamesState === 'loading' ? (
              <div className="local-state-placeholder">
                {gamesState === 'loading' && <div className="spinner" />}
                <p>{gamesState === 'loading' ? 'Buscando juegos instalados…' : ''}</p>
              </div>
            ) : gamesState === 'empty' ? (
              <div className="local-state-placeholder">
                <IconMonitor />
                <p>No se encontraron juegos instalados</p>
                <span>Steam, Epic, GOG, Xbox y EA son compatibles</span>
                {scanError && (
                  <span style={{ color: 'var(--color-error, #ff6b6b)', fontSize: '0.75rem', marginTop: '0.5rem', wordBreak: 'break-word', maxWidth: '400px' }}>
                    Error: {scanError}
                  </span>
                )}
                <button
                  type="button"
                  style={{ marginTop: '0.75rem', fontSize: '0.7rem', opacity: 0.5, background: 'transparent', border: '1px solid currentColor', borderRadius: '4px', padding: '4px 8px', cursor: 'pointer', color: 'inherit' }}
                  onClick={() => debugScanInfo().then(setDebugInfo).catch(e => setDebugInfo(String(e)))}
                >
                  Diagnóstico
                </button>
                {debugInfo && (
                  <pre style={{ fontSize: '0.65rem', textAlign: 'left', marginTop: '0.5rem', background: 'rgba(0,0,0,0.4)', padding: '0.5rem', borderRadius: '4px', maxWidth: '500px', overflowX: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                    {debugInfo}
                  </pre>
                )}
              </div>
            ) : (
              Array.from(groupedGames.entries()).map(([launcher, list], idx) => (
                <section
                  key={launcher}
                  id={`launcher-${launcher}`}
                  ref={el => { if (el) sectionRefs.current.set(launcher, el); }}
                  className="local-launcher-section"
                >
                  <h2 className="local-launcher-title">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem' }}>
                      <span className="local-launcher-icon">
                        <img src={PLATFORM_LOGO[launcher]} alt={PLATFORM_LABEL[launcher]} draggable={false} />
                      </span>
                      {PLATFORM_LABEL[launcher]}
                      <span className="local-launcher-count">{list.length} juego{list.length !== 1 ? 's' : ''}</span>
                    </div>
                    {idx === 0 && (
                      <button type="button" className="local-refresh-btn" onClick={loadGames} disabled={gamesState === 'loading'} title={gamesState === 'loading' ? 'Escaneando…' : 'Escanear de nuevo'}>
                        <IconRefresh />
                      </button>
                    )}
                  </h2>
                  <div className="local-games-grid">
                    {list.map((g, i) => <GameCard key={i} game={g} pathCache={pathCache} coverCache={coverCache} onClick={setSelectedGame} />)}
                  </div>
                </section>
              ))
            )}
          </div>
        ) : (
          <div className="local-content">
            {routes[activeCategory] && (
              <div className="local-content-header">
                <span className="local-folder-path">{routes[activeCategory]}</span>
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                  {!folderLoading && (
                    <span style={{ fontSize: '0.72rem', color: 'var(--text-dim)' }}>
                      {folderFiles.length} elemento{folderFiles.length !== 1 ? 's' : ''}
                    </span>
                  )}
                  <button
                    type="button"
                    className="local-refresh-btn"
                    onClick={() => handleSetRoute(activeCategory)}
                    title="Cambiar carpeta"
                  >
                    <IconFolder />
                  </button>
                  <button
                    type="button"
                    className="local-refresh-btn"
                    onClick={() => handleClearRoute(activeCategory)}
                    title="Quitar ruta"
                    style={{ color: 'var(--color-error, #ff6b6b)' }}
                  >
                    <IconX />
                  </button>
                </div>
              </div>
            )}

            {folderLoading ? (
              <div className="local-state-placeholder"><div className="spinner" /></div>
            ) : !routes[activeCategory] ? (
              <div className="local-state-placeholder">
                <IconFolder />
                <p>Sin carpeta asignada</p>
                <span>Elige una carpeta para explorar tu colección de {CATEGORIES.find(c => c.id === activeCategory)?.label.toLowerCase()}</span>
                <button
                  type="button"
                  className="local-add-route-btn"
                  onClick={() => handleSetRoute(activeCategory)}
                >
                  <IconPlus /> Añadir ruta
                </button>
              </div>
            ) : folderFiles.length === 0 ? (
              <div className="local-state-placeholder">
                <IconFolder />
                <p>Carpeta vacía</p>
                <button
                  type="button"
                  className="local-add-route-btn"
                  onClick={() => handleSetRoute(activeCategory)}
                >
                  Cambiar carpeta
                </button>
              </div>
            ) : (
              <div className="local-folder-grid">
                {folderFiles.map((e, i) => <FolderEntryCard key={i} entry={e} />)}
              </div>
            )}
          </div>
          )}
        </div>

        {selectedGame && <GameDetailPanel game={selectedGame} coverCache={coverCache} onClose={() => setSelectedGame(null)} />}
      </div>
    </div>
    </>
  );
}
