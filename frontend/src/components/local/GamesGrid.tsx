import React, { useState } from 'react';
import type { Translations } from '../../i18n/index';
import { motion } from 'motion/react';
import type { LocalGame, MediaCatalogEntry } from '../../lib/tauri';
import { getT } from '../../i18n/runtime';
import type { LocalMediaItem } from './hooks/useLocalMediaEntries';
import type { GamesState } from './hooks/useLocalGames';
import type { CoverCache } from './details/GameDetailPanel';
import { displayNameFor, type StatusEntry, type SortMode, sortEntries, entryKey } from '../../lib/local/catalog-game-linking';
import { PLATFORM_LABEL, PLATFORM_LOGO, LAUNCHER_ORDER, LAUNCHER_LINE_TRANSITION, type PlatformId } from '../../lib/local/platforms';
import { GameCard } from './cards/GameCard';
import { LocalMediaCard } from './cards/LocalMediaCard';
import { FolderRouteControls } from './FolderRouteControls';
import { IconMonitor, IconFolder, IconRefresh } from './ui/icons';
import { DeleteContextMenu } from './ui/DeleteContextMenu';
import { VirtualCardGrid } from './ui/VirtualCardGrid';
import { SortModeSelect } from './ui/SortModeSelect';
import { useLocalDeleteMenu } from './hooks/useLocalDeleteMenu';

// sectionStatus is the badge shown on any kind:'game' entry in this section
// (kind:'catalog' entries carry their own item.status instead) — safe to
// hardcode per section since each one is built from an already-homogeneous
// status bucket (see LocalLibrary's statusBuckets/buildCatalogStatusEntries).
interface StatusSection { key: string; title: string; entries: StatusEntry[]; sectionStatus: string }

// sortEntries/entryKey/SortMode now live in catalogGameLinking.ts, shared
// with LocalMediaSection's own Steam-backed platform sections.

interface GamesGridProps {
  gamesState:    GamesState;
  gamesCount:    number;
  rootFolder:    string | undefined;
  onSetRoute:    () => void;
  onClearRoute:  () => void;
  onRefreshScan: () => void;
  isMounted:     boolean;
  // Server-rendered `t.local` from local.astro — see LocalLibrary.
  ssrLocal?:     Translations['local'];
  // currentlyEntries mixes in catalog-tracked "pendiente" entries too (see
  // LocalLibrary's buildCatalogStatusEntries) — there's no Pausado/
  // Abandonado equivalent: an installed game with that status stays in its
  // own platform section instead (see statusBuckets), badge and all.
  currentlyEntries: StatusEntry[];
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
export function GamesGrid({
  gamesState, gamesCount, rootFolder, onSetRoute, onClearRoute, onRefreshScan, isMounted, ssrLocal,
  currentlyEntries, coverCache, coverCacheHits,
  onSelectGame, onSelectPending, scanError, debugInfo, onRunDiagnostics, groupedGames, sectionRefs,
  pendingByLauncher, gameStatusMatch, catalogMapById, onRemoveGame,
  onDeleteLibraryItem,
}: GamesGridProps) {
  const t = getT();
  const local = isMounted ? t.local : (ssrLocal ?? t.local);
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
  const {
    deleteMenu,
    requestDeleteGame,
    requestDeleteLibraryItem,
    handleDeleteGame,
    handleDeleteLibraryItem,
    closeDeleteMenu,
  } = useLocalDeleteMenu({ onRemoveGame, onDeleteLibraryItem });

  const renderEntry = (entry: StatusEntry, status: string | undefined) => entry.kind === 'game' ? (
    <GameCard
      game={entry.game}
      coverCache={coverCache}
      onClick={onSelectGame}
      status={status}
      onRequestDelete={requestDeleteGame}
      displayName={displayNameFor(entry.game, catalogMapById)}
    />
  ) : (
    <LocalMediaCard
      item={entry.item}
      cachedPath={coverCacheHits[entry.item.externalId]}
      onClick={pendingItem => onSelectPending(pendingItem, entry.launchGame)}
      onRequestDelete={requestDeleteLibraryItem}
      launchGame={entry.launchGame}
    />
  );

  const statusSections: StatusSection[] = [
    ...(currentlyEntries.length > 0 ? [{ key: 'currently', title: t.profile.section_in_progress, entries: currentlyEntries, sectionStatus: 'playing' }] : []),
  ];

  return (
    <div className="local-content">
      <div className="local-content-header">
        <span className="local-content-count">
          {gamesState === 'done' ? (gamesCount !== 1 ? t.local.games_count.replace('{count}', String(gamesCount)) : t.local.game_count.replace('{count}', String(gamesCount))) : ''}
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <FolderRouteControls rootFolder={rootFolder} onSetRoute={onSetRoute} onClearRoute={onClearRoute} />
          <button type="button" className="local-refresh-btn" onClick={onRefreshScan} disabled={gamesState === 'loading'} title={gamesState === 'loading' ? local.scanning : local.scan_again}>
            <IconRefresh />
          </button>
        </div>
      </div>

      {statusSections.map(sec => (
        <div key={sec.key} className="library-section" style={{ marginBottom: '1.5rem' }}>
          <h3 className="library-section-title">{sec.title}</h3>
          <VirtualCardGrid
            entries={sec.entries}
            getKey={entryKey}
            renderItem={entry => renderEntry(entry, sec.sectionStatus)}
          />
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
          const sortedEntries = sortEntries(merged, sortMode, g => displayNameFor(g, catalogMapById));
          const totalCount = merged.length;
          return (
            <section
              key={launcher}
              id={`launcher-${launcher}`}
              ref={el => {
                if (el) sectionRefs.current.set(launcher, el);
                else sectionRefs.current.delete(launcher);
              }}
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
                  <SortModeSelect value={sortMode} onChange={setSortMode} />
                  {idx === 0 && (
                    <button type="button" className="local-refresh-btn local-launcher-refresh-btn" onClick={onRefreshScan}>
                      <IconRefresh />
                    </button>
                  )}
                </div>
              </h2>
              <VirtualCardGrid
                entries={sortedEntries}
                getKey={entryKey}
                renderItem={entry => renderEntry(entry, entry.kind === 'game' ? gameStatusMatch.get(entry.game) : undefined)}
              />
            </section>
          );
        })
      )}

      {deleteMenu && (
        <DeleteContextMenu
          x={deleteMenu.x}
          y={deleteMenu.y}
          label="Eliminar de la lista"
          onDelete={() => deleteMenu.kind === 'game' ? handleDeleteGame(deleteMenu.game) : handleDeleteLibraryItem(deleteMenu.item)}
          onClose={closeDeleteMenu}
        />
      )}
    </div>
  );
}
