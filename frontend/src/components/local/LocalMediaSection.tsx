import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useGridFlip } from './hooks/useGridFlip';
import { getT } from '../../i18n/client';
import type { LocalFolderEntry, LocalGame } from '../../lib/tauri';
import { useLocalMediaItems, type LocalMediaItem, type LocalMediaRaw } from './hooks/useLocalMediaEntries';
import { isInProgressStatus } from '../../lib/constants/media';
import { LocalMediaCard } from './cards/LocalMediaCard';
import { LocalMediaDetailPanel } from './details/LocalMediaDetailPanel';
import { GameCard } from './cards/GameCard';
import { GameDetailPanel, type CoverCache } from './details/GameDetailPanel';
import { buildLibraryStatusEntries, candidateExternalIdsForGame } from './utils/catalogGameLinking';
import type { MetaEntry } from '../../lib/tauri';
import { IconFolder, IconPlus, IconX } from './ui/icons';
import { LAUNCHER_ORDER, PLATFORM_LABEL, PLATFORM_LOGO, type CategoryId, type PlatformId } from './utils/constants';
import { catalogReleaseTimestampMs } from './utils/formatters';
import {
  type LocalPanelSelection, resolveCatalogSelection, resolveGameSelection,
  resolvePendingSelection, resolvePendingLaunchGame,
} from './hooks/useLocalPanelSelection';

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
  rootEntries:  LocalFolderEntry[];
  rootLoading:  boolean;
  onSetRoute:   () => void;
  onClearRoute: () => void;
  onRootRefresh: () => Promise<void>;
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
  onMetaRefresh?: () => void;
  // Single source of truth for "what's open" — owned by LocalLibrary (see
  // useLocalPanelSelection) so it survives switching away to Videojuegos,
  // which unmounts this whole component entirely. This component only ever
  // resolves `selection` against its own category's item lists and reports
  // clicks back up through the setters — it doesn't own any selection state
  // itself anymore.
  selection: LocalPanelSelection;
  onSetCatalogSelection: (id: string | null) => void;
  onSetGameSelection: (g: LocalGame | null) => void;
  onOpenPendingSelection: (item: LocalMediaItem, launchGame?: LocalGame) => void;
  onClearSelection: () => void;
}

// Shows the library entries (watching/reading/playing + planning) for a
// media category as a card grid, and — on click — opens a side panel that
// tries to match the work to a subfolder of the category's assigned local
// folder and to the file for the episode/chapter the user is currently on.
export function LocalMediaSection({ category, rootFolder, rootEntries, rootLoading, onSetRoute, onClearRoute, onRootRefresh, filterName, mediaRaw, mediaLoading, refetchMedia, steamGames, coverCache, pathCache, onMetaRefresh, selection, onSetCatalogSelection, onSetGameSelection, onOpenPendingSelection, onClearSelection }: LocalMediaSectionProps) {
  const [isMounted, setIsMounted] = useState(false);
  useEffect(() => { setIsMounted(true); }, []);

  const t = getT();
  const p = t.profile;
  const allItemsRaw = useLocalMediaItems(category, mediaRaw);
  const loading = mediaLoading;
  const refetch = refetchMedia;

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
  const steamGameMatch = useMemo(() => {
    const result = new Map<LocalGame, { externalId: string; status: string } | null>();
    if (!steamGames || steamGames.length === 0 || !mediaRaw) return result;
    const byExternalId = new Map(mediaRaw.entries.map(e => [e.external_id, e]));
    for (const g of steamGames) {
      const candidateIds = candidateExternalIdsForGame(g, pathCache ?? {});
      const matched = candidateIds.map(id => byExternalId.get(id)).find(Boolean) ?? null;
      result.set(g, matched ? { externalId: matched.external_id, status: matched.status ?? 'planning' } : null);
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
  // Mutually exclusive — selecting one always closes the others, so a
  // catalog item's LocalMediaDetailPanel, a Steam game's GameDetailPanel,
  // and a library-only pending item's synthetic GameDetailPanel never end
  // up open side by side at once. `selection` itself lives in LocalLibrary
  // (see useLocalPanelSelection) — resolved here against this category's
  // own item lists, purely derived so it updates in the same render as
  // `category`/`allItems` do, with no risk of a stale intermediate frame.
  const selected = resolveCatalogSelection(selection, allItems);
  // Visual Novel only (see isGameLike below): a library-only entry (no
  // scanned Steam install, no identity match either) still opens the same
  // GameDetailPanel every other game-like item gets — same "no que te
  // envíe a su media page" treatment Videojuegos' own Pendientes/En
  // progreso already have (see LocalLibrary's openPendingItem) — instead of
  // the folder/episode-matching LocalMediaDetailPanel other categories use.
  const selectedGame = resolveGameSelection(selection, steamGames ?? []);
  const selectedPendingItem = resolvePendingSelection(selection, allItems);
  const selectedPendingLaunchGame = resolvePendingLaunchGame(selection, steamGames ?? []);

  // Steam games split by their matched library status — unmatched (or
  // matched to a status this grid doesn't otherwise track, e.g. paused/
  // dropped) fall into "Backlog de Steam" instead. A completed match is
  // dropped entirely: same as every other completed work, it doesn't belong
  // in this "actively tracked" grid at all.
  const { steamInProgress, steamPlanning, steamBacklog } = useMemo(() => {
    const inProgress: LocalGame[] = [];
    const planning: LocalGame[] = [];
    const backlog: LocalGame[] = [];
    for (const [g, match] of steamGameMatch) {
      if (!match) backlog.push(g);
      else if (match.status === 'completed') continue;
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
  const catalogMapById = useMemo(
    () => new Map((mediaRaw?.catalog ?? []).map(c => [c.external_id, c])),
    [mediaRaw],
  );
  type SectionEntry = { kind: 'catalog'; item: LocalMediaItem; launchGame?: LocalGame } | { kind: 'steam'; game: LocalGame };
  // A library-only VN entry gets one more chance to resolve to a real (but
  // identity-unmatched) Steam listing by title — the exact same matching
  // Videojuegos' own Pendientes/En progreso sections use (see
  // catalogGameLinking.ts) — instead of unconditionally staying a passive
  // catalog card just because steamGameMatch (identity-only) missed it.
  const toEntries = (catalogItems: LocalMediaItem[], games: LocalGame[]): SectionEntry[] => {
    const linked = buildLibraryStatusEntries(catalogItems, steamGames ?? [], catalogMapById);
    return [
      ...linked.map((e): SectionEntry => e.kind === 'game' ? { kind: 'steam', game: e.game } : { kind: 'catalog', item: e.item, launchGame: e.launchGame }),
      ...games.map(game => ({ kind: 'steam' as const, game })),
    ];
  };
  // Same "agrupar por plataforma" treatment Videojuegos gives its own
  // no-status games (see LocalLibrary's groupedGames) — one section per
  // launcher instead of a single flat "Backlog de Steam" list, since
  // steamGames/steamBacklog already cover every detected launcher (GOG,
  // Epic, etc.), not just Steam despite the prop's name.
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
    const platformSections = LAUNCHER_ORDER
      .filter(id => backlogByPlatform.has(id))
      .map(id => ({ title: PLATFORM_LABEL[id], icon: PLATFORM_LOGO[id] || undefined, entries: toEntries([], backlogByPlatform.get(id)!) }));
    const inProgress = released.filter(i => isInProgressStatus(i.status))
      .sort((a, b) => completionFraction(b) - completionFraction(a));
    const planning = released.filter(i => i.status === 'planning')
      .sort((a, b) => episodeCount(a) - episodeCount(b));
    const unreleased = [...notReleased]
      .sort((a, b) => (releaseTimestamp(a) ?? Infinity) - (releaseTimestamp(b) ?? Infinity));
    return [
      { title: p.section_in_progress, icon: undefined, entries: toEntries(inProgress, steamInProgress) },
      { title: p.section_planning, icon: undefined, entries: toEntries(planning, steamPlanning) },
      { title: 'Sin estrenar', icon: undefined, entries: toEntries(unreleased, []) },
      ...platformSections,
    ].filter(s => s.entries.length > 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, p, steamInProgress, steamPlanning, backlogByPlatform, steamGames, catalogMapById]);

  const isEmpty = sections.length === 0;
  const gridContainerRef = useRef<HTMLDivElement>(null);
  useGridFlip(gridContainerRef, '.local-game-card');

  return (
    <div className={`local-games-container${(selected || selectedGame || selectedPendingItem) ? ' with-detail' : ''}`}>
      <div className="local-main-content">
        <div className="local-content" ref={gridContainerRef}>
          <div className="local-content-header">
            <span className="local-content-count">
              {!loading ? (items.length !== 1 ? (isMounted ? t.local.media_count_plural : '{count} obras en tu biblioteca').replace('{count}', String(items.length)) : (isMounted ? t.local.media_count_singular : '{count} obra en tu biblioteca').replace('{count}', String(items.length))) : ''}
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              {rootFolder && (
                <>
                  <span className="local-folder-path" style={{ fontSize: '0.7rem' }}>{rootFolder}</span>
                  <button type="button" className="local-refresh-btn" onClick={onClearRoute} title={isMounted ? t.local.remove_local_folder : 'Quitar carpeta local'} style={{ color: 'var(--color-error, #ff6b6b)' }}>
                    <IconX />
                  </button>
                </>
              )}
              <button type="button" className="local-refresh-btn" onClick={onSetRoute} title={isMounted ? (rootFolder ? t.local.change_folder : t.local.add_folder) : (rootFolder ? 'Cambiar carpeta' : 'Añadir carpeta')}>
                <IconFolder />
              </button>
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
                    {sec.icon && (
                      <span className="local-launcher-icon">
                        <img src={sec.icon} alt={sec.title} draggable={false} />
                      </span>
                    )}
                    {sec.title}
                  </h3>
                  <div className="local-games-grid">
                    {sec.entries.map(entry => entry.kind === 'catalog' ? (
                      <LocalMediaCard
                        key={entry.item.externalId}
                        item={entry.item}
                        onClick={i => isGameLike ? onOpenPendingSelection(i, entry.launchGame) : onSetCatalogSelection(i.externalId)}
                      />
                    ) : (
                      <GameCard key={entry.game.app_id ?? entry.game.name} game={entry.game} coverCache={coverCache ?? {}} onClick={onSetGameSelection} />
                    ))}
                  </div>
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
        </div>
      </div>

      {selected && (
        <LocalMediaDetailPanel
          item={selected}
          rootFolder={rootFolder}
          rootEntries={rootEntries}
          rootLoading={rootLoading}
          onClose={onClearSelection}
          onProgressSaved={refetch}
          onRootRefresh={onRootRefresh}
        />
      )}

      {/* One call site for both a real Steam game and a library-only
          pending item (no differing key) — same reasoning as LocalLibrary's
          own videojuegos panel: two separate {cond && <GameDetailPanel/>}
          blocks are distinct elements to React's reconciler, so switching
          which one is truthy would unmount/remount and replay the entrance
          transition instead of just updating in place. */}
      {(selectedGame || selectedPendingItem) && (
        <GameDetailPanel
          game={selectedGame ?? { name: selectedPendingItem!.title, launcher: 'local' }}
          coverCache={coverCache ?? {}}
          knownExternalId={selectedGame ? undefined : selectedPendingItem!.externalId}
          fallbackCover={selectedGame ? undefined : selectedPendingItem!.cover}
          launchOverride={selectedGame ? undefined : selectedPendingLaunchGame}
          onClose={onClearSelection}
          onMetaRefresh={onMetaRefresh}
        />
      )}
    </div>
  );
}
