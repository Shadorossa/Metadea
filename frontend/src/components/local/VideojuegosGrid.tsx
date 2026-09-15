import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'motion/react';
import type { LocalGame, MediaCatalogEntry } from '../../lib/tauri';
import { removeLocalGame } from '../../lib/tauri';
import { getT } from '../../i18n/client';
import type { LocalMediaItem } from './hooks/useLocalMediaEntries';
import type { GamesState } from './hooks/useLocalGames';
import type { CoverCache } from './details/GameDetailPanel';
import { type StatusEntry } from './utils/catalogGameLinking';
import { PLATFORM_LABEL, PLATFORM_LOGO, LAUNCHER_ORDER, type PlatformId } from './utils/constants';
import { GameCard } from './cards/GameCard';
import { LocalMediaCard } from './cards/LocalMediaCard';
import { FolderRouteControls } from './FolderRouteControls';
import { IconMonitor, IconFolder, IconRefresh } from './ui/icons';

// sectionStatus is the badge shown on any kind:'game' entry in this section
// (kind:'catalog' entries carry their own item.status instead) — safe to
// hardcode per section since each one is built from an already-homogeneous
// status bucket (see LocalLibrary's statusBuckets/buildCatalogStatusEntries).
interface StatusSection { key: string; title: string; entries: StatusEntry[]; sectionStatus: string }

// Same duration/easing as the detail panel's own slide — each launcher
// title row's rule/controls (see the "Label left, rule fills the rest"
// comment below) reflow along with .local-main-content narrowing/widening
// on every open/close, so animating them at the SAME pace as the panel
// itself is what actually reads as one coherent motion instead of two
// unrelated things happening on screen at once. Unlike the games grid
// (deliberately un-animated — see MediaCardShell.tsx), there's only ever a
// handful of these rows on screen (one per launcher section), so there's no
// large-list perf/viewport-culling concern to worry about here.
const LAUNCHER_LINE_TRANSITION = { duration: 0.3, ease: [0.25, 0, 0.15, 1] as const };

// How a launcher section's mixed installed+pendiente entries are ordered —
// "biblioteca de Steam" (kind:'game', installed) and "perfil de usuario"
// (kind:'catalog', a library-tracked pendiente) are just two different
// SOURCES of the same kind of thing, so they're always merged into one list
// and sorted together instead of installed games trailing every pendiente
// (or vice versa) regardless of what the user actually asked to sort by.
type SortMode = 'alpha' | 'lastPlayed' | 'playtime';

function entryDisplayName(entry: StatusEntry, displayNameFor: (g: LocalGame) => string | undefined): string {
  return entry.kind === 'game' ? (displayNameFor(entry.game) ?? entry.game.name) : entry.item.title;
}

// last_played (installed) is a unix-seconds timestamp; a catalog-only
// pendiente has no such field (it's never actually been launched through
// here), so its library entry's own updated_at — bumped whenever its
// progress/status changes — is the closest available proxy.
function entryLastPlayedMs(entry: StatusEntry): number {
  if (entry.kind === 'game') return (entry.game.last_played ?? 0) * 1000;
  return Date.parse(entry.item.libraryEntry.updated_at ?? '') || 0;
}

// playtime_minutes (installed) and the library entry's minutes_spent
// (pendiente) are already the same unit, so these compare directly.
function entryPlaytimeMinutes(entry: StatusEntry): number {
  if (entry.kind === 'game') return entry.game.playtime_minutes ?? 0;
  return entry.item.libraryEntry.minutes_spent ?? 0;
}

function sortEntries(entries: StatusEntry[], mode: SortMode, displayNameFor: (g: LocalGame) => string | undefined): StatusEntry[] {
  const sorted = [...entries];
  if (mode === 'alpha') {
    sorted.sort((a, b) => entryDisplayName(a, displayNameFor).localeCompare(entryDisplayName(b, displayNameFor)));
  } else if (mode === 'lastPlayed') {
    sorted.sort((a, b) => entryLastPlayedMs(b) - entryLastPlayedMs(a));
  } else {
    sorted.sort((a, b) => entryPlaytimeMinutes(b) - entryPlaytimeMinutes(a));
  }
  return sorted;
}

// No index baked into either branch — sortEntries below reorders this same
// list every time the sort mode/search filter changes, and a key that
// shifts when an item's INDEX does (instead of staying tied to the item
// itself) makes React tear down and remount it as a brand new element
// rather than recognizing it as the same one that just moved, losing
// Motion's own layout-animation tracking for it (a hard, un-animated pop to
// its new spot instead of easing there).
function entryKey(entry: StatusEntry): string {
  return entry.kind === 'game' ? `g-${entry.game.app_id ?? entry.game.install_path ?? entry.game.name}` : `c-${entry.item.externalId}`;
}

interface VideojuegosGridProps {
  gamesState:    GamesState;
  gamesCount:    number;
  rootFolder:    string | undefined;
  onSetRoute:    () => void;
  onClearRoute:  () => void;
  onRefreshScan: () => void;
  isMounted:     boolean;
  // currentlyEntries/planningEntries mix in catalog-tracked "pendiente"
  // entries too (see LocalLibrary's buildCatalogStatusEntries) — there's no
  // Pausado/Abandonado equivalent: an installed game with that status stays
  // in its own platform section instead (see statusBuckets), badge and all.
  currentlyEntries: StatusEntry[];
  planningEntries:  StatusEntry[];
  coverCache:      CoverCache;
  coverCacheHits:  Record<string, string>;
  onSelectGame:    (g: LocalGame | null) => void;
  onSelectPending: (item: LocalMediaItem, launchGame?: LocalGame) => void;
  scanError:       string | null;
  debugInfo:       string | null;
  onRunDiagnostics: () => void;
  groupedGames: Map<PlatformId, LocalGame[]>;
  sectionRefs:  React.MutableRefObject<Map<string, HTMLElement>>;
  // Computed by LocalLibrary via usePendingLaunchers, shared with
  // PlatformSidebar's availablePlatforms so a platform with only pending
  // games (no scanned install at all) still lights up in both places.
  pendingByLauncher:      Map<string, StatusEntry[]>;
  pendingWithLauncherIds: Set<string>;
  // Entries whose launcher can't be determined locally and whose live IGDB
  // check hasn't resolved yet — held out of the status sections too (not
  // just launcher ones), so a Nintendo/Steam-bound pendiente never flashes
  // in "Pendientes" for a frame before jumping to its real section once the
  // check finishes.
  pendingResolutionIds: Set<string>;
  // Real library status (if any) for each installed game — groupedGames
  // itself only ever holds untracked-or-completed installs, but the badge
  // needs to tell those two apart (see getStatusBadge/GameCard).
  gameStatusMatch: Map<LocalGame, string | undefined>;
  // Keyed by external_id — once a game has been linked to a catalog entry
  // (a Steam-ID guess, or a manual "editar metadatos" pick via
  // IgdbPickerModal), its card should show that entry's own title_main
  // instead of the raw scanned name, which for a ROM is often a messy dump
  // filename (region tags, language codes, ...) rather than the real title.
  catalogMapById: Map<string, MediaCatalogEntry>;
  // Drops a game from useLocalGames' own state immediately (see its own
  // doc comment) — used instead of onRefreshScan for "Eliminar de la
  // lista" so removing one card doesn't re-run the whole scan and flash
  // the scanning placeholder over the entire grid.
  onRemoveGame: (launcher: string, linkKey: string) => void;
  // Same "Eliminar de la lista" for a catalog-tracked ("pendiente"/"en
  // progreso") entry — these aren't scanned installs at all, so there's no
  // local_hidden_games row to hide; deleting means dropping the underlying
  // library entry itself (see deleteLibraryEntry).
  onDeleteLibraryItem: (externalId: string) => void;
}

// The Videojuegos-only grid — status-grouped sections (En progreso/
// Planeando/Pausado/Abandonado) on top, followed by whatever's left grouped
// by launcher. Pulled out of LocalLibrary.tsx, which owned this ~120-line
// block directly alongside every other category's selection/metadata-fetch
// state; this only needs the already-resolved data and a handful of
// callbacks.
export function VideojuegosGrid({
  gamesState, gamesCount, rootFolder, onSetRoute, onClearRoute, onRefreshScan, isMounted,
  currentlyEntries, planningEntries, coverCache, coverCacheHits,
  onSelectGame, onSelectPending, scanError, debugInfo, onRunDiagnostics, groupedGames, sectionRefs,
  pendingByLauncher, pendingWithLauncherIds, pendingResolutionIds, gameStatusMatch, catalogMapById, onRemoveGame,
  onDeleteLibraryItem,
}: VideojuegosGridProps) {
  const t = getT();
  const displayNameFor = (g: LocalGame): string | undefined =>
    g.external_id ? catalogMapById.get(g.external_id)?.title_main ?? undefined : undefined;

  // One shared sort preference across every launcher section (Steam,
  // Nintendo, ...) rather than a separate one per platform — simpler to
  // reason about, and there's no real case for browsing one platform
  // alphabetically while another stays sorted by playtime.
  const [sortMode, setSortMode] = useState<SortMode>('alpha');

  // Right-click "Eliminar de la lista" on any card, game or catalog-tracked
  // pendiente alike (see GameCard/LocalMediaCard's own onRequestDelete) —
  // one shared menu, branching on which kind was right-clicked since each
  // deletes through a completely different path (hide a scanned install vs.
  // drop a library entry).
  type DeleteMenu = { x: number; y: number } & ({ kind: 'game'; game: LocalGame } | { kind: 'library'; item: LocalMediaItem });
  const [deleteMenu, setDeleteMenu] = useState<DeleteMenu | null>(null);
  useEffect(() => {
    if (!deleteMenu) return;
    const close = () => setDeleteMenu(null);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [deleteMenu]);
  const handleDeleteGame = (game: LocalGame) => {
    const linkKey = game.app_id ?? game.install_path ?? game.name;
    onRemoveGame(game.launcher, linkKey);
    removeLocalGame(game.launcher, linkKey).catch(console.error);
    setDeleteMenu(null);
  };
  const handleDeleteLibraryItem = (item: LocalMediaItem) => {
    onDeleteLibraryItem(item.externalId);
    setDeleteMenu(null);
  };

  // "En progreso" always stays one general list (see usePendingLaunchers'
  // own comment) — only Planeando entries get filtered out here, for the
  // ones that have a launcher (they go ONLY to their launcher section) or
  // are still being checked for one, so a game that WILL end up in
  // Nintendo/Steam never renders here first and jumps later.
  const statusEntriesCurrently = currentlyEntries;
  const statusEntriesPlanning = planningEntries.filter(e =>
    !(e.kind === 'catalog' && (pendingWithLauncherIds.has(e.item.externalId) || pendingResolutionIds.has(e.item.externalId))));

  // The four status buckets share one section shell (title + grid, mixing
  // GameCard/LocalMediaCard by entry.kind) — same {title,entries}[] + one
  // .map() pattern LocalMediaSection already uses for its own sections,
  // instead of four hand-rolled, near-identical JSX blocks.
  const statusSections: StatusSection[] = [
    ...(statusEntriesCurrently.length > 0 ? [{ key: 'currently', title: t.profile.section_in_progress, entries: statusEntriesCurrently, sectionStatus: 'playing' }] : []),
    ...(statusEntriesPlanning.length > 0 ? [{ key: 'planning', title: t.profile.section_planning, entries: statusEntriesPlanning, sectionStatus: 'planning' }] : []),
  ];

  return (
    <div className="local-content">
      <div className="local-content-header">
        <span className="local-content-count">
          {gamesState === 'done' ? (gamesCount !== 1 ? t.local.games_count.replace('{count}', String(gamesCount)) : t.local.game_count.replace('{count}', String(gamesCount))) : ''}
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <FolderRouteControls rootFolder={rootFolder} onSetRoute={onSetRoute} onClearRoute={onClearRoute} />
          <button type="button" className="local-refresh-btn" onClick={onRefreshScan} disabled={gamesState === 'loading'} title={isMounted ? (gamesState === 'loading' ? t.local.scanning : t.local.scan_again) : (gamesState === 'loading' ? 'Escaneando…' : 'Escanear de nuevo')}>
            <IconRefresh />
          </button>
        </div>
      </div>

      {statusSections.map(sec => (
        <div key={sec.key} className="library-section" style={{ marginBottom: '1.5rem' }}>
          <h3 className="library-section-title">{sec.title}</h3>
          <div className="local-games-grid">
            {sec.entries.map((entry, i) => entry.kind === 'game' ? (
              <GameCard
                key={entry.game.app_id ?? `g${i}`}
                game={entry.game}
                coverCache={coverCache}
                onClick={onSelectGame}
                status={sec.sectionStatus}
                onRequestDelete={(g, x, y) => setDeleteMenu({ kind: 'game', game: g, x, y })}
                displayName={displayNameFor(entry.game)}
              />
            ) : (
              <LocalMediaCard
                key={entry.item.externalId}
                item={entry.item}
                cachedPath={coverCacheHits[entry.item.externalId]}
                onClick={pendingItem => onSelectPending(pendingItem, entry.launchGame)}
                onRequestDelete={(item, x, y) => setDeleteMenu({ kind: 'library', item, x, y })}
              />
            ))}
          </div>
        </div>
      ))}

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
            onClick={onRunDiagnostics}
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
        // Union of platforms with installed games AND platforms with only
        // pending games (e.g. Nintendo with zero scanned installs but a
        // Bayonetta 3 pendiente) — iterating groupedGames alone would skip
        // any launcher section that has no installed games at all.
        LAUNCHER_ORDER.filter(launcher => (groupedGames.get(launcher)?.length ?? 0) > 0 || (pendingByLauncher.get(launcher)?.length ?? 0) > 0)
          .map((launcher, idx) => {
          const list = groupedGames.get(launcher) || [];
          const pendingForLauncher = pendingByLauncher.get(launcher) || [];
          // Installed ("biblioteca de Steam") and pendiente ("perfil de
          // usuario") entries are just two sources of the same thing — merged
          // into one list and sorted together instead of one group always
          // trailing the other regardless of the chosen sort.
          const merged: StatusEntry[] = [
            ...list.map((g): StatusEntry => ({ kind: 'game', game: g })),
            ...pendingForLauncher,
          ];
          const sortedEntries = sortEntries(merged, sortMode, displayNameFor);
          const totalCount = merged.length;
          return (
            <section
              key={launcher}
              id={`launcher-${launcher}`}
              ref={el => { if (el) sectionRefs.current.set(launcher, el); }}
              className="local-launcher-section"
            >
              <h2 className="local-launcher-title">
                <div className="local-launcher-title-label">
                  <span className="local-launcher-icon">
                    {PLATFORM_LOGO[launcher]
                      ? <img src={PLATFORM_LOGO[launcher]} alt={PLATFORM_LABEL[launcher]} draggable={false} />
                      : <IconFolder />}
                  </span>
                  <span className="local-launcher-name">{PLATFORM_LABEL[launcher]}</span>
                  <span className="local-launcher-count">{totalCount} juego{totalCount !== 1 ? 's' : ''}</span>
                </div>
                {/* "Label left, rule fills the rest" — same trick
                    .library-section-title uses in the newspaper-dark theme,
                    generalized here to every theme so the sort/refresh
                    controls always land at the right end of one continuous
                    line instead of risking a second row. Only the rule gets
                    `layout="size"` (see LAUNCHER_LINE_TRANSITION above) —
                    ONLY its width, never its position, since "size" mode
                    ignores position entirely. The controls block stays a
                    plain div deliberately: an earlier version gave it
                    `layout="position"` too (so it'd slide left in step with
                    the rule shrinking), but that tracks BOTH axes — when an
                    earlier section on the page gains/loses rows (a plain
                    document-flow consequence of the panel narrowing the
                    grid, nothing to do with this row itself) and pushes
                    this whole row up or down, Motion animated THAT
                    incidental vertical drift too, which read as every
                    section's controls doing an unrelated little bob. Left
                    unanimated, they just snap straight to wherever the row
                    actually ends up — the rule's own width still eases
                    smoothly either way. */}
                <motion.div className="local-launcher-title-rule" layout="size" transition={LAUNCHER_LINE_TRANSITION} />
                <div className="local-launcher-title-controls">
                  <select
                    className="local-sort-select"
                    value={sortMode}
                    onChange={e => setSortMode(e.target.value as SortMode)}
                    title="Ordenar"
                  >
                    <option value="alpha">Alfabético</option>
                    <option value="lastPlayed">Última vez jugado</option>
                    <option value="playtime">Tiempo jugado</option>
                  </select>
                  {idx === 0 && (
                    <button type="button" className="local-refresh-btn local-launcher-refresh-btn" onClick={onRefreshScan} disabled={gamesState === 'loading'}>
                      <IconRefresh />
                    </button>
                  )}
                </div>
              </h2>
              <div className="local-games-grid">
                {sortedEntries.map(entry => entry.kind === 'game' ? (
                  <GameCard
                    key={entryKey(entry)}
                    game={entry.game}
                    coverCache={coverCache}
                    onClick={onSelectGame}
                    status={gameStatusMatch.get(entry.game)}
                    onRequestDelete={(g, x, y) => setDeleteMenu({ kind: 'game', game: g, x, y })}
                    displayName={displayNameFor(entry.game)}
                  />
                ) : (
                  <LocalMediaCard
                    key={entryKey(entry)}
                    item={entry.item}
                    cachedPath={coverCacheHits[entry.item.externalId]}
                    onClick={pendingItem => onSelectPending(pendingItem, entry.launchGame)}
                    onRequestDelete={(item, x, y) => setDeleteMenu({ kind: 'library', item, x, y })}
                  />
                ))}
              </div>
            </section>
          );
        })
      )}

      {deleteMenu && createPortal(
        <div className="local-context-menu" style={{ top: deleteMenu.y, left: deleteMenu.x }} onClick={e => e.stopPropagation()}>
          <button
            type="button"
            className="local-context-menu-item delete"
            onClick={() => deleteMenu.kind === 'game' ? handleDeleteGame(deleteMenu.game) : handleDeleteLibraryItem(deleteMenu.item)}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 6 }}>
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            </svg>
            Eliminar de la lista
          </button>
        </div>,
        document.body,
      )}
    </div>
  );
}
