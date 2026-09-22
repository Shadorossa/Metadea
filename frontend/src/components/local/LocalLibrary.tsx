import React, { useState, useEffect, useLayoutEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence } from 'motion/react';
import { igdbGetCoverBySteamId, steamAchievementsDownload, listenGameSessionEnded, addPlaytimeHours, deleteLibraryEntry, type LocalGame, type MediaCatalogEntry } from '../../lib/tauri';
import { getT } from '../../i18n/client';
import { IconGame, IconVNovel, IconAnime, IconManga, IconNovel, IconBook, IconComic, IconSeries, IconMovie } from '../local/ui/icons';

import { CATEGORIES, LAUNCHER_ORDER, type CategoryId, type PlatformId } from './utils/constants';
import { useLocalGames }        from './hooks/useLocalGames';
import { useMetadataCache }     from './hooks/useMetadataCache';
import { useCoverCacheBatch }   from './hooks/useCoverCacheBatch';
import { useCategoryRoutes }    from './hooks/useCategoryRoutes';
import { useActivePlatform }    from './hooks/useActivePlatform';
import { usePendingLaunchers }  from './hooks/usePendingLaunchers';
import { LOCAL_MEDIA_TYPE_BY_CATEGORY, useLocalMediaItems, useLocalMediaItemsByType, useLocalMediaData, type LocalMediaItem } from './hooks/useLocalMediaEntries';
import { isInProgressStatus } from '../../lib/constants/media';
import { buildLibraryStatusEntries, candidateExternalIdsForGame, computeBundleCompletionStatus, matchGameStatusByName, type StatusEntry } from './utils/catalogGameLinking';
import { normalizeForMatch } from './utils/folderMatch';
import { readLocalUrlState } from './utils/urlState';
import {
  useLocalPanelSelection, resolveCatalogSelection, resolveGameSelection,
  resolvePendingSelection, resolvePendingLaunchGame,
} from './hooks/useLocalPanelSelection';
import { useEvenPanelWidth } from './hooks/useEvenPanelWidth';
import { useNavSlot } from '../../lib/shared/useNavSlot';

import { PlatformSidebar }  from './PlatformSidebar';
import { GameDetailPanel }  from './details/GameDetailPanel';
import { LocalMediaDetailPanel } from './details/LocalMediaDetailPanel';
import { DetailPanelShell } from './details/DetailPanelShell';
import { MetadataModal, type MetaProgress } from './modals/MetadataModal';
import { MetaTypeSelector, type MetaType }  from './modals/MetaTypeSelector';
import { LocalMediaSection } from './LocalMediaSection';
import { GamesGrid } from './GamesGrid';

export default function LocalLibrary() {
  const t = getT();
  // Starts at the hardcoded default (matching what the server renders — see
  // the navSlot hydration-mismatch comment just below for why this can't
  // read the URL synchronously here either) and gets corrected from ?type=
  // in the restore-from-URL effect further down, right alongside the
  // selected item it was showing.
  // useLocalPanelSelection's own render-phase category-swap logic (below) is
  // what actually keeps the URL in sync on every tab switch now (?type= AND
  // ?sel=, together, always matching whatever that category's own
  // remembered selection resolves to), so this doesn't need to write
  // anything else itself.
  const [activeCategory, setActiveCategory] = useState<CategoryId>('videojuegos');
  const navSlot = useNavSlot();
  const [isMounted, setIsMounted] = useState(false);
  useEffect(() => { setIsMounted(true); }, []);

  // Same hydration-mismatch reasoning as navSlot above — corrects the tab
  // from ?type= right after hydration instead of in the initial useState,
  // which would've had the server and client disagree on the very first render.
  useLayoutEffect(() => {
    const { type } = readLocalUrlState();
    if (type && CATEGORIES.some(c => c.id === type)) setActiveCategory(type);
  }, []);

  // Single source of truth for "what's open" (see useLocalPanelSelection) —
  // this component now also owns resolving it into an actual item/game and
  // rendering the one shared DetailPanelShell for EVERY category
  // (Videojuegos included), not just handing selection/setters down to
  // LocalMediaSection to render its own. panelSelectedGame/
  // panelSelectedPendingItem/etc. are derived further down, once
  // games/pendingGameItems and friends are in scope.
  const { selection, setCatalogSelection, setGameSelection, openPendingSelection, clearSelection } = useLocalPanelSelection(activeCategory);
  const [resumeExternalId, setResumeExternalId] = useState<string | null>(null);
  const handledResumeRef = useRef<string | null>(null);
  const [metaProgress,   setMetaProgress]   = useState<MetaProgress | null>(null);
  const [metaSelector,   setMetaSelector]   = useState(false);
  const [filterName,     setFilterName]     = useState('');
  const cancelRef = useRef(false);

  const { games, gamesState, scanError, debugInfo, runDiagnostics, loadGames, removeGame, relinkGame } = useLocalGames();
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
      if (hours >= 15.0 / 3600.0) {
        addPlaytimeHours(external_id, hours).then(refetchMedia).catch(console.error);
      }
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

  // "Eliminar de la lista" for a catalog-tracked pendiente/en progreso entry
  // (GamesGrid/LocalMediaSection's own LocalMediaCard) — unlike
  // removeGame above (an optimistic, purely local removal from useLocalGames'
  // own state, since a scanned install has no "row" to refetch), there's no
  // cheap optimistic path here: mediaRaw is a plain snapshot, not something
  // these grids can locally patch, so this awaits the delete and refetches.
  const handleDeleteLibraryItem = useCallback((externalId: string) => {
    deleteLibraryEntry(externalId).then(refetchMedia).catch(console.error);
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

    // A small pool instead of one strictly-sequential worker — igdb_query's
    // own 429 backoff (igdb.rs) already tolerates bursts past IGDB's ~4
    // req/s comfortably (same reasoning igdb_upcoming_releases' 8-way
    // concurrency relies on), so the old single-worker design was just a
    // conservative leftover, not something correctness actually required.
    // Each game still makes 3-5 IGDB requests with backoff handled in Rust;
    // running a few games at once cuts real wall-clock time without
    // meaningfully raising 429 risk.
    const WORKER_COUNT = 3;
    async function worker() {
      while (queue.length > 0 && !cancelRef.current) {
        await processOne(queue.shift()!);
      }
    }

    await Promise.all(Array.from({ length: Math.min(WORKER_COUNT, pending.length) }, () => worker()));
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

  // Same titles, normalized for a name match — catches a Steam VN that's
  // neither identity-linked NOR had its IGDB metadata fetched yet (both of
  // which is_vn/vnovelExternalIds below require), which otherwise stayed
  // classified as a plain game until one of those happened to occur:
  // scanned straight into Videojuegos while its own library "Pendiente"
  // row (added via the VN search tab) sat orphaned in the Visual Novel tab
  // with no installed match at all — exactly the "Steam VN shows up in
  // Pendientes instead of Steam" report this closes.
  const vnovelTitles = React.useMemo(() => {
    if (!mediaRaw) return new Set<string>();
    return new Set(
      mediaRaw.catalog
        .filter(c => c.type === 'vnovel' || c.format === 'VISUAL_NOVEL')
        .flatMap(c => [c.title_main, c.title_romaji, c.title_native])
        .filter((t): t is string => !!t)
        .map(normalizeForMatch),
    );
  }, [mediaRaw]);

  // Catches VN games nobody's manually catalogued yet — is_vn comes from
  // the game's own cached IGDB metadata genre (see read_metadata_index),
  // so this works for any Steam game once its metadata has been fetched at
  // least once, without the user having to log it in their library first.
  const isSteamVN = React.useCallback(
    (g: (typeof games)[number]) =>
      g.rom_platform === 'vnovel' ||
      (!!g.external_id && vnovelExternalIds.has(g.external_id)) ||
      (!!g.app_id && !!pathCache[g.app_id]?.is_vn) ||
      vnovelTitles.has(normalizeForMatch(g.name)),
    [vnovelExternalIds, pathCache, vnovelTitles],
  );

  // Names picked via "editar metadatos" (IgdbPickerModal) before there's
  // ever a real media_catalog row for that external_id — saveGameLink only
  // persists the LINK, and a freshly-picked IGDB game's catalog row only
  // gets created by visiting its own /media page (persistToCatalog), so
  // without this a card's displayName lookup below would keep resolving to
  // nothing and fall back to the raw scanned name until that happens.
  const [pickedNames, setPickedNames] = React.useState<Map<string, string>>(new Map());
  const onGameRelinked = React.useCallback((game: LocalGame, externalId: string, name: string) => {
    const linkKey = game.app_id ?? game.install_path ?? game.name;
    relinkGame(game.launcher, linkKey, externalId);
    setPickedNames(prev => new Map(prev).set(externalId, name));
  }, [relinkGame]);

  const catalogMapById = React.useMemo(() => {
    const map = new Map((mediaRaw?.catalog ?? []).map(c => [c.external_id, c]));
    for (const [externalId, name] of pickedNames) {
      if (!map.has(externalId)) {
        map.set(externalId, { id: externalId, external_id: externalId, type: 'game', created_at: '', updated_at: '', title_main: name } as MediaCatalogEntry);
      }
    }
    return map;
  }, [mediaRaw, pickedNames]);

  // Matches every Steam-scanned game to its real library entry — by actual
  // identity (external_id from local_game_links, or the igdb_id
  // read_metadata_index caches per app_id), same "vnovel:<id>"/"game:<id>"
  // resolution "Ver en catálogo" and the Visual Novel tab's own matching
  // already use. Keyed by the game object itself so callers can look up a
  // status without re-deriving candidate ids each time.
  //
  // Games with NEITHER (a restored ghost — see game_links.rs — or one
  // that's simply never been auto-matched) fall back to the exact same
  // name-based matching buildLibraryStatusEntries uses for its own
  // catalog->game direction (matchGameStatusByName), so the two can't
  // independently reach different verdicts about the same game — which is
  // exactly what produced a GOG-scanned "Silent Hill 4: The Room" showing
  // once as an untracked GOG card (ID match found nothing) AND once as a
  // separate "Pendiente" card for the same title (name match found the
  // library row) instead of being recognized as the same game.
  const gameStatusMatch = React.useMemo(() => {
    const result = new Map<(typeof games)[number], string | undefined>();
    if (!mediaRaw) return result;
    const byExternalId = new Map(mediaRaw.entries.map(e => [e.external_id, e]));
    const gameLibraryEntries = mediaRaw.entries
      .filter(e => e.type === 'game' || e.type === 'vnovel')
      .map(e => {
        const meta = catalogMapById.get(e.external_id);
        const titles = [meta?.title_main, meta?.title_romaji, meta?.title_native].filter((s): s is string => !!s);
        return { titles, entry: e };
      })
      .filter(x => x.titles.length > 0);
    for (const g of Array.isArray(games) ? games : []) {
      const candidateIds = candidateExternalIdsForGame(g, pathCache);
      const completedBundleId = candidateIds.find(id => computeBundleCompletionStatus(id, mediaRaw.relations, byExternalId) === 'completed');
      if (completedBundleId) {
        result.set(g, 'completed');
        continue;
      }
      const matched = candidateIds.map(id => byExternalId.get(id)).find(Boolean);
      const bundleStatus = matched ? computeBundleCompletionStatus(matched.external_id, mediaRaw.relations, byExternalId) : undefined;
      const status = bundleStatus
        ?? matched?.status
        ?? matchGameStatusByName(g, gameLibraryEntries);
      result.set(g, status);
    }
    return result;
  }, [games, mediaRaw, pathCache, catalogMapById]);

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

  // Every installed game always has a determinable platform (its own
  // launcher) — same reasoning usePendingLaunchers already applies to a
  // launcher-matched catalog "Pendiente": once you know WHERE it lives
  // (Steam, GOG, Nintendo, ...), that's a more useful spot for it than a
  // generic status bucket. The one exception is "En progreso" — that status
  // only ever gets set by actually editing THIS entry in the media editor
  // (marking it as currently playing), a deliberate, meaningful signal
  // worth surfacing across every platform in one place — unlike "planning"/
  // "paused"/"dropped", which a game can pick up merely by incidentally
  // sharing its external_id with some unrelated catalog-only library row it
  // was never actually about (a GOG install matched to an old Pendiente
  // entry, say). Pausado/Abandonado's own top-of-page sections (below) stay
  // empty as a result — platform grouping is where those live now.
  const statusBuckets = React.useMemo(() => {
    const currently: typeof safeGames = [];
    const rest: typeof safeGames = [];
    for (const g of safeGames) {
      const status = gameStatusMatch.get(g);
      if (status && isInProgressStatus(status)) currently.push(g);
      else rest.push(g);
    }
    return { currently, rest };
  }, [safeGames, gameStatusMatch]);

  const groupedGames = LAUNCHER_ORDER.reduce<Map<PlatformId, typeof safeGames>>((acc, id) => {
    const list = filterGames(statusBuckets.rest.filter(g => g.launcher === id));
    if (list.length > 0) acc.set(id, list);
    return acc;
  }, new Map());
  const installedPlatforms = new Set(safeGames.map(g => g.launcher));

  // Videojuegos' own status sections mix in catalog-tracked 'game' entries
  // too — an entry the scanner never found installed anywhere (candidate
  // for "Pendientes") gets one more chance to resolve to a real Steam
  // listing by name before falling back to a plain catalog card: Steam's
  // owned-games API includes uninstalled purchases too (see
  // scanGamesWithSteam), but those never get their igdb_id cached until
  // metadata is actually fetched for them, so the identity-based match
  // above can still miss them.
  const pendingGameItems = useLocalMediaItemsByType('game', mediaRaw);

  // Resolved against whichever category is ACTUALLY active (not just
  // Videojuegos' own games/pendingGameItems) — this feeds the ONE shared
  // DetailPanelShell every category renders through now, so it needs the
  // right pool regardless of which one is on screen.
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
  // Widens the panel by whatever sliver of a column the games grid would
  // otherwise be left holding empty at the end of each row — see the
  // hook's own doc comment for why this couldn't just be a fixed panel
  // width. Applied to BOTH the panel's own width AND .local-main-content's
  // reserved margin below, synchronously on the same render panelOpen
  // flips — see .local-main-content's own comment for why that matters.
  const evenPanelWidth = useEvenPanelWidth(panelOpen);
  const ownedExternalIds = React.useMemo(() => {
    const ids = new Set<string>();
    for (const g of games) {
      for (const id of candidateExternalIdsForGame(g, pathCache)) ids.add(id);
    }
    return ids;
  }, [games, pathCache]);
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
    return buildLibraryStatusEntries(filtered, Array.isArray(games) ? games : [], catalogMapById, pathCache, mediaRaw?.relations ?? []);
  }, [pendingGameItems, ownedExternalIds, vnovelExternalIds, filterName, games, catalogMapById, pathCache, mediaRaw]);
  // Both halves can independently resolve to the SAME installed game — an
  // ID-matched one already sits in statusBuckets.currently, and a catalog
  // Pendiente row with no external_id of its own can separately NAME-match
  // to that exact game too (buildLibraryStatusEntries) — so this dedupes by
  // game reference (both come from the same underlying `games` array, so
  // it's the identical object either way) instead of showing it twice.
  const currentlyRaw: StatusEntry[] = [
    ...filterGames(statusBuckets.currently).map((game): StatusEntry => ({ kind: 'game', game })),
    ...buildCatalogStatusEntries(isInProgressStatus),
  ];
  const seenCurrentlyGames = new Set<(typeof games)[number]>();
  const currentlyEntries: StatusEntry[] = currentlyRaw.filter(e => {
    if (e.kind !== 'game') return true;
    if (seenCurrentlyGames.has(e.game)) return false;
    seenCurrentlyGames.add(e.game);
    return true;
  });
  // No installed-game half here (unlike currentlyEntries above) — an
  // installed game matched to "planning" now stays in its own platform
  // section instead (see statusBuckets). buildCatalogStatusEntries can still
  // NAME-match a catalog row to a real (e.g. ghost/unlinked) install — same
  // gameStatusMatch now already recognizes by name too — so any kind:'game'
  // result here is filtered out rather than shown a second time on top of
  // that install's own platform-section card.
  const planningEntries: StatusEntry[] = buildCatalogStatusEntries(s => s === 'planning').filter(e => e.kind === 'catalog');
  // mediaRaw (SQLite read) resolves well before games (a real Steam/GOG/etc.
  // disk-and-registry scan) does — without this gate, currentlyEntries/
  // planningEntries above would render their catalog-sourced ("pendiente")
  // half the instant mediaRaw lands, then have their Steam-scanned half pop
  // in seconds later once loadGames() finishes, reflowing the same grid
  // mid-view. Holding both halves back until BOTH sources are ready makes
  // every card in these mixed sections appear in one pass instead of two.
  const sectionsReady = gamesState !== 'idle' && gamesState !== 'loading' && !mediaLoading;

  // A profile-card quick action enters /local with ?resume=<external_id>.
  // Resolve it through the same game/catalog matching used by Local's own
  // grids, open the right panel, then let that panel start its native action.
  useEffect(() => {
    if (!mediaRaw) return;
    const url = new URL(window.location.href);
    const externalId = url.searchParams.get('resume');
    const requestedCategory = url.searchParams.get('type') as CategoryId | null;
    if (!externalId || !requestedCategory || activeCategory !== requestedCategory || handledResumeRef.current === externalId) return;
    const isGameCategory = requestedCategory === 'videojuegos' || requestedCategory === 'visual-novel';
    if (isGameCategory && (gamesState === 'idle' || gamesState === 'loading')) return;

    const candidates = requestedCategory === 'videojuegos' ? pendingGameItems : activeCategoryItems;
    const targetItem = candidates.find(candidate => candidate.externalId === externalId);
    if (!targetItem) return;

    url.searchParams.delete('resume');
    history.replaceState(history.state, '', url.toString());
    handledResumeRef.current = externalId;
    setResumeExternalId(externalId);

    window.setTimeout(() => {
      if (isGameCategory) {
        const gamePool = requestedCategory === 'videojuegos' ? games : vnSteamGames;
        const match = buildLibraryStatusEntries(
          [targetItem], gamePool, catalogMapById, pathCache, mediaRaw.relations,
        )[0];
        if (match?.kind === 'game') setGameSelection(match.game);
        else if (match?.kind === 'catalog') openPendingSelection(match.item, match.launchGame);
        else openPendingSelection(targetItem);
      } else {
        setCatalogSelection(externalId);
      }
    }, 0);
  }, [
    mediaRaw, activeCategory, activeCategoryItems, pendingGameItems, gamesState, games,
    vnSteamGames, catalogMapById, pathCache, setGameSelection, openPendingSelection, setCatalogSelection,
  ]);

  const clearResumeAction = useCallback(() => setResumeExternalId(null), []);
  // Which pending ("Pendiente") entries actually belong to a launcher
  // section (Steam/Nintendo/...) instead of just the general status
  // sections — shared with availablePlatforms below so a platform's sidebar
  // icon lights up even with zero scanned installs (e.g. Nintendo with only
  // a Bayonetta 3 pendiente).
  const { pendingByLauncher, pendingWithLauncherIds, pendingResolutionIds } = usePendingLaunchers(
    sectionsReady ? planningEntries : [],
  );
  const availablePlatforms = new Set([...installedPlatforms, ...pendingByLauncher.keys()]);
  // One bulk exists-check for every pending-item cover these two sections
  // are about to render, instead of each LocalMediaCard racing its own
  // get_cached_cover call at mount (see useCoverCacheBatch).
  const pendingCoverIds = React.useMemo(
    () => [...currentlyEntries, ...planningEntries].filter((e): e is Extract<StatusEntry, { kind: 'catalog' }> => e.kind === 'catalog').map(e => e.item.externalId),
    [currentlyEntries, planningEntries],
  );
  const coverCacheHits = useCoverCacheBatch(pendingCoverIds);

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

  const CATEGORY_ICONS: Record<CategoryId, React.ReactElement> = {
    'videojuegos': <IconGame />,
    'visual-novel': <IconVNovel />,
    'anime': <IconAnime />,
    'manga': <IconManga />,
    'light-novel': <IconNovel />,
    'books': <IconBook />,
    'comics': <IconComic />,
    'series': <IconSeries />,
    'movies': <IconMovie />,
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
            <span className="local-tab-icon">{CATEGORY_ICONS[cat.id]}</span>
            <span className="local-tab-label">{isMounted ? (t.search?.types?.[LOCAL_CATEGORY_TO_SEARCH_TYPE[cat.id]] || cat.label) : cat.label}</span>
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
        {(activeCategory === 'videojuegos' || activeCategory === 'visual-novel') && (
          <PlatformSidebar
            activePlatform={activePlatform}
            availablePlatforms={activeCategory === 'videojuegos' ? availablePlatforms : new Set(vnSteamGames.map(game => game.launcher))}
            onSelect={scrollTo}
            onFetchMetadata={activeCategory === 'videojuegos' ? () => setMetaSelector(true) : undefined}
          />
        )}

        <div className="local-games-container">
          {/* The panel itself is `position: fixed` now (see
              .local-game-detail-panel), not a flex sibling here, so it
              takes no layout space of its own — this reserves that space
              instead, via a plain margin driven straight off panelOpen on
              THIS render, in both directions. That's deliberate: the panel
              used to BE that flex sibling, so closing it only actually
              freed this space once its own 300ms exit slide finished and
              AnimatePresence removed it from the tree — which never
              triggered a re-render over here at all (a sibling's internal
              state settling doesn't retrigger this component), so the
              games grid's own reflow (see GamesGrid's launcher-title
              rule/controls) never got a chance to animate on close, only
              on open. Reserving the space here instead ties it directly to
              panelOpen, so both directions change on the exact same render
              — the panel's own slide is now a purely visual animation
              layered on top, decoupled from this. */}
          <div className="local-main-content" style={panelOpen ? { marginRight: evenPanelWidth } : undefined}>
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
                onSetCatalogSelection={setCatalogSelection}
                onSetGameSelection={setGameSelection}
                onOpenPendingSelection={openPendingSelection}
                catalogMapById={catalogMapById}
                onRemoveGame={removeGame}
                onDeleteLibraryItem={handleDeleteLibraryItem}
                onRefreshScan={activeCategory === 'visual-novel' ? loadGames : undefined}
                sectionRefs={activeCategory === 'visual-novel' ? sectionRefs : undefined}
              />
            ) : (
              /* ── Games view (Videojuegos only — LOCAL_MEDIA_TYPE_BY_CATEGORY
                  covers every other category) ──────────────────────────── */
              <GamesGrid
                gamesState={gamesState}
                gamesCount={games.length}
                rootFolder={routes['videojuegos']}
                onSetRoute={() => setRoute('videojuegos')}
                onClearRoute={() => clearRoute('videojuegos')}
                onRefreshScan={loadGames}
                isMounted={isMounted}
                currentlyEntries={sectionsReady ? currentlyEntries : []}
                planningEntries={sectionsReady ? planningEntries : []}
                coverCache={coverCache}
                coverCacheHits={coverCacheHits}
                onSelectGame={setGameSelection}
                onSelectPending={openPendingSelection}
                scanError={scanError}
                debugInfo={debugInfo}
                onRunDiagnostics={runDiagnostics}
                groupedGames={groupedGames}
                sectionRefs={sectionRefs}
                pendingByLauncher={pendingByLauncher}
                pendingWithLauncherIds={pendingWithLauncherIds}
                pendingResolutionIds={pendingResolutionIds}
                gameStatusMatch={gameStatusMatch}
                catalogMapById={catalogMapById}
                onRemoveGame={removeGame}
                onDeleteLibraryItem={handleDeleteLibraryItem}
              />
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
              a structurally different branch of this same ternary.
              AnimatePresence keeps the shell mounted for exactly as long as
              its own exit animation takes once panelOpen goes false, instead
              of DetailPanelShell managing that lifetime itself via a
              setTimeout — see that component's own doc comment. */}
          <AnimatePresence>
            {panelOpen && (
              <DetailPanelShell onClose={clearSelection} width={evenPanelWidth}>
                {handleClose => panelSelectedItem ? (
                  <LocalMediaDetailPanel
                    item={panelSelectedItem}
                    rootFolder={routes[activeCategory]}
                    rootEntries={folderFiles}
                    rootLoading={folderLoading}
                    onCloseClick={handleClose}
                    onProgressSaved={refetchMedia}
                    onRootRefresh={refetchFolder}
                    autoResume={resumeExternalId === panelSelectedItem.externalId}
                    onAutoResumeHandled={clearResumeAction}
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
                    onGameRelinked={onGameRelinked}
                    autoResume={!!resumeExternalId && (
                      panelSelectedPendingItem?.externalId === resumeExternalId ||
                      (!!panelSelectedGame && candidateExternalIdsForGame(panelSelectedGame, pathCache).includes(resumeExternalId))
                    )}
                    onAutoResumeHandled={clearResumeAction}
                  />
                )}
              </DetailPanelShell>
            )}
          </AnimatePresence>
        </div>
      </div>
    </>
  );
}
