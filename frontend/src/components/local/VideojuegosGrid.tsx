import React from 'react';
import type { LocalGame } from '../../lib/tauri';
import { getT } from '../../i18n/client';
import type { LocalMediaItem } from './hooks/useLocalMediaEntries';
import type { GamesState } from './hooks/useLocalGames';
import type { CoverCache } from './details/GameDetailPanel';
import { type StatusEntry } from './utils/catalogGameLinking';
import { PLATFORM_LABEL, PLATFORM_LOGO, type PlatformId } from './utils/constants';
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

  // Group pending entries by platform (extracted from launchGame.launcher)
  const groupPendingByPlatform = (entries: StatusEntry[], statusTitle: string): StatusSection[] => {
    const grouped = new Map<string, StatusEntry[]>();
    for (const entry of entries) {
      const platformId = entry.kind === 'catalog' && entry.launchGame
        ? entry.launchGame.launcher
        : 'ungrouped';
      if (!grouped.has(platformId)) grouped.set(platformId, []);
      grouped.get(platformId)!.push(entry);
    }

    return Array.from(grouped.entries()).map(([platformId, platformEntries]) => ({
      key: `${statusTitle}-${platformId}`,
      title: platformId === 'ungrouped'
        ? statusTitle
        : `${statusTitle} • ${PLATFORM_LABEL[platformId as PlatformId] || platformId}`,
      entries: platformEntries,
    }));
  };

  // The four status buckets grouped by platform
  const statusSections: StatusSection[] = [
    ...groupPendingByPlatform(currentlyEntries, t.profile.section_in_progress),
    ...groupPendingByPlatform(planningEntries, t.profile.section_planning),
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
                <button type="button" className="local-refresh-btn local-launcher-refresh-btn" onClick={onRefreshScan} disabled={gamesState === 'loading'}>
                  <IconRefresh />
                </button>
              )}
            </h2>
            <div className="local-games-grid">
              {list.map((g, i) => (
                <GameCard key={i} game={g} coverCache={coverCache} onClick={onSelectGame} />
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}
