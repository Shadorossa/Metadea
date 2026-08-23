import React, { useState, useEffect, useLayoutEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { igdbGetCoverBySteamId, steamAchievementsDownload, debugScanInfo, listenGameSessionEnded, addPlaytimeHours, type LocalGame } from '../../lib/tauri';
import { getT } from '../../i18n/client';

import { CATEGORIES, LAUNCHER_ORDER, PLATFORM_LABEL, PLATFORM_LOGO, type CategoryId, type PlatformId } from './utils/constants';
import { useLocalGames }        from './hooks/useLocalGames';
import { useMetadataCache }     from './hooks/useMetadataCache';
import { useCategoryRoutes }    from './hooks/useCategoryRoutes';
import { useActivePlatform }    from './hooks/useActivePlatform';
import { LOCAL_MEDIA_TYPE_BY_CATEGORY, useLocalMediaItemsByType, useLocalMediaData, type LocalMediaItem } from './hooks/useLocalMediaEntries';
import { isInProgressStatus } from '../../lib/constants/media';
import { buildLibraryStatusEntries, type StatusEntry } from './utils/catalogGameLinking';

import { PlatformSidebar }  from './PlatformSidebar';
import { GameCard }         from './cards/GameCard';
import { LocalMediaCard }   from './cards/LocalMediaCard';
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

  const [selectedGameRaw,   setSelectedGameRaw]   = useState<ReturnType<typeof useLocalGames>['games'][0] | null>(null);
  // A "Pendiente" entry with no scanned Steam/Epic/... install still opens
  // this same panel (per the user's own framing: "no que te envíe a su
  // media page") — GameDetailPanel builds a synthetic, unlaunchable
  // LocalGame for it below (see openPendingItem).
  const [selectedPendingItem, setSelectedPendingItem] = useState<LocalMediaItem | null>(null);
  // Set when the selected item is a season/update tracked separately from
  // its source game — the panel still shows the season's own title/cover,
  // but "Jugar" launches this (the source's real, installed LocalGame)
  // instead, since the season itself was never separately installable.
  const [selectedPendingLaunchGame, setSelectedPendingLaunchGame] = useState<LocalGame | undefined>(undefined);
  const setSelectedGame = (g: (typeof selectedGameRaw)) => { setSelectedGameRaw(g); if (g) setSelectedPendingItem(null); };
  const openPendingItem = (item: LocalMediaItem, launchGame?: LocalGame) => {
    setSelectedPendingItem(item);
    setSelectedPendingLaunchGame(launchGame);
    setSelectedGameRaw(null);
  };
  const selectedGame = selectedGameRaw;
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

  // Keeps the hours-played log up to date on its own — a game launched from
  // GameDetailPanel's "Jugar" button (see startPlaytimeSession there) fires
  // this, whenever it actually exits, with the real elapsed session time.
  // Mounted for as long as the Local page itself is (covers both
  // Videojuegos and Visual Novel, whichever category was active when the
  // game was launched), not tied to any one open panel — a session can run
  // for hours after the panel that started it was closed.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    listenGameSessionEnded(({ external_id, hours }) => {
      addPlaytimeHours(external_id, hours).then(refetchMedia).catch(console.error);
    }).then(fn => { unlisten = fn; });
    return () => unlisten?.();
  }, [refetchMedia]);

  // ── Fetch metadata ───────────────────────────────────────────────────────────

  const handleFetchMetadata = useCallback(async (types: MetaType[]) => {
    const doBasic        = types.includes('basic');
    const doAchievements = types.includes('achievements');

    // Achievements stay Steam-only (Steam's own Web API — GOG Galaxy has
    // its own separate achievements system this doesn't talk to at all),
    // but basic metadata (cover/banner, resolved by name via IGDB) works
    // the same regardless of launcher — see resolve_igdb_game's own launcher
    // param, which just skips the Steam-App-ID-specific shortcuts for
    // anything that isn't actually a Steam app_id.
    const pending = games
      .filter(g => (g.launcher === 'steam' || g.launcher === 'gog') && g.app_id)
      .filter(g => {
        const cached    = pathCache[g.app_id!];
        const basicDone = !doBasic || !!(cached?.cover_path && cached?.banner_path);
        const achievementsRelevant = doAchievements && g.launcher === 'steam';
        return !basicDone || achievementsRelevant;
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
        if (doBasic) await igdbGetCoverBySteamId(game.app_id!, game.name, game.launcher);
        if (doAchievements && game.launcher === 'steam') await steamAchievementsDownload(game.app_id!).catch(() => {});
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
  // belongs in the Visual Novel tab's own library-backed grid, not
  // duplicated here under Videojuegos. Checks BOTH `type` ('vnovel', set
  // when added through the VN search tab) and `format` ('VISUAL_NOVEL',
  // set the same way — see igdb.ts's search) since an entry added through
  // the plain "game" search tab for the same IGDB id ends up with
  // type:'game' but still gets format:'VISUAL_NOVEL' tagged on it.
  const vnovelExternalIds = React.useMemo(() => {
    if (!mediaRaw) return new Set<string>();
    return new Set(mediaRaw.catalog.filter(c => c.type === 'vnovel' || c.format === 'VISUAL_NOVEL').map(c => c.external_id));
  }, [mediaRaw]);

  // Catches VN games nobody's manually catalogued yet — is_vn comes from
  // the game's own cached IGDB metadata genre (see read_metadata_index),
  // so this works for any Steam game once its metadata has been fetched at
  // least once, without the user having to log it in their library first.
  const isSteamVN = React.useCallback(
    (g: (typeof games)[number]) =>
      (!!g.external_id && vnovelExternalIds.has(g.external_id)) ||
      (!!g.app_id && !!pathCache[g.app_id]?.is_vn),
    [vnovelExternalIds, pathCache],
  );

  // Matches every Steam-scanned game to its real library entry — by actual
  // identity (external_id from local_game_links, or the igdb_id
  // read_metadata_index caches per app_id), same "vnovel:<id>"/"game:<id>"
  // resolution "Ver en catálogo" and the Visual Novel tab's own matching
  // already use. Keyed by the game object itself so callers can look up a
  // status without re-deriving candidate ids each time.
  const gameStatusMatch = React.useMemo(() => {
    const result = new Map<(typeof games)[number], string | undefined>();
    if (!mediaRaw) return result;
    const byExternalId = new Map(mediaRaw.entries.map(e => [e.external_id, e]));
    for (const g of Array.isArray(games) ? games : []) {
      const igdbId = g.app_id ? pathCache[g.app_id]?.igdb_id : undefined;
      const candidateIds = [
        g.external_id,
        igdbId != null ? `vnovel:${igdbId}` : undefined,
        igdbId != null ? `game:${igdbId}` : undefined,
      ].filter((id): id is string => !!id);
      const matched = candidateIds.map(id => byExternalId.get(id)).find(Boolean);
      result.set(g, matched?.status ?? undefined);
    }
    return result;
  }, [games, mediaRaw, pathCache]);

  // Alphabetical — scanAllGames/Steam's API return them in filesystem/API
  // order (installed-then-uninstalled, no name ordering within either),
  // which read as arbitrary in the grid. groupedGames below derives from
  // this via .filter(), which preserves order, so sorting once here is
  // enough to alphabetize every platform's own section too.
  const safeGames     = (Array.isArray(games) ? games : [])
    .filter(g => !isSteamVN(g))
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name));
  const filterGames = <G extends { name: string }>(list: G[]): G[] =>
    filterName.trim() ? list.filter(g => g.name.toLowerCase().includes(filterName.toLowerCase())) : list;

  // The flip side of the exclusion above — every Steam-scanned VN, shown in
  // the Visual Novel tab instead (see LocalMediaSection's steamGames prop)
  // with the exact same card/detail-panel experience (achievements, launch
  // via Steam) Videojuegos already gives every other game.
  const vnSteamGames = React.useMemo(() => {
    const list = (Array.isArray(games) ? games : [])
      .filter(isSteamVN)
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name));
    const q = filterName.trim().toLowerCase();
    return q ? list.filter(g => g.name.toLowerCase().includes(q)) : list;
  }, [games, isSteamVN, filterName]);

  // Platform groups keep only the games with no real library status worth
  // pulling out on their own (no match at all, or completed) — anything
  // matched to En progreso/Pendiente/Pausado/Abandonado moves up into its
  // own status section instead (see statusBuckets below), same as every
  // other Local category groups by status. "Agrupar por plataforma" is
  // still the layout for whatever's left, per the user's own framing:
  // "dejando los grupos de plataformas [...] muevas a los estados [...]
  // las obras que correspondan."
  const statusBuckets = React.useMemo(() => {
    const buckets: Record<'currently' | 'planning' | 'paused' | 'dropped', (typeof safeGames)> = {
      currently: [], planning: [], paused: [], dropped: [],
    };
    const rest: typeof safeGames = [];
    for (const g of safeGames) {
      const status = gameStatusMatch.get(g);
      if (!status || status === 'completed') { rest.push(g); continue; }
      if (isInProgressStatus(status)) buckets.currently.push(g);
      else if (status === 'planning') buckets.planning.push(g);
      else if (status === 'paused') buckets.paused.push(g);
      else if (status === 'dropped') buckets.dropped.push(g);
      else rest.push(g);
    }
    return { ...buckets, rest };
  }, [safeGames, gameStatusMatch]);

  const groupedGames = LAUNCHER_ORDER.reduce<Map<PlatformId, typeof safeGames>>((acc, id) => {
    const list = filterGames(statusBuckets.rest.filter(g => g.launcher === id));
    if (list.length > 0) acc.set(id, list);
    return acc;
  }, new Map());

  const availablePlatforms = new Set(safeGames.map(g => g.launcher));

  // Videojuegos' own status sections mix in catalog-tracked 'game' entries
  // too — an entry the scanner never found installed anywhere (candidate
  // for "Pendientes") gets one more chance to resolve to a real Steam
  // listing by name before falling back to a plain catalog card: Steam's
  // owned-games API includes uninstalled purchases too (see
  // scanGamesWithSteam), but those never get their igdb_id cached until
  // metadata is actually fetched for them, so the identity-based match
  // above can still miss them.
  const pendingGameItems = useLocalMediaItemsByType('game', mediaRaw);
  const ownedExternalIds = React.useMemo(() => {
    const ids = new Set<string>();
    for (const g of games) {
      if (g.external_id) ids.add(g.external_id);
      const igdbId = g.app_id ? pathCache[g.app_id]?.igdb_id : undefined;
      if (igdbId != null) { ids.add(`vnovel:${igdbId}`); ids.add(`game:${igdbId}`); }
    }
    return ids;
  }, [games, pathCache]);
  const catalogMapById = React.useMemo(
    () => new Map((mediaRaw?.catalog ?? []).map(c => [c.external_id, c])),
    [mediaRaw],
  );
  // Shared with the Visual Novel tab's own library-only entries (see
  // catalogGameLinking.ts) so both get exactly the same "might already be a
  // scanned game under a different identity/edition" matching behavior
  // instead of two separately-maintained copies of it.
  const buildCatalogStatusEntries = React.useCallback((matchesStatus: (status: string) => boolean): StatusEntry[] => {
    const list = pendingGameItems.filter(i => {
      if (!matchesStatus(i.status)) return false;
      // A VN logged with type:'game' belongs exclusively in the Visual
      // Novel tab, not duplicated here.
      if (vnovelExternalIds.has(i.externalId)) return false;
      return !ownedExternalIds.has(i.externalId);
    });
    const q = filterName.trim().toLowerCase();
    const filtered = q ? list.filter(i => i.title.toLowerCase().includes(q)) : list;
    return buildLibraryStatusEntries(filtered, Array.isArray(games) ? games : [], catalogMapById);
  }, [pendingGameItems, ownedExternalIds, vnovelExternalIds, filterName, games, catalogMapById]);
  const currentlyEntries: StatusEntry[] = [
    ...filterGames(statusBuckets.currently).map((game): StatusEntry => ({ kind: 'game', game })),
    ...buildCatalogStatusEntries(isInProgressStatus),
  ];
  const planningEntries: StatusEntry[] = [
    ...filterGames(statusBuckets.planning).map((game): StatusEntry => ({ kind: 'game', game })),
    ...buildCatalogStatusEntries(s => s === 'planning'),
  ];

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
        {activeCategory === 'videojuegos' && (
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
            steamGames={activeCategory === 'visual-novel' ? vnSteamGames : undefined}
            coverCache={activeCategory === 'visual-novel' ? coverCache : undefined}
            pathCache={activeCategory === 'visual-novel' ? pathCache : undefined}
            onMetaRefresh={refreshMeta}
          />
        ) : (
        <div className={`local-games-container${(selectedGame || selectedPendingItem) ? ' with-detail' : ''}`}>
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

                {currentlyEntries.length > 0 && (
                  <div className="library-section" style={{ marginBottom: '1.5rem' }}>
                    <h3 className="library-section-title">{t.profile.section_in_progress}</h3>
                    <div className="local-games-grid">
                      {currentlyEntries.map((entry, i) => entry.kind === 'game' ? (
                        <GameCard key={entry.game.app_id ?? `g${i}`} game={entry.game} coverCache={coverCache} onClick={setSelectedGame} />
                      ) : (
                        <LocalMediaCard key={entry.item.externalId} item={entry.item} onClick={i => openPendingItem(i, entry.launchGame)} />
                      ))}
                    </div>
                  </div>
                )}

                {planningEntries.length > 0 && (
                  <div className="library-section" style={{ marginBottom: '1.5rem' }}>
                    <h3 className="library-section-title">{t.profile.section_planning}</h3>
                    <div className="local-games-grid">
                      {planningEntries.map((entry, i) => entry.kind === 'game' ? (
                        <GameCard key={entry.game.app_id ?? `g${i}`} game={entry.game} coverCache={coverCache} onClick={setSelectedGame} />
                      ) : (
                        <LocalMediaCard key={entry.item.externalId} item={entry.item} onClick={i => openPendingItem(i, entry.launchGame)} />
                      ))}
                    </div>
                  </div>
                )}

                {filterGames(statusBuckets.paused).length > 0 && (
                  <div className="library-section" style={{ marginBottom: '1.5rem' }}>
                    <h3 className="library-section-title">Pausado</h3>
                    <div className="local-games-grid">
                      {filterGames(statusBuckets.paused).map((g, i) => (
                        <GameCard key={g.app_id ?? i} game={g} coverCache={coverCache} onClick={setSelectedGame} />
                      ))}
                    </div>
                  </div>
                )}

                {filterGames(statusBuckets.dropped).length > 0 && (
                  <div className="library-section" style={{ marginBottom: '1.5rem' }}>
                    <h3 className="library-section-title">Abandonado</h3>
                    <div className="local-games-grid">
                      {filterGames(statusBuckets.dropped).map((g, i) => (
                        <GameCard key={g.app_id ?? i} game={g} coverCache={coverCache} onClick={setSelectedGame} />
                      ))}
                    </div>
                  </div>
                )}

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
              /* ── Folder view (categories without a library-backed grid) ── */
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

          {/* One single call site for both cases (an installed game vs a
              catalog-only "Pendiente") instead of two separate conditional
              blocks — with two blocks, switching from one kind of selection
              to the other unmounted one GameDetailPanel and mounted a
              different one (even with identical JSX, two separate `{cond &&
              ...}` blocks are two distinct elements as far as React's
              reconciler is concerned), replaying the panel's own slide-in
              entrance animation as if it had just been opened instead of
              just swapping its content. No `key` here either — that would
              force the exact same remount this is trying to avoid. */}
          {(selectedGame || selectedPendingItem) && (
            <GameDetailPanel
              game={selectedGame ?? { name: selectedPendingItem!.title, launcher: 'local' }}
              coverCache={coverCache}
              knownExternalId={selectedGame ? undefined : selectedPendingItem!.externalId}
              fallbackCover={selectedGame ? undefined : selectedPendingItem!.cover}
              launchOverride={selectedGame ? undefined : selectedPendingLaunchGame}
              onClose={() => { setSelectedGame(null); setSelectedPendingItem(null); setSelectedPendingLaunchGame(undefined); }}
              onMetaRefresh={refreshMeta}
            />
          )}
        </div>
        )}
      </div>
    </>
  );
}
