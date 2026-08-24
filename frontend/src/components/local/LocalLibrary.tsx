import React, { useState, useEffect, useLayoutEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { igdbGetCoverBySteamId, steamAchievementsDownload, listenGameSessionEnded, addPlaytimeHours, type LocalGame } from '../../lib/tauri';
import { getT } from '../../i18n/client';

import { CATEGORIES, LAUNCHER_ORDER, PLATFORM_LABEL, PLATFORM_LOGO, type CategoryId, type PlatformId } from './utils/constants';
import { useLocalGames }        from './hooks/useLocalGames';
import { useMetadataCache }     from './hooks/useMetadataCache';
import { useCategoryRoutes }    from './hooks/useCategoryRoutes';
import { useActivePlatform }    from './hooks/useActivePlatform';
import { LOCAL_MEDIA_TYPE_BY_CATEGORY, useLocalMediaItems, useLocalMediaItemsByType, useLocalMediaData, type LocalMediaItem } from './hooks/useLocalMediaEntries';
import { isInProgressStatus } from '../../lib/constants/media';
import { buildLibraryStatusEntries, candidateExternalIdsForGame, type StatusEntry } from './utils/catalogGameLinking';
import { readLocalUrlState, writeLocalUrlState } from './utils/urlState';
import {
  useLocalPanelSelection, resolveCatalogSelection, resolveGameSelection,
  resolvePendingSelection, resolvePendingLaunchGame,
} from './hooks/useLocalPanelSelection';

import { PlatformSidebar }  from './PlatformSidebar';
import { FolderRouteControls } from './FolderRouteControls';
import { GameCard }         from './cards/GameCard';
import { LocalMediaCard }   from './cards/LocalMediaCard';
import { GameDetailPanel }  from './details/GameDetailPanel';
import { LocalMediaDetailPanel } from './details/LocalMediaDetailPanel';
import { DetailPanelShell } from './details/DetailPanelShell';
import { MetadataModal, type MetaProgress } from './modals/MetadataModal';
import { MetaTypeSelector, type MetaType }  from './modals/MetaTypeSelector';
import { LocalMediaSection } from './LocalMediaSection';
import { useGridFlip } from './hooks/useGridFlip';
import { IconMonitor, IconFolder, IconRefresh } from './ui/icons';

export default function LocalLibrary() {
  const t = getT();
  // Starts at the hardcoded default (matching what the server renders — see
  // the navSlot hydration-mismatch comment just below for why this can't
  // read the URL synchronously here either) and gets corrected from ?type=
  // in the restore-from-URL effect further down, right alongside the
  // selected item it was showing.
  const [activeCategory, setActiveCategoryRaw] = useState<CategoryId>('videojuegos');
  // Just a plain rename at this point — useLocalPanelSelection's own render-
  // phase category-swap logic (below) is what actually keeps the URL in
  // sync on every tab switch now (?type= AND ?sel=, together, always
  // matching whatever that category's own remembered selection resolves
  // to), so this doesn't need to write anything itself.
  const setActiveCategory = setActiveCategoryRaw;
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

  // Same hydration-mismatch reasoning as navSlot above — corrects the tab
  // from ?type= right after hydration instead of in the initial useState,
  // which would've had the server and client disagree on the very first render.
  useLayoutEffect(() => {
    const { type } = readLocalUrlState();
    if (type && CATEGORIES.some(c => c.id === type)) setActiveCategoryRaw(type);
  }, []);

  // Single source of truth for "what's open" (see useLocalPanelSelection) —
  // this component now also owns resolving it into an actual item/game and
  // rendering the one shared DetailPanelShell for EVERY category
  // (Videojuegos included), not just handing selection/setters down to
  // LocalMediaSection to render its own. panelSelectedGame/
  // panelSelectedPendingItem/etc. are derived further down, once
  // games/pendingGameItems and friends are in scope.
  const { selection, setCatalogSelection, setGameSelection, openPendingSelection, clearSelection } = useLocalPanelSelection(activeCategory);
  const [metaProgress,   setMetaProgress]   = useState<MetaProgress | null>(null);
  const [metaSelector,   setMetaSelector]   = useState(false);
  const [filterName,     setFilterName]     = useState('');
  const cancelRef = useRef(false);
  // Smooths the Videojuegos grid's own card repositioning when the detail
  // panel resizes it — same fix as LocalMediaSection's own grid (see
  // useGridFlip's own comment for why CSS Grid needs this at all). The
  // actual useGridFlip call is further down, once selectedGame/
  // selectedPendingItem (needed for its disabled flag) are resolved.
  const videojuegosGridRef = useRef<HTMLDivElement>(null);

  const { games, gamesState, scanError, debugInfo, runDiagnostics, loadGames } = useLocalGames();
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

  // saveLibraryEntry (lib/tauri/library.ts) fires this exact event after
  // EVERY library write, from wherever it happens — the collaborative
  // catalog editor's status dropdown included. Local never listened for it
  // at all before (only Profile did), so editing a work's status from here
  // (e.g. Pendiente -> En progreso) saved correctly but this page's own
  // mediaRaw stayed stale until something else remounted it (an F5) — the
  // edited item kept showing under its old status section regardless of
  // what was actually saved. refetchMedia here covers every category, not
  // just whichever one was active when the edit happened: mediaRaw is
  // owned by this component and passed down as a prop, so refetching it
  // here re-renders LocalMediaSection too.
  useEffect(() => {
    window.addEventListener('refresh-profile-library', refetchMedia);
    return () => window.removeEventListener('refresh-profile-library', refetchMedia);
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
      const candidateIds = candidateExternalIdsForGame(g, pathCache);
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
  // Resolved fresh every render from `selection` — see useLocalPanelSelection.
  const selectedGame = resolveGameSelection(selection, games);
  const selectedPendingItem = resolvePendingSelection(selection, pendingGameItems);
  const selectedPendingLaunchGame = resolvePendingLaunchGame(selection, games);
  const openPendingItem = (item: LocalMediaItem, launchGame?: LocalGame) => openPendingSelection(item, launchGame);
  const setSelectedGame = (g: LocalGame | null) => setGameSelection(g);
  useGridFlip(videojuegosGridRef, '.local-game-card', !!(selectedGame || selectedPendingItem));

  // Resolved against whichever category is ACTUALLY active — unlike
  // selectedGame/selectedPendingItem above (always resolved against
  // Videojuegos' own games/pendingGameItems, correct only because that
  // JSX below only ever renders while Videojuegos is active), this feeds
  // the ONE shared DetailPanelShell every category renders through now, so
  // it needs the right pool regardless of which one is on screen.
  // activeCategoryItems mirrors what LocalMediaSection computes internally
  // for its own grid (useLocalMediaItems(category, mediaRaw)) — safe to
  // recompute here too since a 'pending'-kind selection was, by definition,
  // never one of the items LocalMediaSection's own Steam-match filter would
  // have removed.
  const activeCategoryItems = useLocalMediaItems(activeCategory, mediaRaw);
  const activeSteamGamesPool = activeCategory === 'videojuegos' ? games : activeCategory === 'visual-novel' ? vnSteamGames : [];
  const activePendingPool = activeCategory === 'videojuegos' ? pendingGameItems : activeCategoryItems;
  const panelSelectedItem = resolveCatalogSelection(selection, activeCategoryItems);
  const panelSelectedGame = resolveGameSelection(selection, activeSteamGamesPool);
  const panelSelectedPendingItem = resolvePendingSelection(selection, activePendingPool);
  const panelSelectedPendingLaunchGame = resolvePendingLaunchGame(selection, activeSteamGamesPool);
  const panelOpen = !!(panelSelectedItem || panelSelectedGame || panelSelectedPendingItem);
  const ownedExternalIds = React.useMemo(() => {
    const ids = new Set<string>();
    for (const g of games) {
      for (const id of candidateExternalIdsForGame(g, pathCache)) ids.add(id);
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
  'comics':       'comic',
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

        <div className={`local-games-container${panelOpen ? ' with-detail' : ''}`}>
          <div className="local-main-content">
            {LOCAL_MEDIA_TYPE_BY_CATEGORY[activeCategory] ? (
              <LocalMediaSection
                category={activeCategory}
                rootFolder={routes[activeCategory]}
                onSetRoute={() => setRoute(activeCategory)}
                onClearRoute={() => clearRoute(activeCategory)}
                filterName={filterName}
                mediaRaw={mediaRaw}
                mediaLoading={mediaLoading}
                refetchMedia={refetchMedia}
                steamGames={activeCategory === 'visual-novel' ? vnSteamGames : undefined}
                coverCache={activeCategory === 'visual-novel' ? coverCache : undefined}
                pathCache={activeCategory === 'visual-novel' ? pathCache : undefined}
                selection={selection}
                onSetCatalogSelection={setCatalogSelection}
                onSetGameSelection={setGameSelection}
                onOpenPendingSelection={openPendingSelection}
              />
            ) : (
              /* ── Games view (Videojuegos only — LOCAL_MEDIA_TYPE_BY_CATEGORY
                  covers every other category) ──────────────────────────── */
              <div className="local-content" ref={videojuegosGridRef}>
                <div className="local-content-header">
                  <span className="local-content-count">
                    {gamesState === 'done' ? (games.length !== 1 ? t.local.games_count.replace('{count}', String(games.length)) : t.local.game_count.replace('{count}', String(games.length))) : ''}
                  </span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <FolderRouteControls rootFolder={routes['videojuegos']} onSetRoute={() => setRoute('videojuegos')} onClearRoute={() => clearRoute('videojuegos')} />
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
                      onClick={runDiagnostics}
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
                          <button type="button" className="local-refresh-btn local-launcher-refresh-btn" onClick={loadGames} disabled={gamesState === 'loading'}>
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
            )}
          </div>

          {/* One shared DetailPanelShell for every category — a catalog
              item's LocalMediaDetailPanel, or a Steam game/library-only
              pending item's GameDetailPanel (Visual Novel and Videojuegos
              can both open the latter). The shell itself (position/size/
              slide animation) doesn't remount just because which category
              or content kind is inside it changed, only the content does —
              this is what actually lets switching to/from Videojuegos stop
              replaying the entrance animation, since previously Videojuegos
              rendered its own entirely separate GameDetailPanel+shell from
              a structurally different branch of this same ternary. */}
          {panelOpen && (
            <DetailPanelShell onClose={clearSelection}>
              {handleClose => panelSelectedItem ? (
                <LocalMediaDetailPanel
                  item={panelSelectedItem}
                  rootFolder={routes[activeCategory]}
                  rootEntries={folderFiles}
                  rootLoading={folderLoading}
                  onCloseClick={handleClose}
                  onProgressSaved={refetchMedia}
                  onRootRefresh={refetchFolder}
                />
              ) : (
                <GameDetailPanel
                  game={panelSelectedGame ?? { name: panelSelectedPendingItem!.title, launcher: 'local' }}
                  coverCache={coverCache}
                  knownExternalId={panelSelectedGame ? undefined : panelSelectedPendingItem!.externalId}
                  fallbackCover={panelSelectedGame ? undefined : panelSelectedPendingItem!.cover}
                  launchOverride={panelSelectedGame ? undefined : panelSelectedPendingLaunchGame}
                  onCloseClick={handleClose}
                  onMetaRefresh={refreshMeta}
                />
              )}
            </DetailPanelShell>
          )}
        </div>
      </div>
    </>
  );
}
