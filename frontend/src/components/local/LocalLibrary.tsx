import { useState, useEffect, useCallback, useRef } from 'react';
import {
  scanAllGames, pickFolder, scanFolderContents,
  getLocalFolders, saveLocalFolders,
  type LocalGame, type LocalFolderEntry, type SavedFolder,
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
  onClick: (game: LocalGame) => void;
}

function GameCard({ game, onClick }: GameCardProps) {
  const cover = game.launcher === 'steam' && game.app_id
    ? STEAM_COVER(game.app_id)
    : null;

  return (
    <div className="local-game-card" onClick={() => onClick(game)} role="button" tabIndex={0} onKeyDown={e => e.key === 'Enter' && onClick(game)}>
      <div className="local-game-cover">
        {cover
          ? <img src={cover} alt={game.name} loading="lazy" onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
          : <div className="local-game-cover-placeholder"><IconMonitor /></div>
        }
        <span className={`local-game-badge local-game-badge--${game.launcher}`}>
          {PLATFORM_LABEL[game.launcher as PlatformId] ?? game.launcher}
        </span>
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

// ── Platform sidebar ──────────────────────────────────────────────────────────

interface PlatformSidebarProps {
  activePlatform: PlatformId | null;
  availablePlatforms: Set<string>;
  onSelect: (id: PlatformId) => void;
}

function PlatformSidebar({ activePlatform, availablePlatforms, onSelect }: PlatformSidebarProps) {
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
    </aside>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function LocalLibrary() {
  const [activeCategory,   setActiveCategory]   = useState<CategoryId>('videojuegos');
  const [games,            setGames]            = useState<LocalGame[]>([]);
  const [gamesState,       setGamesState]       = useState<'idle' | 'loading' | 'done' | 'empty'>('idle');
  const [folders,          setFolders]          = useState<SavedFolder[]>([]);
  const [folderFiles,      setFolderFiles]      = useState<LocalFolderEntry[]>([]);
  const [folderLoading,    setFolderLoading]    = useState(false);
  const [addingFolder,     setAddingFolder]     = useState(false);
  const [newLabel,         setNewLabel]         = useState('');
  const [activePlatform,   setActivePlatform]   = useState<PlatformId | null>(null);
  const [selectedGame,     setSelectedGame]     = useState<LocalGame | null>(null);

  const sectionRefs = useRef<Map<string, HTMLElement>>(new Map());

  // Load saved folders on mount
  useEffect(() => {
    getLocalFolders().then(setFolders).catch(() => {});
  }, []);

  // Load folder contents when viewing a custom folder
  useEffect(() => {
    if (activeCategory === 'videojuegos') return;
    setFolderLoading(true);
    setFolderFiles([]);
    const folder = folders.find(f => f.path === activeCategory);
    if (folder) {
      scanFolderContents(folder.path)
        .then(setFolderFiles)
        .catch(() => setFolderFiles([]))
        .finally(() => setFolderLoading(false));
    } else {
      setFolderLoading(false);
    }
  }, [activeCategory, folders]);

  const loadGames = useCallback(() => {
    setGamesState('loading');
    scanAllGames()
      .then(g => {
        setGames(g);
        setGamesState(g.length === 0 ? 'empty' : 'done');
      })
      .catch(() => setGamesState('empty'));
  }, []);

  // Auto-load games on first render of videojuegos category
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
    const el = sectionRefs.current.get(id);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, []);

  const handleAddFolder = useCallback(async () => {
    const path = await pickFolder().catch(() => null);
    if (!path || !newLabel.trim()) return;
    const updated = [...folders, { path, label: newLabel.trim() }];
    setFolders(updated);
    await saveLocalFolders(updated).catch(() => {});
    setAddingFolder(false);
    setNewLabel('');
  }, [folders, newLabel]);

  const handleRemoveFolder = useCallback((path: string) => {
    const updated = folders.filter(f => f.path !== path);
    setFolders(updated);
    saveLocalFolders(updated).catch(() => {});
    if (activeCategory === path) setActiveCategory('videojuegos');
  }, [folders, activeCategory]);

  // Group games by launcher
  const groupedGames = LAUNCHER_ORDER.reduce<Map<PlatformId, LocalGame[]>>((acc, id) => {
    const list = games.filter(g => g.launcher === id);
    if (list.length > 0) acc.set(id, list);
    return acc;
  }, new Map());

  const availablePlatforms = new Set(games.map(g => g.launcher));

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="local-library">

      {/* Platform sidebar */}
      {activeCategory === 'videojuegos' && (
        <PlatformSidebar
          activePlatform={activePlatform}
          availablePlatforms={availablePlatforms}
          onSelect={scrollToPlatform}
        />
      )}

      {/* Main area */}
      <div className={`local-games-container${selectedGame ? ' with-detail' : ''}`}>
        <div className="local-main-content">

          {/* Category tabs */}
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

          {/* Custom folders */}
          {folders.map(f => (
            <button
              key={f.path}
              type="button"
              className={`local-tab${activeCategory === f.path ? ' active' : ''}`}
              onClick={() => setActiveCategory(f.path as CategoryId)}
            >
              {f.label}
              <span
                className="local-tab-remove"
                role="button"
                tabIndex={0}
                onClick={e => { e.stopPropagation(); handleRemoveFolder(f.path); }}
                onKeyDown={e => e.key === 'Enter' && handleRemoveFolder(f.path)}
              >
                <IconX />
              </span>
            </button>
          ))}

          {addingFolder ? (
            <div className="local-add-folder-form">
              <input
                className="local-add-folder-input"
                placeholder="Etiqueta (ej. Anime)"
                value={newLabel}
                onChange={e => setNewLabel(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleAddFolder()}
                autoFocus
              />
              <button type="button" className="local-add-folder-confirm" onClick={handleAddFolder}>
                Elegir carpeta
              </button>
              <button type="button" className="local-add-folder-cancel" onClick={() => { setAddingFolder(false); setNewLabel(''); }}>
                <IconX />
              </button>
            </div>
          ) : (
            <button type="button" className="local-tab local-tab-add" onClick={() => setAddingFolder(true)}>
              <IconPlus /> Añadir carpeta
            </button>
          )}
        </div>

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
                    {list.map((g, i) => <GameCard key={i} game={g} onClick={setSelectedGame} />)}
                  </div>
                </section>
              ))
            )}
          </div>
        ) : (
          <div className="local-content">
            <div className="local-content-header">
              <span className="local-content-count">
                {!folderLoading && `${folderFiles.length} elemento${folderFiles.length !== 1 ? 's' : ''}`}
              </span>
              {folders.find(f => f.path === activeCategory) && (
                <span className="local-folder-path">
                  {folders.find(f => f.path === activeCategory)?.path}
                </span>
              )}
            </div>

            {folderLoading ? (
              <div className="local-state-placeholder"><div className="spinner" /></div>
            ) : folderFiles.length === 0 ? (
              <div className="local-state-placeholder">
                <IconFolder />
                <p>Carpeta vacía</p>
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
  );
}
