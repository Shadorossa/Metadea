import React, { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { igdbGetCoverBySteamId, steamAchievementsDownload, debugScanInfo } from '../../lib/tauri';

import { CATEGORIES, LAUNCHER_ORDER, PLATFORM_LABEL, PLATFORM_LOGO, type CategoryId, type PlatformId } from './utils/constants';
import { useLocalGames }        from './hooks/useLocalGames';
import { useMetadataCache }     from './hooks/useMetadataCache';
import { useCategoryRoutes }    from './hooks/useCategoryRoutes';
import { useActivePlatform }    from './hooks/useActivePlatform';
import { LOCAL_MEDIA_TYPE_BY_CATEGORY } from './hooks/useLocalMediaEntries';

import { PlatformSidebar }  from './PlatformSidebar';
import { GameCard }         from './cards/GameCard';
import { FolderEntryCard }  from './cards/FolderEntryCard';
import { GameDetailPanel }  from './details/GameDetailPanel';
import { MetadataModal, type MetaProgress } from './modals/MetadataModal';
import { MetaTypeSelector, type MetaType }  from './modals/MetaTypeSelector';
import { LocalMediaSection } from './LocalMediaSection';
import { IconMonitor, IconFolder, IconRefresh, IconPlus, IconX } from './ui/icons';

// How long the category-switch fade-in animation runs — must match
// local-library-enter's own duration in local.css.
const ENTER_ANIM_MS = 340;

export default function LocalLibrary() {
  const [activeCategory, setActiveCategory] = useState<CategoryId>('videojuegos');
  // On a full page load the Navbar's #nav-center-slot is already painted
  // before React hydrates, so a one-time getElementById resolves it fine.
  // But this island can mount before the Navbar has (re)created that node —
  // most visibly right after the app's own auto-updater relaunches it, where
  // startup is slower than usual — so a one-shot check misses it forever and
  // the tab bar renders inline in the page instead of the navbar. Poll a few
  // frames until the node shows up (same fix already applied to
  // SearchIsland.tsx).
  const [navSlot, setNavSlot] = useState<HTMLElement | null>(null);
  useEffect(() => {
    let rafId: number;
    let attempts = 0;
    const findSlot = () => {
      const el = document.getElementById('nav-center-slot');
      if (el) {
        setNavSlot(el);
      } else if (attempts++ < 60) {
        rafId = requestAnimationFrame(findSlot);
      }
    };
    findSlot();
    return () => cancelAnimationFrame(rafId);
  }, []);
  // The "entering" class (drives the fade-in) is only ever applied for this
  // one animation, then removed — a stray CSS property left permanently
  // attached via a never-toggled className (as this used to be) is exactly
  // how the sticky game-detail-panel/platform-sidebar bug happened before:
  // a since-removed `transform` in that animation's keyframes, held forever
  // by animation-fill-mode, silently broke `position: sticky` on every
  // descendant. Toggling the class off after it plays removes that whole
  // category of bug for any future change to this animation, not just the
  // one that already bit us.
  const [entering, setEntering] = useState(true);
  const [selectedGame,   setSelectedGame]   = useState<ReturnType<typeof useLocalGames>['games'][0] | null>(null);
  const [metaProgress,   setMetaProgress]   = useState<MetaProgress | null>(null);
  const [metaSelector,   setMetaSelector]   = useState(false);
  const [filterName,     setFilterName]     = useState('');
  const cancelRef = useRef(false);

  const { games, gamesState, scanError, debugInfo, setDebugInfo, loadGames } = useLocalGames();
  const { pathCache, coverCache, refresh: refreshMeta }                       = useMetadataCache();
  const { routes, folderFiles, folderLoading, setRoute, clearRoute }          = useCategoryRoutes(activeCategory);
  const { activePlatform, sectionRefs, scrollTo }                             = useActivePlatform(games, activeCategory, gamesState);

  // Auto-scan on first visit
  useEffect(() => {
    if (activeCategory === 'videojuegos' && gamesState === 'idle') loadGames();
  }, [activeCategory, gamesState, loadGames]);

  // Re-plays the fade-in (and, critically, clears the "entering" class
  // afterwards) whenever the category switch remounts this subtree — see
  // the `entering` state's own comment above for why it can't just stay on.
  useEffect(() => {
    setEntering(true);
    const t = setTimeout(() => setEntering(false), ENTER_ANIM_MS);
    return () => clearTimeout(t);
  }, [activeCategory]);

  // ── Fetch metadata ───────────────────────────────────────────────────────────

  const handleFetchMetadata = useCallback(async (types: MetaType[]) => {
    const doBasic        = types.includes('basic');
    const doAchievements = types.includes('achievements');

    const pending = games
      .filter(g => g.launcher === 'steam' && g.app_id)
      .filter(g => {
        const cached    = pathCache[g.app_id!];
        const basicDone = !doBasic || !!(cached?.cover_path && cached?.banner_path);
        return !basicDone || doAchievements;
      });

    if (pending.length === 0) return;
    setMetaSelector(false);
    cancelRef.current = false;

    let done = 0;
    setMetaProgress({ total: pending.length, current: 0, currentName: 'Iniciando…', cancelled: false });

    const queue = [...pending];

    async function processOne(game: typeof pending[0]) {
      setMetaProgress({ total: pending.length, current: done + 1, currentName: game.name, cancelled: false });
      try {
        if (doBasic)        await igdbGetCoverBySteamId(game.app_id!, game.name);
        if (doAchievements) await steamAchievementsDownload(game.app_id!).catch(() => {});
      } catch (err) {
        console.error('[META]', game.name, err);
      }
      done++;
    }

    // Single worker — each game makes 3-5 IGDB requests handled with backoff in Rust
    async function worker() {
      while (queue.length > 0 && !cancelRef.current) {
        await processOne(queue.shift()!);
      }
    }

    await worker();
    await refreshMeta();
    setMetaProgress(null);
  }, [games, pathCache, refreshMeta]);

  // ── Derived state ────────────────────────────────────────────────────────────

  const safeGames     = Array.isArray(games) ? games : [];
  const filteredGames = filterName.trim()
    ? safeGames.filter(g => g.name.toLowerCase().includes(filterName.toLowerCase()))
    : safeGames;

  const groupedGames = LAUNCHER_ORDER.reduce<Map<PlatformId, typeof safeGames>>((acc, id) => {
    const list = filteredGames.filter(g => g.launcher === id);
    if (list.length > 0) acc.set(id, list);
    return acc;
  }, new Map());

  const availablePlatforms = new Set(safeGames.map(g => g.launcher));

  // ── Tab bar (portaled into nav) ──────────────────────────────────────────────

  const tabBar = (
    <div className="local-tab-bar">
      <div className="local-tab-buttons">
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
      {activeCategory === 'videojuegos' && (
        <input
          type="text"
          className="local-tab-search"
          placeholder="Buscar juego…"
          value={filterName}
          onChange={e => setFilterName(e.target.value)}
        />
      )}
    </div>
  );

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <>
      {navSlot ? createPortal(tabBar, navSlot) : tabBar}

      {metaSelector && !metaProgress && (
        <MetaTypeSelector onConfirm={handleFetchMetadata} onCancel={() => setMetaSelector(false)} />
      )}
      {metaProgress && (
        <MetadataModal
          progress={metaProgress}
          onCancel={() => { cancelRef.current = true; setMetaProgress(null); }}
        />
      )}

      <div key={activeCategory} className={`local-library${entering ? ' entering' : ''}`}>
        {activeCategory === 'videojuegos' && activePlatform && availablePlatforms && (
          <PlatformSidebar
            activePlatform={activePlatform}
            availablePlatforms={availablePlatforms}
            onSelect={scrollTo}
            onFetchMetadata={() => setMetaSelector(true)}
          />
        )}

        {LOCAL_MEDIA_TYPE_BY_CATEGORY[activeCategory] ? (
          <LocalMediaSection
            category={activeCategory}
            rootFolder={routes[activeCategory]}
            rootEntries={folderFiles}
            rootLoading={folderLoading}
            onSetRoute={() => setRoute(activeCategory)}
            onClearRoute={() => clearRoute(activeCategory)}
          />
        ) : (
        <div className={`local-games-container${selectedGame ? ' with-detail' : ''}`}>
          <div className="local-main-content">

            {/* ── Games view ─────────────────────────────────────────────────── */}
            {activeCategory === 'videojuegos' ? (
              <div className="local-content">
                <div className="local-content-header">
                  <span className="local-content-count">
                    {gamesState === 'done' ? `${games.length} juego${games.length !== 1 ? 's' : ''} encontrado${games.length !== 1 ? 's' : ''}` : ''}
                  </span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    {routes['videojuegos'] && (
                      <>
                        <span className="local-folder-path" style={{ fontSize: '0.7rem' }}>{routes['videojuegos']}</span>
                        <button type="button" className="local-refresh-btn" onClick={() => clearRoute('videojuegos')} title="Quitar carpeta local" style={{ color: 'var(--color-error, #ff6b6b)' }}>
                          <IconX />
                        </button>
                      </>
                    )}
                    <button type="button" className="local-refresh-btn" onClick={() => setRoute('videojuegos')} title={routes['videojuegos'] ? 'Cambiar carpeta' : 'Añadir carpeta'}>
                      <IconFolder />
                    </button>
                    <button type="button" className="local-refresh-btn" onClick={loadGames} disabled={gamesState === 'loading'} title={gamesState === 'loading' ? 'Escaneando…' : 'Escanear de nuevo'}>
                      <IconRefresh />
                    </button>
                  </div>
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
                            {PLATFORM_LOGO[launcher]
                              ? <img src={PLATFORM_LOGO[launcher]} alt={PLATFORM_LABEL[launcher]} draggable={false} />
                              : <IconFolder />}
                          </span>
                          {PLATFORM_LABEL[launcher]}
                          <span className="local-launcher-count">{list.length} juego{list.length !== 1 ? 's' : ''}</span>
                        </div>
                        {idx === 0 && (
                          <button type="button" className="local-refresh-btn" onClick={loadGames} disabled={gamesState === 'loading'}>
                            <IconRefresh />
                          </button>
                        )}
                      </h2>
                      <div className="local-games-grid">
                        {list.map((g, i) => (
                          <GameCard key={i} game={g} coverCache={coverCache} onClick={setSelectedGame} />
                        ))}
                      </div>
                    </section>
                  ))
                )}
              </div>

            ) : (
              /* ── Folder view (categories without a library-backed grid, e.g. visual-novel) ── */
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
                      <button type="button" className="local-refresh-btn" onClick={() => setRoute(activeCategory)} title="Cambiar carpeta"><IconFolder /></button>
                      <button type="button" className="local-refresh-btn" onClick={() => clearRoute(activeCategory)} title="Quitar ruta" style={{ color: 'var(--color-error, #ff6b6b)' }}><IconX /></button>
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
                    <button type="button" className="local-add-route-btn" onClick={() => setRoute(activeCategory)}>
                      <IconPlus /> Añadir ruta
                    </button>
                  </div>
                ) : folderFiles.length === 0 ? (
                  <div className="local-state-placeholder">
                    <IconFolder />
                    <p>Carpeta vacía</p>
                    <button type="button" className="local-add-route-btn" onClick={() => setRoute(activeCategory)}>Cambiar carpeta</button>
                  </div>
                ) : (
                  <div className="local-folder-grid">
                    {folderFiles.map((e, i) => <FolderEntryCard key={i} entry={e} />)}
                  </div>
                )}
              </div>
            )}
          </div>

          {selectedGame && (
            <GameDetailPanel
              game={selectedGame}
              coverCache={coverCache}
              onClose={() => setSelectedGame(null)}
              onMetaRefresh={refreshMeta}
            />
          )}
        </div>
        )}
      </div>
    </>
  );
}
