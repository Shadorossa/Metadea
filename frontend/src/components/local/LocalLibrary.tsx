import React, { useState, useEffect, useLayoutEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { igdbGetCoverBySteamId, steamAchievementsDownload, debugScanInfo } from '../../lib/tauri';
import { getT } from '../../i18n/client';

import { CATEGORIES, LAUNCHER_ORDER, PLATFORM_LABEL, PLATFORM_LOGO, type CategoryId, type PlatformId } from './utils/constants';
import { useLocalGames }        from './hooks/useLocalGames';
import { useMetadataCache }     from './hooks/useMetadataCache';
import { useCategoryRoutes }    from './hooks/useCategoryRoutes';
import { useActivePlatform }    from './hooks/useActivePlatform';
import { LOCAL_MEDIA_TYPE_BY_CATEGORY, useLocalMediaData } from './hooks/useLocalMediaEntries';

import { PlatformSidebar }  from './PlatformSidebar';
import { GameCard }         from './cards/GameCard';
import { FolderEntryCard }  from './cards/FolderEntryCard';
import { GameDetailPanel }  from './details/GameDetailPanel';
import { MetadataModal, type MetaProgress } from './modals/MetadataModal';
import { MetaTypeSelector, type MetaType }  from './modals/MetaTypeSelector';
import { LocalMediaSection } from './LocalMediaSection';
import { IconMonitor, IconFolder, IconRefresh, IconPlus, IconX } from './ui/icons';

export default function LocalLibrary() {
  const t = getT();
  const [activeCategory, setActiveCategory] = useState<CategoryId>('videojuegos');
  // Starts null unconditionally (not a lazy initializer reading the DOM) so
  // the client's very first hydration render matches what the server
  // produced (always null, no document there) — reading document.getElementById
  // synchronously in the initializer used to return non-null on that first
  // client render whenever the Navbar's #nav-center-slot was already
  // painted before hydration (the common case), which is exactly what a
  // React hydration mismatch is: the same render producing different output
  // server vs. client. useLayoutEffect below still finds it and commits
  // before the browser paints, so there's no visible flash either way — it
  // just runs strictly after the hydration comparison instead of racing it.
  const [navSlot, setNavSlot] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    const el = document.getElementById('nav-center-slot');
    if (el) setNavSlot(el);
  }, []);
  // Backup for the rarer case where this island mounts before the Navbar
  // has (re)created that node at all — most visibly right after the app's
  // own auto-updater relaunches it, where startup is slower than usual
  // (same fix already applied to SearchIsland.tsx).
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
  const [isMounted, setIsMounted] = useState(false);
  useEffect(() => { setIsMounted(true); }, []);

  const [selectedGame,   setSelectedGame]   = useState<ReturnType<typeof useLocalGames>['games'][0] | null>(null);
  const [metaProgress,   setMetaProgress]   = useState<MetaProgress | null>(null);
  const [metaSelector,   setMetaSelector]   = useState(false);
  const [filterName,     setFilterName]     = useState('');
  const cancelRef = useRef(false);

  const { games, gamesState, scanError, debugInfo, setDebugInfo, loadGames } = useLocalGames();
  const { pathCache, coverCache, refresh: refreshMeta }                       = useMetadataCache();
  const { routes, folderFiles, folderLoading, setRoute, clearRoute, refetchFolder } = useCategoryRoutes(activeCategory);
  const { activePlatform, sectionRefs, scrollTo }                             = useActivePlatform(games, activeCategory, gamesState);
  const { raw: mediaRaw, loading: mediaLoading, refetch: refetchMedia }       = useLocalMediaData();

  // Auto-scan on first visit
  useEffect(() => {
    if (activeCategory === 'videojuegos' && gamesState === 'idle') loadGames();
  }, [activeCategory, gamesState, loadGames]);

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

  // A Steam-scanned "game" that's actually catalogued as a visual novel
  // (matched to a catalog entry of type 'vnovel', e.g. via the auto Steam-ID
  // link or a manual save_game_link) belongs in the Visual Novel tab's own
  // library-backed grid, not duplicated here under Videojuegos.
  const vnovelExternalIds = React.useMemo(() => {
    if (!mediaRaw) return new Set<string>();
    return new Set(mediaRaw.catalog.filter(c => c.type === 'vnovel').map(c => c.external_id));
  }, [mediaRaw]);

  // Alphabetical — scanAllGames/Steam's API return them in filesystem/API
  // order (installed-then-uninstalled, no name ordering within either),
  // which read as arbitrary in the grid. groupedGames below derives from
  // this via .filter(), which preserves order, so sorting once here is
  // enough to alphabetize every platform's own section too.
  const safeGames     = (Array.isArray(games) ? games : [])
    .filter(g => !g.external_id || !vnovelExternalIds.has(g.external_id))
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name));
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

const LOCAL_CATEGORY_TO_SEARCH_TYPE: Record<CategoryId, keyof typeof t.search.types> = {
  'videojuegos':  'game',
  'visual-novel': 'vnovel',
  'anime':        'anime',
  'manga':        'manga',
  'light-novel':  'lnovel',
  'books':        'book',
  'series':       'series',
  'movies':       'movie',
};

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
            {isMounted ? (t.search?.types?.[LOCAL_CATEGORY_TO_SEARCH_TYPE[cat.id]] || cat.label) : cat.label}
          </button>
        ))}
      </div>
      {/* Shared by every category now, not just videojuegos — filters
          LocalMediaSection's own grid the same way it already filtered the
          games list. Always mounted (never conditionally rendered): the
          category buttons sit in a centered flex row, so mounting/
          unmounting this on a category switch used to change the row's
          total width and recenter everything, shifting every tab button
          sideways. */}
      <input
        type="text"
        className="local-tab-search"
        placeholder="Buscar…"
        value={filterName}
        onChange={e => setFilterName(e.target.value)}
      />
    </div>
  );

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <>
      {/* Never rendered inline as a fallback — an unportaled tab bar showing
          up in the page body for one frame, then jumping into the navbar
          the instant navSlot resolves, is exactly what read as "the navbar
          itself shifting." Nothing beats a flash in the wrong place. */}
      {navSlot && createPortal(tabBar, navSlot)}

      {metaSelector && !metaProgress && (
        <MetaTypeSelector onConfirm={handleFetchMetadata} onCancel={() => setMetaSelector(false)} />
      )}
      {metaProgress && (
        <MetadataModal
          progress={metaProgress}
          onCancel={() => { cancelRef.current = true; setMetaProgress(null); }}
        />
      )}

      <div className="local-library">
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
            onRootRefresh={refetchFolder}
            filterName={filterName}
            mediaRaw={mediaRaw}
            mediaLoading={mediaLoading}
            refetchMedia={refetchMedia}
          />
        ) : (
        <div className={`local-games-container${selectedGame ? ' with-detail' : ''}`}>
          <div className="local-main-content">

            {/* ── Games view ─────────────────────────────────────────────────── */}
            {activeCategory === 'videojuegos' ? (
              <div className="local-content">
                <div className="local-content-header">
                  <span className="local-content-count">
                    {gamesState === 'done' ? (games.length !== 1 ? t.local.games_count.replace('{count}', String(games.length)) : t.local.game_count.replace('{count}', String(games.length))) : ''}
                  </span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    {routes['videojuegos'] && (
                      <>
                        <span className="local-folder-path" style={{ fontSize: '0.7rem' }}>{routes['videojuegos']}</span>
                        <button type="button" className="local-refresh-btn" onClick={() => clearRoute('videojuegos')} title={isMounted ? t.local.remove_local_folder : 'Quitar carpeta local'} style={{ color: 'var(--color-error, #ff6b6b)' }}>
                          <IconX />
                        </button>
                      </>
                    )}
                    <button type="button" className="local-refresh-btn" onClick={() => setRoute('videojuegos')} title={isMounted ? (routes['videojuegos'] ? t.local.change_folder : t.local.add_folder) : (routes['videojuegos'] ? 'Cambiar carpeta' : 'Añadir carpeta')}>
                      <IconFolder />
                    </button>
                    <button type="button" className="local-refresh-btn" onClick={loadGames} disabled={gamesState === 'loading'} title={isMounted ? (gamesState === 'loading' ? t.local.scanning : t.local.scan_again) : (gamesState === 'loading' ? 'Escaneando…' : 'Escanear de nuevo')}>
                      <IconRefresh />
                    </button>
                  </div>
                </div>

                {gamesState === 'idle' || gamesState === 'loading' ? (
                  <div className="local-state-placeholder">
                    {gamesState === 'loading' && <div className="spinner" />}
                    <p>{gamesState === 'loading' ? t.local.scanning_installed : ''}</p>
                  </div>
                ) : gamesState === 'empty' ? (
                  <div className="local-state-placeholder">
                    <IconMonitor />
                    <p>{t.local.no_games_found}</p>
                    <span>{t.local.compatible_launchers}</span>
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
                      {t.local.diagnostics}
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
                      <button type="button" className="local-refresh-btn" onClick={() => setRoute(activeCategory)} title={t.local.change_folder}><IconFolder /></button>
                      <button type="button" className="local-refresh-btn" onClick={() => clearRoute(activeCategory)} title={t.local.remove_route} style={{ color: 'var(--color-error, #ff6b6b)' }}><IconX /></button>
                    </div>
                  </div>
                )}

                {folderLoading ? (
                  <div className="local-state-placeholder"><div className="spinner" /></div>
                ) : !routes[activeCategory] ? (
                  <div className="local-state-placeholder">
                    <IconFolder />
                    <p>{t.local.no_folder_assigned}</p>
                    <span>{t.local.choose_folder_category_hint.replace('{category}', String(CATEGORIES.find(c => c.id === activeCategory)?.label.toLowerCase()))}</span>
                    <button type="button" className="local-add-route-btn" onClick={() => setRoute(activeCategory)}>
                      <IconPlus /> {t.local.add_route}
                    </button>
                  </div>
                ) : folderFiles.length === 0 ? (
                  <div className="local-state-placeholder">
                    <IconFolder />
                    <p>{t.local.empty_folder}</p>
                    <button type="button" className="local-add-route-btn" onClick={() => setRoute(activeCategory)}>{t.local.change_folder}</button>
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
