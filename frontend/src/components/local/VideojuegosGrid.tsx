import React, { useEffect, useState, useMemo } from 'react';
import type { LocalGame } from '../../lib/tauri';
import { getT } from '../../i18n/client';
import { getMediaCompanies } from '../../lib/tauri';
import type { LocalMediaItem } from './hooks/useLocalMediaEntries';
import type { GamesState } from './hooks/useLocalGames';
import type { CoverCache } from './details/GameDetailPanel';
import { type StatusEntry } from './utils/catalogGameLinking';
import { PLATFORM_LABEL, PLATFORM_LOGO, LAUNCHER_ORDER, type PlatformId } from './utils/constants';
import { GameCard } from './cards/GameCard';
import { LocalMediaCard } from './cards/LocalMediaCard';
import { FolderRouteControls } from './FolderRouteControls';
import { IconMonitor, IconFolder, IconRefresh } from './ui/icons';

interface StatusSection { key: string; title: string; entries: StatusEntry[] }

interface VideojuegosGridProps {
  gridRef:       React.RefObject<HTMLDivElement>;
  gamesState:    GamesState;
  gamesCount:    number;
  rootFolder:    string | undefined;
  onSetRoute:    () => void;
  onClearRoute:  () => void;
  onRefreshScan: () => void;
  isMounted:     boolean;
  // currentlyEntries/planningEntries already mix in catalog-tracked
  // "pendiente" entries (see LocalLibrary's buildCatalogStatusEntries) —
  // pausedGames/droppedGames don't, since those statuses have no such
  // cross-check today, so they arrive as plain LocalGame[] instead.
  currentlyEntries: StatusEntry[];
  planningEntries:  StatusEntry[];
  pausedGames:      LocalGame[];
  droppedGames:     LocalGame[];
  coverCache:      CoverCache;
  coverCacheHits:  Record<string, string>;
  onSelectGame:    (g: LocalGame | null) => void;
  onSelectPending: (item: LocalMediaItem, launchGame?: LocalGame) => void;
  scanError:       string | null;
  debugInfo:       string | null;
  onRunDiagnostics: () => void;
  groupedGames: Map<PlatformId, LocalGame[]>;
  sectionRefs:  React.MutableRefObject<Map<string, HTMLElement>>;
}

// The Videojuegos-only grid — status-grouped sections (En progreso/
// Planeando/Pausado/Abandonado) on top, followed by whatever's left grouped
// by launcher. Pulled out of LocalLibrary.tsx, which owned this ~120-line
// block directly alongside every other category's selection/metadata-fetch
// state; this only needs the already-resolved data and a handful of
// callbacks.
export function VideojuegosGrid({
  gridRef, gamesState, gamesCount, rootFolder, onSetRoute, onClearRoute, onRefreshScan, isMounted,
  currentlyEntries, planningEntries, pausedGames, droppedGames, coverCache, coverCacheHits,
  onSelectGame, onSelectPending, scanError, debugInfo, onRunDiagnostics, groupedGames, sectionRefs,
}: VideojuegosGridProps) {
  const t = getT();
  const [companiesByExternalId, setCompaniesByExternalId] = useState<Record<string, string[]>>({});

  // Memoize external IDs to check, keyed by sorted list to avoid re-renders
  const externalIdsToCheck = useMemo(() => {
    const ids = new Set<string>();
    for (const entry of currentlyEntries) {
      if (entry.kind === 'catalog' && entry.item.catalogEntry) ids.add(entry.item.externalId);
    }
    for (const entry of planningEntries) {
      if (entry.kind === 'catalog' && entry.item.catalogEntry) ids.add(entry.item.externalId);
    }
    return Array.from(ids).sort().join(',');
  }, [currentlyEntries, planningEntries]);

  // Load companies for pending games to detect Nintendo/PlayStation as publisher/developer
  useEffect(() => {
    if (!externalIdsToCheck) return;
    const ids = externalIdsToCheck.split(',');
    const promises = ids.map(id =>
      getMediaCompanies(id)
        .then(companies => ({
          id,
          platforms: companies
            .filter(c => (c.role === 'developer' || c.role === 'publisher') && (
              c.name.toLowerCase().includes('nintendo') ||
              c.name.toLowerCase().includes('playstation') ||
              c.name.toLowerCase().includes('sony')
            ))
            .map(c => c.name.toLowerCase().includes('nintendo') ? 'nintendo' : 'playstation')
        }))
        .catch(() => ({ id, platforms: [] }))
    );

    Promise.all(promises).then(results => {
      const map: Record<string, string[]> = {};
      for (const { id, platforms } of results) {
        if (platforms.length > 0) map[id] = platforms;
      }
      setCompaniesByExternalId(map);
    });
  }, [externalIdsToCheck]);

  // Extract launcher from shop_links_csv (e.g. "steam|url,epic|url" → "steam")
  const getLauncherFromShopLinks = (shopLinksCsv?: string | null): string | undefined => {
    if (!shopLinksCsv) return undefined;
    const platforms = shopLinksCsv.split(',').map(p => p.split('|')[0]?.trim().toLowerCase());
    // Map IGDB platform names to our launcher names
    const platformMap: Record<string, string> = {
      'steam': 'steam',
      'epic games store': 'epic',
      'epic': 'epic',
      'gog': 'gog',
      'xbox': 'xbox',
      'xbox game pass': 'xbox',
      'ea': 'ea',
      'ea app': 'ea',
      'origin': 'ea',
      'nintendo': 'nintendo',
      'nintendo eshop': 'nintendo',
      'playstation': 'playstation',
      'playstation store': 'playstation',
    };
    // Find first known platform, prefer steam
    for (const p of platforms) {
      if (p === 'steam') return 'steam';
    }
    for (const p of platforms) {
      const mapped = platformMap[p];
      if (mapped) return mapped;
    }
    return undefined;
  };

  // Group pending entries that have a launcher by that launcher
  const groupPendingByLauncher = (entries: StatusEntry[]): Map<string, StatusEntry[]> => {
    const grouped = new Map<string, StatusEntry[]>();
    for (const entry of entries) {
      if (entry.kind === 'catalog') {
        // Try matched launchGame first, then extract from catalog's shop_links, then check companies
        let launcher = entry.launchGame?.launcher ?? getLauncherFromShopLinks(entry.item.catalogEntry?.shop_links_csv);
        if (!launcher && companiesByExternalId[entry.item.externalId]) {
          launcher = companiesByExternalId[entry.item.externalId][0];
        }
        if (launcher) {
          if (!grouped.has(launcher)) grouped.set(launcher, []);
          grouped.get(launcher)!.push(entry);
        }
      }
    }
    return grouped;
  };

  const pendingByLauncher = new Map<string, StatusEntry[]>();

  // Build a set of pending entries that have a launcher (will be excluded from status sections)
  const pendingWithLauncherIds = new Set<string>();
  for (const [launcher, entries] of groupPendingByLauncher(currentlyEntries).entries()) {
    if (!pendingByLauncher.has(launcher)) pendingByLauncher.set(launcher, []);
    pendingByLauncher.get(launcher)!.push(...entries);
    for (const entry of entries) pendingWithLauncherIds.add(entry.item.externalId);
  }
  for (const [launcher, entries] of groupPendingByLauncher(planningEntries).entries()) {
    if (!pendingByLauncher.has(launcher)) pendingByLauncher.set(launcher, []);
    pendingByLauncher.get(launcher)!.push(...entries);
    for (const entry of entries) pendingWithLauncherIds.add(entry.item.externalId);
  }

  // Filter out catalog entries that have a launcher — they go ONLY to their launcher section
  const statusEntriesCurrently = currentlyEntries.filter(e => !(e.kind === 'catalog' && pendingWithLauncherIds.has(e.item.externalId)));
  const statusEntriesPlanning = planningEntries.filter(e => !(e.kind === 'catalog' && pendingWithLauncherIds.has(e.item.externalId)));

  // The four status buckets share one section shell (title + grid, mixing
  // GameCard/LocalMediaCard by entry.kind) — same {title,entries}[] + one
  // .map() pattern LocalMediaSection already uses for its own sections,
  // instead of four hand-rolled, near-identical JSX blocks.
  const statusSections: StatusSection[] = [
    ...(statusEntriesCurrently.length > 0 ? [{ key: 'currently', title: t.profile.section_in_progress, entries: statusEntriesCurrently }] : []),
    ...(statusEntriesPlanning.length > 0 ? [{ key: 'planning', title: t.profile.section_planning, entries: statusEntriesPlanning }] : []),
    ...(pausedGames.length > 0 ? [{ key: 'paused', title: 'Pausado', entries: pausedGames.map((game): StatusEntry => ({ kind: 'game', game })) }] : []),
    ...(droppedGames.length > 0 ? [{ key: 'dropped', title: 'Abandonado', entries: droppedGames.map((game): StatusEntry => ({ kind: 'game', game })) }] : []),
  ];

  return (
    <div className="local-content" ref={gridRef}>
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
              <GameCard key={entry.game.app_id ?? `g${i}`} game={entry.game} coverCache={coverCache} onClick={onSelectGame} />
            ) : (
              <LocalMediaCard
                key={entry.item.externalId}
                item={entry.item}
                cachedPath={coverCacheHits[entry.item.externalId]}
                onClick={pendingItem => onSelectPending(pendingItem, entry.launchGame)}
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
          const totalCount = list.length + pendingForLauncher.length;
          return (
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
                  <span className="local-launcher-count">{totalCount} juego{totalCount !== 1 ? 's' : ''}</span>
                </div>
                {idx === 0 && (
                  <button type="button" className="local-refresh-btn local-launcher-refresh-btn" onClick={onRefreshScan} disabled={gamesState === 'loading'}>
                    <IconRefresh />
                  </button>
                )}
              </h2>
              <div className="local-games-grid">
                {pendingForLauncher.map((entry, i) => entry.kind === 'game' ? (
                  <GameCard key={`pending-${i}`} game={entry.game} coverCache={coverCache} onClick={onSelectGame} />
                ) : (
                  <LocalMediaCard
                    key={`pending-catalog-${entry.item.externalId}`}
                    item={entry.item}
                    cachedPath={coverCacheHits[entry.item.externalId]}
                    onClick={pendingItem => onSelectPending(pendingItem, entry.launchGame)}
                  />
                ))}
                {list.map((g, i) => (
                  <GameCard key={i} game={g} coverCache={coverCache} onClick={onSelectGame} />
                ))}
              </div>
            </section>
          );
        })
      )}
    </div>
  );
}
