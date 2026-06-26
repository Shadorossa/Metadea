import React, { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  scanAllGames, pickFolder, scanFolderContents,
  readRoutes, writeRoutes, debugScanInfo,
  igdbGetCoverBySteamId, readMetadataIndex,
  type LocalGame, type LocalFolderEntry,
} from '../../lib/tauri';

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
  coverCache: Record<string, string>;
  onClick: (game: LocalGame) => void;
}

function GameCard({ game, coverCache, onClick }: GameCardProps) {
  // coverCache values are data URLs ("data:image/jpeg;base64,...") from read_metadata_index
  const dataUrl = game.app_id ? coverCache[game.app_id] : undefined;
  const cover = dataUrl ?? (game.launcher === 'steam' && game.app_id ? STEAM_COVER(game.app_id) : null);

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
  onClose: () => void;
}

function GameDetailPanel({ game, onClose }: GameDetailPanelProps) {
  const cover = game.launcher === 'steam' && game.app_id
    ? STEAM_COVER(game.app_id)
    : null;

  const handlePlay = () => {
    // Por ahora solo un placeholder - se puede implementar abrir carpeta con Tauri
    console.log('Jugar:', game.name, game.install_path);
  };

  return (
    <div className="local-game-detail-panel">
        <div className="local-game-detail-header">
          {cover ? (
            <img src={cover} alt={game.name} />
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
          <p className="local-game-detail-title">{game.name}</p>

          <div className="local-game-detail-meta">
            <div className="local-game-detail-platform">
              <span className="local-game-detail-platform-icon">
                <img src={PLATFORM_LOGO[game.launcher as PlatformId]} alt={game.launcher} draggable={false} />
              </span>
              <span>{PLATFORM_LABEL[game.launcher as PlatformId]}</span>
            </div>
            {game.install_path && (
              <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)', wordBreak: 'break-word' }}>
                {game.install_path}
              </div>
            )}
          </div>

          <div className="local-game-detail-actions">
            <button className="local-game-detail-play" onClick={handlePlay}>
              <svg width={16} height={16} viewBox="0 0 24 24" fill="currentColor">
                <polygon points="5 3 19 12 5 21 5 3" />
              </svg>
              Jugar
            </button>
          </div>
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
  const [coverCache,     setCoverCache]     = useState<Record<string, string>>({});
  const [metaProgress,   setMetaProgress]   = useState<MetaProgress | null>(null);

  const cancelRef = useRef(false);
  const sectionRefs = useRef<Map<string, HTMLElement>>(new Map());

  // Load saved routes and existing covers on mount
  useEffect(() => {
    readRoutes().then(setRoutes).catch(() => {});
    readMetadataIndex().then(setCoverCache).catch(() => {});
  }, []);

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
    scanAllGames()
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

  // ── Fetch IGDB metadata ────────────────────────────────────────────────────

  const handleFetchMetadata = useCallback(async () => {
    const steamGames = (Array.isArray(games) ? games : []).filter(
      g => g.launcher === 'steam' && g.app_id,
    );
    if (steamGames.length === 0) return;

    cancelRef.current = false;
    setMetaProgress({ total: steamGames.length, current: 0, currentName: 'Iniciando…', cancelled: false });

    for (let i = 0; i < steamGames.length; i++) {
      if (cancelRef.current) break;
      const game = steamGames[i];
      setMetaProgress({ total: steamGames.length, current: i + 1, currentName: game.name, cancelled: false });

      try {
        // Rust handles the file-existence check; no JS-side skip needed
        await igdbGetCoverBySteamId(game.app_id!, game.name);
      } catch (err) {
        console.error('[META]', game.name, err);
      }

      // Small delay to stay within IGDB rate limits (4 req/s)
      await new Promise(r => setTimeout(r, 300));
    }

    // Reload all covers from disk as data URLs
    readMetadataIndex().then(setCoverCache).catch(() => {});
    setMetaProgress(null);
  }, [games]);

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
          onFetchMetadata={handleFetchMetadata}
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
                    {list.map((g, i) => <GameCard key={i} game={g} coverCache={coverCache} onClick={setSelectedGame} />)}
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

        {selectedGame && <GameDetailPanel game={selectedGame} onClose={() => setSelectedGame(null)} />}
      </div>
    </div>
    </>
  );
}
