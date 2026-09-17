import React, { useState, useEffect, useMemo } from 'react';
import { motion } from 'motion/react';
import { getT } from '../../i18n/client';
import { removeLocalGame, type LocalGame, type MediaCatalogEntry } from '../../lib/tauri';
import { useLocalMediaItems, type LocalMediaItem, type LocalMediaRaw } from './hooks/useLocalMediaEntries';
import { useCoverCacheBatch } from './hooks/useCoverCacheBatch';
import { isInProgressStatus } from '../../lib/constants/media';
import { LocalMediaCard } from './cards/LocalMediaCard';
import { FolderRouteControls } from './FolderRouteControls';
import { GameCard } from './cards/GameCard';
import { type CoverCache } from './details/GameDetailPanel';
import { buildLibraryStatusEntries, candidateExternalIdsForGame, computeBundleCompletionStatus, sortEntries, type SortMode, type StatusEntry } from './utils/catalogGameLinking';
import type { MetaEntry } from '../../lib/tauri';
import { IconFolder, IconPlus, IconRefresh } from './ui/icons';
import { DeleteContextMenu } from './ui/DeleteContextMenu';
import { VirtualCardGrid } from './ui/VirtualCardGrid';
import { LAUNCHER_ORDER, PLATFORM_LABEL, PLATFORM_LOGO, type CategoryId, type PlatformId } from './utils/constants';
import { catalogReleaseTimestampMs } from '../../lib/media/mapper-utils';
import { CONTAINS_RELATION_TYPES } from '../../lib/media/sagaTypes';

const LAUNCHER_LINE_TRANSITION = { duration: 0.3, ease: [0.25, 0, 0.15, 1] as const };

// null = no release date on file at all (never resolved a catalog entry, or
// the catalog entry itself has no release_year). Same "planning has nothing
// of its own to sort by" gap LibrarySection's own releaseTimestamp works
// around, reused here for the same reason.
function releaseTimestamp(item: LocalMediaItem): number | null {
  return catalogReleaseTimestampMs(item.catalogEntry);
}

// "Sin estrenar" — no release date on record at all, or one that hasn't
// happened yet — regardless of whether the library entry itself says
// watching or planning; either way there's nothing to actually watch/read
// yet, so it doesn't belong grouped in with things that ARE out already.
function isNotReleasedYet(item: LocalMediaItem): boolean {
  const ts = releaseTimestamp(item);
  return ts === null || ts > Date.now();
}

// Completion fraction for "En progreso" ordering — closest to finishing
// first. Unknown episode counts can't produce a real fraction, so they sink
// to the bottom instead of being mistaken for 0% or 100%.
function completionFraction(item: LocalMediaItem): number {
  const total = item.catalogEntry?.total_count;
  if (!total || total <= 0) return -1;
  return (item.progress ?? 0) / total;
}

// Episode count for "Pendientes" ordering — fewest episodes first (quick
// wins on top). Unknown counts sink to the bottom, same reasoning as above.
function episodeCount(item: LocalMediaItem): number {
  const total = item.catalogEntry?.total_count;
  return total && total > 0 ? total : Infinity;
}


interface LocalMediaSectionProps {
  category:     CategoryId;
  rootFolder:   string | undefined;
  onSetRoute:   () => void;
  onClearRoute: () => void;
  // The same tab-bar search box games already used, now shared by every
  // media category too instead of being videojuegos-only.
  filterName:   string;
  // Fetched once by LocalLibrary (which stays mounted across every category
  // switch, including trips out to "Videojuegos") instead of by this
  // component, so re-entering a media category never re-hits the DB or
  // flashes a loading state after the very first load.
  mediaRaw:     LocalMediaRaw | null;
  mediaLoading: boolean;
  refetchMedia: () => void;
  // Visual Novel only: Steam-scanned games detected/catalogued as a VN
  // (see LocalLibrary's isSteamVN) — shown as their own game-card grid with
  // the full Videojuegos experience (achievements, launch via Steam), mixed
  // in alongside the library-backed "pendiente"/"en progreso" sections
  // above for VNs not tied to a Steam install.
  steamGames?:  LocalGame[];
  coverCache?:  CoverCache;
  // app_id -> cached metadata, specifically each game's own igdb_id — used
  // to match a Steam game to its real catalog/library entry (the same
  // "vnovel:<id>"/"game:<id>" identity "Ver en catálogo" links to) instead
  // of guessing from the title.
  pathCache?:   Record<string, MetaEntry>;
  // The actual detail panel (DetailPanelShell) is owned and rendered by
  // LocalLibrary now, outside this component entirely, so it survives
  // switching away to Videojuegos instead of unmounting/remounting along
  // with this component's own grid — this only needs to report clicks
  // upward through the setters, it doesn't resolve a selection into an
  // actual item/game or render anything panel-shaped itself.
  onSetCatalogSelection: (id: string | null) => void;
  onSetGameSelection: (g: LocalGame | null) => void;
  onOpenPendingSelection: (item: LocalMediaItem, launchGame?: LocalGame) => void;
  // Same lookup GamesGrid uses for its own GameCards — once a Steam
  // VN has been linked to a catalog entry (a Steam-ID guess, or a manual
  // "editar metadatos" pick), its card shows that entry's own title_main
  // instead of the raw scanned Steam name.
  catalogMapById?: Map<string, MediaCatalogEntry>;
  // "Eliminar de la lista" — only ever passed (and only ever rendered, see
  // isGameLike below) for Visual Novel, the one non-Videojuegos category
  // with its own scanned-install ("steam" kind) and catalog-tracked
  // ("catalog" kind) entries alike, same as GamesGrid's own pair.
  // Every other category (anime/manga/...) never gets a delete option here.
  onRemoveGame?: (launcher: string, linkKey: string) => void;
  onDeleteLibraryItem?: (externalId: string) => void;
  onRefreshScan?: () => void;
}

export function LocalMediaSection({ category, rootFolder, onSetRoute, onClearRoute, filterName, mediaRaw, mediaLoading, refetchMedia, steamGames, coverCache, pathCache, onSetCatalogSelection, onSetGameSelection, onOpenPendingSelection, catalogMapById, onRemoveGame, onDeleteLibraryItem, onRefreshScan }: LocalMediaSectionProps) {
  const [isMounted, setIsMounted] = useState(false);
  useEffect(() => { setIsMounted(true); }, []);

  const displayNameFor = (g: LocalGame): string | undefined =>
    g.external_id ? catalogMapById?.get(g.external_id)?.title_main ?? undefined : undefined;

  const t = getT();
  const p = t.profile;
  const allItemsRaw = useLocalMediaItems(category, mediaRaw);
  const loading = mediaLoading;

  // playback-service.ts keeps polling and auto-marking episodes watched via
  // its own global singleton regardless of what's mounted — including with
  // no LocalMediaDetailPanel open at all, or one open on a different item.
  // LocalMediaDetailPanel's own listener for this event only refreshes
  // mediaRaw when it happens to be open on the exact item that just
  // finished, so an episode marked watched in the background (panel closed,
  // or watching continued after navigating elsewhere within Local) left
  // mediaRaw stale — "próximo episodio" kept showing the old progress until
  // something else happened to remount this component (e.g. an F5). This
  // listener has no such gate: any episode marked watched anywhere refreshes
  // the list this whole category's cards/panels read from.
  useEffect(() => {
    function onEpisodeMarked() { refetchMedia(); }
    window.addEventListener('metadea:episode-marked', onEpisodeMarked);
    return () => window.removeEventListener('metadea:episode-marked', onEpisodeMarked);
  }, [refetchMedia]);

  // Matches each Steam-scanned game to its real catalog/library entry — by
  // actual identity, the same "vnovel:<igdb_id>"/"game:<igdb_id>" external_id
  // "Ver en catálogo" links to (via g.external_id when local_game_links has
  // it, or the igdb_id read_metadata_index already caches per app_id
  // otherwise) — not a fuzzy title guess, which broke on any title spelled
  // even slightly differently between Steam and the catalog. Checked
  // against the FULL library (any status, not just allItemsRaw's in-
  // progress/planning-only set) so a VN already logged as completed doesn't
  // get mislabeled into "Backlog de Steam".
  // Falls back to a plain derivation from mediaRaw when the caller doesn't
  // pass one (kept optional above so this stays a non-breaking addition) —
  // LocalLibrary's own copy additionally overlays pickedNames (a game just
  // re-linked via "editar metadatos", before its real media_catalog row —
  // see IgdbPickerModal — has actually round-tripped back through here).
  const resolvedCatalogMapById = useMemo(
    () => catalogMapById ?? new Map((mediaRaw?.catalog ?? []).map(c => [c.external_id, c])),
    [catalogMapById, mediaRaw],
  );

  const steamGameMatch = useMemo(() => {
    const result = new Map<LocalGame, { externalId: string; status: string } | null>();
    if (!steamGames || steamGames.length === 0 || !mediaRaw) return result;
    const byExternalId = new Map(mediaRaw.entries.map(e => [e.external_id, e]));
    for (const g of steamGames) {
      const candidateIds = candidateExternalIdsForGame(g, pathCache ?? {});
      const completedBundleId = candidateIds.find(id => computeBundleCompletionStatus(id, mediaRaw.relations, byExternalId) === 'completed');
      if (completedBundleId) {
        result.set(g, { externalId: completedBundleId, status: 'completed' });
        continue;
      }
      const matchedEntry = candidateIds.map(id => byExternalId.get(id)).find(Boolean);
      if (matchedEntry) {
        const bundleStatus = computeBundleCompletionStatus(matchedEntry.external_id, mediaRaw.relations, byExternalId);
        result.set(g, { externalId: matchedEntry.external_id, status: bundleStatus ?? matchedEntry.status ?? 'planning' });
        continue;
      }
      result.set(g, null);
    }
    return result;
  }, [steamGames, mediaRaw, pathCache]);

  // A VN matched to a Steam game shouldn't also show up as a second,
  // separately-tracked "invented" card for the same work below — it's
  // rendered as its own Steam game card instead (see steamInProgress/
  // steamPlanning below), grouped into the very same status section.
  const matchedExternalIds = useMemo(
    () => new Set([...steamGameMatch.values()].filter((m): m is NonNullable<typeof m> => !!m).map(m => m.externalId)),
    [steamGameMatch],
  );
  const allItems = useMemo(
    () => matchedExternalIds.size === 0 ? allItemsRaw : allItemsRaw.filter(i => !matchedExternalIds.has(i.externalId)),
    [allItemsRaw, matchedExternalIds],
  );
  const items = useMemo(() => {
    const q = filterName.trim().toLowerCase();
    return q ? allItems.filter(i => i.title.toLowerCase().includes(q)) : allItems;
  }, [allItems, filterName]);
  // Steam games split by their matched library status — unmatched, paused/
  // dropped, AND completed all fall into "Backlog de Steam" instead of
  // their own bucket — same as Videojuegos' own launcher sections (see
  // GamesGrid/LocalLibrary's groupedGames), which never drop a completed
  // install off the grid either, just badge it Completado in place. A
  // completed BUNDLE (see steamGameMatch's own bundleCompletionStatus) is
  // exactly the case this matters for — Umineko still needs to show up
  // somewhere once every part's done, not vanish entirely.
  const { steamInProgress, steamPlanning, steamBacklog } = useMemo(() => {
    const inProgress: LocalGame[] = [];
    const planning: LocalGame[] = [];
    const backlog: LocalGame[] = [];
    for (const [g, match] of steamGameMatch) {
      if (!match || match.status === 'completed') backlog.push(g);
      else if (isInProgressStatus(match.status)) inProgress.push(g);
      else if (match.status === 'planning') planning.push(g);
      else backlog.push(g);
    }
    return { steamInProgress: inProgress, steamPlanning: planning, steamBacklog: backlog };
  }, [steamGameMatch]);

  // Same three-way split the profile's own library sections use (see
  // LibrarySection.tsx's sectionsData) — grouped and labeled the same way,
  // for visual consistency between "your library" and "your local files".
  // "Sin estrenar" is checked first and takes priority over watching/
  // planning: nothing without a release date, or a future one, actually has
  // anything to watch/read yet regardless of which status it's tracked
  // under. Steam games mix directly into the matching status section
  // instead of their own separate grid, per the user's own framing: "si
  // coincide, pues ponerme el status... dividido en las secciones que hay
  // según mi biblioteca."
  // Visual Novel only — anime/manga/etc. have no "Steam" pool a library
  // entry could actually turn out to already be, so this is a no-op there
  // (steamGames is undefined, buildLibraryStatusEntries never matches).
  const isGameLike = !!steamGames;

  // "Eliminar de la lista" — same shared game/library-entry menu
  // GamesGrid uses, only ever wired below when isGameLike (see
  // onRemoveGame/onDeleteLibraryItem's own doc comments above): anime/manga/
  // etc. never render a "steam" kind entry at all, and their "catalog" kind
  // LocalMediaCards never get onRequestDelete passed in the first place.
  type DeleteMenu = { x: number; y: number } & ({ kind: 'game'; game: LocalGame } | { kind: 'library'; item: LocalMediaItem });
  const [deleteMenu, setDeleteMenu] = useState<DeleteMenu | null>(null);
  const handleDeleteGame = (game: LocalGame) => {
    const linkKey = game.app_id ?? game.install_path ?? game.name;
    onRemoveGame?.(game.launcher, linkKey);
    removeLocalGame(game.launcher, linkKey).catch(console.error);
    setDeleteMenu(null);
  };
  const handleDeleteLibraryItem = (item: LocalMediaItem) => {
    onDeleteLibraryItem?.(item.externalId);
    setDeleteMenu(null);
  };

  type SectionEntry = { kind: 'catalog'; item: LocalMediaItem; launchGame?: LocalGame } | { kind: 'steam'; game: LocalGame; libraryStatus?: string };
  // A library-only VN entry gets one more chance to resolve to a real (but
  // identity-unmatched) Steam listing by title — the exact same matching
  // Videojuegos' own Pendientes/En progreso sections use (see
  // catalogGameLinking.ts) — instead of unconditionally staying a passive
  // catalog card just because steamGameMatch (identity-only) missed it.
  const toEntries = (catalogItems: LocalMediaItem[], games: LocalGame[]): SectionEntry[] => {
    const linked = buildLibraryStatusEntries(catalogItems, steamGames ?? [], resolvedCatalogMapById, pathCache ?? {}, mediaRaw?.relations ?? []);
    return [
      ...linked.map((e): SectionEntry => e.kind === 'game' ? { kind: 'steam', game: e.game, libraryStatus: e.libraryStatus } : { kind: 'catalog', item: e.item, launchGame: e.launchGame }),
      ...games.map(game => ({ kind: 'steam' as const, game })),
    ];
  };
  // Same "agrupar por plataforma" treatment Videojuegos gives its own
  // no-status games (see LocalLibrary's groupedGames) — one section per
  // launcher instead of a single flat "Backlog de Steam" list, since
  // steamGames/steamBacklog already cover every detected launcher (GOG,
  // Epic, etc.), not just Steam despite the prop's name.
  // Same sort control Videojuegos gives its own launcher sections (see
  // GamesGrid) — one shared preference across every platform here too.
  const [sortMode, setSortMode] = useState<SortMode>('alpha');
  const backlogByPlatform = useMemo(() => {
    const map = new Map<PlatformId, LocalGame[]>();
    for (const g of steamBacklog) {
      const id = g.launcher as PlatformId;
      const list = map.get(id) ?? [];
      list.push(g);
      map.set(id, list);
    }
    return map;
  }, [steamBacklog]);
  const sections = useMemo(() => {
    const notReleased = items.filter(isNotReleasedYet);
    const released = items.filter(i => !isNotReleasedYet(i));
    // Platform/backlog sections are always kind:'steam'-only (built from
    // toEntries([], ...) — no catalog items ever go into this branch), so
    // they can be sorted directly as StatusEntry's 'game' variant and mapped
    // straight back — same sortEntries/SortMode Videojuegos' own launcher
    // sections use (see GamesGrid).
    const inProgress = released.filter(i => isInProgressStatus(i.status))
      .sort((a, b) => completionFraction(b) - completionFraction(a));
    const planning = released.filter(i => i.status === 'planning')
      .sort((a, b) => episodeCount(a) - episodeCount(b));
    const planningEntries: StatusEntry[] = isGameLike
      ? buildLibraryStatusEntries(planning, steamGames ?? [], resolvedCatalogMapById, pathCache ?? {}, mediaRaw?.relations ?? [])
      : [];
    const unreleased = [...notReleased]
      .sort((a, b) => (releaseTimestamp(a) ?? Infinity) - (releaseTimestamp(b) ?? Infinity));

    const platformSections = isGameLike ? LAUNCHER_ORDER
      .filter(id => backlogByPlatform.has(id) || (id === 'steam' && (planningEntries.length > 0 || steamPlanning.length > 0)))
      .map(id => {
        const platformBacklogGames: StatusEntry[] = (backlogByPlatform.get(id) ?? []).map(game => ({ kind: 'game', game }));
        const additionalPlatformEntries: StatusEntry[] = id === 'steam'
          ? [
              ...steamPlanning.map((game): StatusEntry => ({ kind: 'game', game })),
              ...planningEntries,
            ]
          : [];
        const merged = [...platformBacklogGames, ...additionalPlatformEntries];
        const sorted = sortEntries(merged, sortMode, displayNameFor);
        const entries: SectionEntry[] = sorted.map(e => e.kind === 'game'
          ? { kind: 'steam' as const, game: e.game, libraryStatus: e.libraryStatus }
          : { kind: 'catalog' as const, item: e.item, launchGame: e.launchGame }
        );
        return { title: PLATFORM_LABEL[id], icon: PLATFORM_LOGO[id] || undefined, entries };
      }) : LAUNCHER_ORDER
      .filter(id => backlogByPlatform.has(id))
      .map(id => {
        const asStatusEntries: StatusEntry[] = backlogByPlatform.get(id)!.map(game => ({ kind: 'game', game }));
        const sorted = sortEntries(asStatusEntries, sortMode, displayNameFor);
        const entries: SectionEntry[] = sorted.map(e => ({ kind: 'steam' as const, game: (e as { kind: 'game'; game: LocalGame }).game }));
        return { title: PLATFORM_LABEL[id], icon: PLATFORM_LOGO[id] || undefined, entries };
      });
    const rawSections = [
      { title: p.section_in_progress, icon: undefined, entries: toEntries(inProgress, steamInProgress) },
      ...(isGameLike ? [] : [{ title: p.section_planning, icon: undefined, entries: toEntries(planning, steamPlanning) }]),
      { title: 'Sin estrenar', icon: undefined, entries: toEntries(unreleased, []) },
      ...platformSections,
    ];
    // toEntries' own name-matching (see buildLibraryStatusEntries' chapter-
    // suffix fallback) can resolve a Steam game from INSIDE a status
    // section — the same game object independently sits in steamBacklog/
    // platformSections too whenever it wasn't identity-matched. Sections
    // are built in priority order (a real tracked status first, the raw
    // platform backlog last), so keeping only each game's FIRST appearance
    // here is what makes the tracked-status card win over its own
    // unmatched backlog duplicate instead of showing both.
    const gameIdentity = (g: LocalGame) => g.app_id ?? g.install_path ?? g.name;
    const seenGameIds = new Set<string>();
    return rawSections
      .map(sec => ({
        ...sec,
        entries: sec.entries.filter(e => {
          if (e.kind !== 'steam') return true;
          const id = gameIdentity(e.game);
          if (seenGameIds.has(id)) return false;
          seenGameIds.add(id);
          return true;
        }),
      }))
      .filter(s => s.entries.length > 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, p, steamInProgress, steamPlanning, backlogByPlatform, steamGames, resolvedCatalogMapById, sortMode]);

  // One bulk exists-check for every catalog card this grid is about to
  // render, instead of each LocalMediaCard racing its own get_cached_cover
  // call at mount (see useCoverCacheBatch).
  const coverCacheHits = useCoverCacheBatch(useMemo(() => items.map(i => i.externalId), [items]));

  const isEmpty = sections.length === 0;

  // Just the grid itself now — LocalLibrary owns the surrounding
  // .local-games-container/.local-main-content layout and the single
  // shared DetailPanelShell (see useLocalPanelSelection), so switching to
  // Videojuegos (which renders a structurally separate grid, not this
  // component) doesn't unmount/remount the panel along with this grid.
  return (
        <div className="local-content">
          <div className="local-content-header">
            <span className="local-content-count">
              {!loading ? (items.length !== 1 ? (isMounted ? t.local.media_count_plural : '{count} obras en tu biblioteca').replace('{count}', String(items.length)) : (isMounted ? t.local.media_count_singular : '{count} obra en tu biblioteca').replace('{count}', String(items.length))) : ''}
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <FolderRouteControls rootFolder={rootFolder} onSetRoute={onSetRoute} onClearRoute={onClearRoute} />
              {onRefreshScan && (
                <button
                  type="button"
                  className="local-refresh-btn"
                  onClick={onRefreshScan}
                  title={isMounted ? t.local.scan_again : 'Escanear de nuevo'}
                >
                  <IconRefresh />
                </button>
              )}
            </div>
          </div>

          {loading && items.length === 0 && sections.length === 0 ? (
            <div className="local-state-placeholder"><div className="spinner" /></div>
          ) : isEmpty ? (
            <div className="local-state-placeholder">
              <IconFolder />
              <p>{isMounted ? t.local.empty_category_media : 'No tienes obras de este tipo en biblioteca (viendo/leyendo/jugando o pendientes)'}</p>
            </div>
          ) : (
            <div className="library-sections-list">
              {sections.map(sec => (
                <div className="library-section" key={sec.title}>
                  <h3 className="library-section-title">
                    <div className="local-launcher-title-label">
                      {sec.icon && (
                        <span className="local-launcher-icon">
                          <img src={sec.icon} alt={sec.title} draggable={false} />
                        </span>
                      )}
                      <span>{sec.title}</span>
                    </div>
                    {sec.icon ? (
                      <>
                        <motion.div className="local-launcher-title-rule" layout="size" transition={LAUNCHER_LINE_TRANSITION} />
                        <div className="local-launcher-title-controls">
                          <select
                            className="local-sort-select"
                            value={sortMode}
                            onChange={e => setSortMode(e.target.value as SortMode)}
                            title={t.local.sort_title}
                          >
                            <option value="alpha">{t.local.sort_alpha}</option>
                            <option value="lastPlayed">{t.local.sort_last_played}</option>
                            <option value="playtime">{t.local.sort_playtime}</option>
                          </select>
                        </div>
                      </>
                    ) : null}
                  </h3>
                  <VirtualCardGrid
                    entries={sec.entries}
                    getKey={entry => entry.kind === 'catalog' ? entry.item.externalId : `${entry.game.app_id ?? entry.game.name}`}
                    renderItem={entry => entry.kind === 'catalog' ? (
                      <LocalMediaCard
                        item={entry.item}
                        cachedPath={coverCacheHits[entry.item.externalId]}
                        onClick={i => isGameLike ? onOpenPendingSelection(i, entry.launchGame) : onSetCatalogSelection(i.externalId)}
                        onRequestDelete={isGameLike ? (item, x, y) => setDeleteMenu({ kind: 'library', item, x, y }) : undefined}
                        launchGame={entry.launchGame}
                      />
                    ) : (
                      <GameCard
                        game={entry.game}
                        coverCache={coverCache ?? {}}
                        onClick={onSetGameSelection}
                        displayName={displayNameFor(entry.game)}
                        status={steamGameMatch.get(entry.game)?.status ?? entry.libraryStatus}
                        onRequestDelete={(g, x, y) => setDeleteMenu({ kind: 'game', game: g, x, y })}
                      />
                    )}
                  />
                </div>
              ))}
            </div>
          )}

          {/* "elige una carpeta para detectar episodios/capítulos" doesn't
              apply to Videojuegos — games launch via Steam/install paths,
              not matched to local episode files. */}
          {!rootFolder && (
            <div className="local-state-placeholder" style={{ marginTop: '1rem' }}>
              <IconFolder />
              <p>{isMounted ? t.local.no_folder_assigned : 'Sin carpeta asignada'}</p>
              <span>{isMounted ? t.local.choose_folder_episodes_hint : 'Elige una carpeta para poder detectar tus episodios/capítulos locales'}</span>
              <button type="button" className="local-add-route-btn" onClick={onSetRoute}>
                <IconPlus /> {isMounted ? t.local.add_route : 'Añadir ruta'}
              </button>
            </div>
          )}

          {deleteMenu && (
            <DeleteContextMenu
              x={deleteMenu.x}
              y={deleteMenu.y}
              label="Eliminar de la lista"
              onDelete={() => deleteMenu.kind === 'game' ? handleDeleteGame(deleteMenu.game) : handleDeleteLibraryItem(deleteMenu.item)}
              onClose={() => setDeleteMenu(null)}
            />
          )}
        </div>
  );
}
