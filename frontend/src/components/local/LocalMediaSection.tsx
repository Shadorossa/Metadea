import React, { useState, useEffect, useMemo } from 'react';
import { getT } from '../../i18n/client';
import type { LocalFolderEntry, LocalGame } from '../../lib/tauri';
import { LOCAL_MEDIA_TYPE_BY_CATEGORY, useLocalMediaItems, type LocalMediaItem, type LocalMediaRaw } from './hooks/useLocalMediaEntries';
import { isInProgressStatus } from '../../lib/constants/media';
import { LocalMediaCard } from './cards/LocalMediaCard';
import { LocalMediaDetailPanel } from './details/LocalMediaDetailPanel';
import { GameCard } from './cards/GameCard';
import { GameDetailPanel, type CoverCache } from './details/GameDetailPanel';
import { normalizeForMatch } from './utils/folderMatch';
import { IconFolder, IconPlus, IconX } from './ui/icons';
import type { CategoryId } from './utils/constants';

// null = no release date on file at all (never resolved a catalog entry, or
// the catalog entry itself has no release_year). Same "planning has nothing
// of its own to sort by" gap LibrarySection's own releaseTimestamp works
// around, reused here for the same reason.
function releaseTimestamp(item: LocalMediaItem): number | null {
  const meta = item.catalogEntry;
  if (!meta?.release_year) return null;
  return new Date(meta.release_year, (meta.release_month ?? 1) - 1, meta.release_day ?? 1).getTime();
}

// "Sin estrenar" — no release date on record at all, or one that hasn't
// happened yet — regardless of whether the library entry itself says
// watching or planning; either way there's nothing to actually watch/read
// yet, so it doesn't belong grouped in with things that ARE out already.
function isNotReleasedYet(item: LocalMediaItem): boolean {
  const ts = releaseTimestamp(item);
  return ts === null || ts > Date.now();
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
  onMetaRefresh?: () => void;
}

// Shows the library entries (watching/reading/playing + planning) for a
// media category as a card grid, and — on click — opens a side panel that
// tries to match the work to a subfolder of the category's assigned local
// folder and to the file for the episode/chapter the user is currently on.
export function LocalMediaSection({ category, rootFolder, rootEntries, rootLoading, onSetRoute, onClearRoute, onRootRefresh, filterName, mediaRaw, mediaLoading, refetchMedia, steamGames, coverCache, onMetaRefresh }: LocalMediaSectionProps) {
  const [isMounted, setIsMounted] = useState(false);
  useEffect(() => { setIsMounted(true); }, []);

  const t = getT();
  const p = t.profile;
  const allItemsRaw = useLocalMediaItems(category, mediaRaw);
  const loading = mediaLoading;
  const refetch = refetchMedia;

  // Matches each Steam-scanned game against the FULL library (any status,
  // not just allItemsRaw's in-progress/planning-only set) so a VN already
  // logged as completed doesn't get mislabeled into "Backlog de Steam" —
  // external_id link first (real, from local_game_links), else normalized
  // title against every title variant the catalog entry has (most Steam VNs
  // never go through local_game_links at all, so this is the common path).
  const categoryType = LOCAL_MEDIA_TYPE_BY_CATEGORY[category];
  const steamGameMatch = useMemo(() => {
    const result = new Map<LocalGame, { externalId: string; status: string } | null>();
    if (!steamGames || steamGames.length === 0 || !mediaRaw || !categoryType) return result;
    const catalogMap = new Map(mediaRaw.catalog.map(c => [c.external_id, c]));
    const relevant = mediaRaw.entries.filter(e => e.type === categoryType);
    const byExternalId = new Map(relevant.map(e => [e.external_id, e]));
    const byTitle = new Map<string, (typeof relevant)[number]>();
    for (const e of relevant) {
      const meta = catalogMap.get(e.external_id);
      for (const tt of [meta?.title_main, meta?.title_romaji, meta?.title_native]) {
        if (tt) byTitle.set(normalizeForMatch(tt), e);
      }
    }
    for (const g of steamGames) {
      const matched = (g.external_id && byExternalId.get(g.external_id)) || byTitle.get(normalizeForMatch(g.name)) || null;
      result.set(g, matched ? { externalId: matched.external_id, status: matched.status ?? 'planning' } : null);
    }
    return result;
  }, [steamGames, mediaRaw, categoryType]);

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
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = selectedId ? allItems.find(i => i.externalId === selectedId) ?? null : null;
  const [selectedGame, setSelectedGame] = useState<LocalGame | null>(null);

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
  type SectionEntry = { kind: 'catalog'; item: LocalMediaItem } | { kind: 'steam'; game: LocalGame };
  const toEntries = (catalogItems: LocalMediaItem[], games: LocalGame[]): SectionEntry[] => [
    ...catalogItems.map(item => ({ kind: 'catalog' as const, item })),
    ...games.map(game => ({ kind: 'steam' as const, game })),
  ];
  const sections = useMemo(() => {
    const notReleased = items.filter(isNotReleasedYet);
    const released = items.filter(i => !isNotReleasedYet(i));
    return [
      { title: p.section_in_progress, entries: toEntries(released.filter(i => isInProgressStatus(i.status)), steamInProgress) },
      { title: p.section_planning, entries: toEntries(released.filter(i => i.status === 'planning'), steamPlanning) },
      { title: 'Sin estrenar', entries: toEntries(notReleased, []) },
      { title: t.local.steam_backlog, entries: toEntries([], steamBacklog) },
    ].filter(s => s.entries.length > 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, p, steamInProgress, steamPlanning, steamBacklog, t]);

  const isEmpty = sections.length === 0;

  return (
    <div className={`local-games-container${(selected || selectedGame) ? ' with-detail' : ''}`}>
      <div className="local-main-content">
        <div className="local-content">
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
                  <h3 className="library-section-title">{sec.title}</h3>
                  <div className="local-games-grid">
                    {sec.entries.map(entry => entry.kind === 'catalog' ? (
                      <LocalMediaCard key={entry.item.externalId} item={entry.item} onClick={i => setSelectedId(i.externalId)} />
                    ) : (
                      <GameCard key={entry.game.app_id ?? entry.game.name} game={entry.game} coverCache={coverCache ?? {}} onClick={setSelectedGame} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

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
          onClose={() => setSelectedId(null)}
          onProgressSaved={refetch}
          onRootRefresh={onRootRefresh}
        />
      )}

      {selectedGame && (
        <GameDetailPanel
          game={selectedGame}
          coverCache={coverCache ?? {}}
          onClose={() => setSelectedGame(null)}
          onMetaRefresh={onMetaRefresh}
        />
      )}
    </div>
  );
}
