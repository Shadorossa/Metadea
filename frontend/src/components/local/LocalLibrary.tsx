import React, { useState, useEffect, useLayoutEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { igdbGetCoverBySteamId, steamAchievementsDownload, debugScanInfo } from '../../lib/tauri';
import { getT } from '../../i18n/client';

import { CATEGORIES, type CategoryId } from './utils/constants';
import { useLocalGames }        from './hooks/useLocalGames';
import { useMetadataCache }     from './hooks/useMetadataCache';
import { useCategoryRoutes }    from './hooks/useCategoryRoutes';
import { LOCAL_MEDIA_TYPE_BY_CATEGORY, useLocalMediaData } from './hooks/useLocalMediaEntries';

import { MetadataModal, type MetaProgress } from './modals/MetadataModal';
import { MetaTypeSelector, type MetaType }  from './modals/MetaTypeSelector';
import { LocalMediaSection } from './LocalMediaSection';

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

  const [metaProgress,   setMetaProgress]   = useState<MetaProgress | null>(null);
  const [metaSelector,   setMetaSelector]   = useState(false);
  const [filterName,     setFilterName]     = useState('');
  const cancelRef = useRef(false);

  const { games, gamesState, scanError, debugInfo, setDebugInfo, loadGames } = useLocalGames();
  const { pathCache, coverCache, refresh: refreshMeta }                       = useMetadataCache();
  const { routes, folderFiles, folderLoading, setRoute, clearRoute, refetchFolder } = useCategoryRoutes(activeCategory);
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
  // belongs in the Visual Novel tab's own library-backed grid, not
  // duplicated here under Videojuegos. Checks BOTH `type` ('vnovel', set
  // when added through the VN search tab) and `format` ('VISUAL_NOVEL',
  // set the same way — see igdb.ts's search) since an entry added through
  // the plain "game" search tab for the same IGDB id ends up with
  // type:'game' but still gets format:'VISUAL_NOVEL' tagged on it; relying
  // on `type` alone missed exactly that case (e.g. Higurashi logged as a
  // game).
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

  // Every Steam-scanned game that isn't a VN — passed to LocalMediaSection
  // as Videojuegos' own steamGames, where it gets matched to its real
  // library status (En progreso/Pendientes/...) the same way the Visual
  // Novel tab already matches its own Steam games.
  const safeGames = React.useMemo(() => {
    const list = (Array.isArray(games) ? games : [])
      .filter(g => !isSteamVN(g))
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name));
    const q = filterName.trim().toLowerCase();
    return q ? list.filter(g => g.name.toLowerCase().includes(q)) : list;
  }, [games, isSteamVN, filterName]);

  // The flip side of the exclusion above — every Steam-scanned VN, shown in
  // the Visual Novel tab instead with the exact same card/detail-panel
  // experience (achievements, launch via Steam) Videojuegos gives every
  // other game.
  const vnSteamGames = React.useMemo(() => {
    const list = (Array.isArray(games) ? games : [])
      .filter(isSteamVN)
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name));
    const q = filterName.trim().toLowerCase();
    return q ? list.filter(g => g.name.toLowerCase().includes(q)) : list;
  }, [games, isSteamVN, filterName]);

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

  const isVideojuegos = activeCategory === 'videojuegos';
  const isVisualNovel = activeCategory === 'visual-novel';

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
        {LOCAL_MEDIA_TYPE_BY_CATEGORY[activeCategory] && (
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
            steamGames={isVisualNovel ? vnSteamGames : isVideojuegos ? safeGames : undefined}
            coverCache={(isVisualNovel || isVideojuegos) ? coverCache : undefined}
            pathCache={(isVisualNovel || isVideojuegos) ? pathCache : undefined}
            onMetaRefresh={refreshMeta}
            scanState={isVideojuegos ? gamesState : undefined}
            onRescan={isVideojuegos ? loadGames : undefined}
            onFetchMetadataAll={isVideojuegos ? () => setMetaSelector(true) : undefined}
            scanError={isVideojuegos ? scanError : undefined}
            debugInfo={isVideojuegos ? debugInfo : undefined}
            onDebugScan={isVideojuegos ? () => debugScanInfo().then(setDebugInfo).catch(e => setDebugInfo(String(e))) : undefined}
          />
        )}
      </div>
    </>
  );
}
