import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  scanFolderContents, playFileWithVlc, getVlcPlaybackStatus, saveLibraryEntry,
  saveEpisodeHistoryEntry, getEpisodeHistory, type EpisodeHistoryEntry,
  type LocalFolderEntry, updateDiscordPresence, resetDiscordPresence,
} from '../../../lib/tauri';
import type { LocalMediaItem } from '../hooks/useLocalMediaEntries';
import { findMatchingFolder, findMatchingEpisodeFile, extractTitleSeason } from '../utils/folderMatch';
import { formatWatchedAt } from '../utils/formatters';
import { IconX, IconFolder, IconCheck, IconAlertCircle, IconPencil } from '../ui/icons';

interface LocalMediaDetailPanelProps {
  item:            LocalMediaItem;
  rootFolder:      string | undefined;
  rootEntries:     LocalFolderEntry[];
  rootLoading:     boolean;
  onClose:         () => void;
  onProgressSaved: () => void;
}

// The "in progress" verb a freshly-started entry should switch to — matches
// the same three-way split used everywhere else in the app (watching an
// anime/series/movie vs. reading a manga/light novel/book).
const START_STATUS_BY_TYPE: Record<string, string> = {
  anime: 'watching', series: 'watching', movie: 'watching',
  manga: 'reading', lnovel: 'reading', book: 'reading',
};

// Position (0-1) VLC has to reach for an episode to count as "watched" —
// leaves room for trailing credits/next-episode previews the user skips.
const AUTO_MARK_THRESHOLD = 0.8;
const POLL_INTERVAL_MS = 3000;

export function LocalMediaDetailPanel({ item, rootFolder, rootEntries, rootLoading, onClose, onProgressSaved }: LocalMediaDetailPanelProps) {
  const [subEntries, setSubEntries] = useState<LocalFolderEntry[] | null>(null);
  const [subLoading, setSubLoading] = useState(false);
  const [playError, setPlayError] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [justMarked, setJustMarked] = useState<number | null>(null);
  const [history, setHistory] = useState<EpisodeHistoryEntry[]>([]);

  // Which episode number the auto-mark already fired for, so a stray extra
  // poll tick (or VLC staying open past the threshold) can't save twice.
  const markedForRef = useRef<number | null>(null);
  const lastPresenceStartRef = useRef<number | null>(null);

  const candidateTitles = useMemo(
    () => [item.title, item.titleRomaji, item.titleNative].filter((t): t is string => !!t),
    [item],
  );

  // The season this specific library entry belongs to, inferred from its own
  // title (e.g. "... 2nd GIG" -> 2) — needed so a sequel season doesn't get
  // matched against the prequel's folder/files (see folderMatch.ts).
  const itemSeason = useMemo(
    () => candidateTitles.reduce<number | null>((found, t) => found ?? extractTitleSeason(t), null),
    [candidateTitles],
  );

  const matchedFolder = useMemo(
    () => findMatchingFolder(rootEntries, candidateTitles, itemSeason),
    [rootEntries, candidateTitles, itemSeason],
  );

  useEffect(() => {
    setPlayError(null);
    setIsPlaying(false);
    setJustMarked(null);
    markedForRef.current = null;
    lastPresenceStartRef.current = null;
    getEpisodeHistory(item.externalId).then(setHistory).catch(() => setHistory([]));
  }, [item.externalId]);

  useEffect(() => {
    if (!matchedFolder || !rootFolder) { setSubEntries(null); return; }
    setSubLoading(true);
    scanFolderContents(`${rootFolder}/${matchedFolder.name}`)
      .then(setSubEntries)
      .catch(() => setSubEntries([]))
      .finally(() => setSubLoading(false));
  }, [matchedFolder, rootFolder]);

  // The next episode/chapter to watch/read — one past whatever's saved as
  // progress, or the first one when the entry is still just "planning".
  const nextNumber = item.status === 'planning' ? 1 : item.progress + 1;
  const nextFile = subEntries ? findMatchingEpisodeFile(subEntries, nextNumber, itemSeason) : null;

  const playPath = rootFolder && matchedFolder && nextFile
    ? `${rootFolder}/${matchedFolder.name}/${nextFile.name}`
    : null;

  const handleEdit = () => {
    window.dispatchEvent(new CustomEvent('open-profile-editor', {
      detail: {
        externalId:  item.externalId,
        libraryEntry: item.libraryEntry,
        catalogEntry: item.catalogEntry,
      },
    }));
  };

  const handlePlay = () => {
    if (!playPath) return;
    setPlayError(null);
    setJustMarked(null);
    playFileWithVlc(playPath)
      .then(() => setIsPlaying(true))
      .catch(err => setPlayError(String(err)));
  };

  const markWatched = async (episodeNumber: number) => {
    if (markedForRef.current === episodeNumber) return;
    markedForRef.current = episodeNumber;

    const nextStatus = item.status === 'planning'
      ? (START_STATUS_BY_TYPE[item.libraryEntry.type] ?? item.status)
      : item.libraryEntry.status;

    try {
      await saveLibraryEntry({
        ...item.libraryEntry,
        progress:   episodeNumber,
        status:     nextStatus,
        started_at: item.libraryEntry.started_at ?? new Date().toISOString(),
      });
      setJustMarked(episodeNumber);
      onProgressSaved();
      saveEpisodeHistoryEntry(item.externalId, episodeNumber)
        .then(() => getEpisodeHistory(item.externalId))
        .then(setHistory)
        .catch(err => console.error('Failed to save episode history', err));
    } catch (err) {
      // Don't block the next poll tick from retrying on a transient save error.
      markedForRef.current = null;
      console.error('Failed to auto-mark episode watched', err);
    }
  };

  // While VLC is playing the file we just launched, poll its HTTP status
  // interface and mark the episode watched once position crosses 80%.
  useEffect(() => {
    if (!isPlaying || !nextFile) return;

    const episodeNumber = nextNumber;
    const interval = setInterval(() => {
      getVlcPlaybackStatus().then(status => {
        if (!status) {
          setIsPlaying(false);
          return;
        }
        if (status.state !== 'playing' && status.state !== 'paused') {
          setIsPlaying(false);
          return;
        }

        // Live Discord Rich Presence updates with time remaining countdown
        if (status.state === 'playing') {
          const nowSec = Math.floor(Date.now() / 1000);
          const computedStart = nowSec - status.time;
          const computedEnd = computedStart + status.length;

          if (
            lastPresenceStartRef.current === null ||
            Math.abs(lastPresenceStartRef.current - computedStart) > 4
          ) {
            lastPresenceStartRef.current = computedStart;
            const coverUrl = item.cover && item.cover.startsWith('http') ? item.cover : undefined;
            updateDiscordPresence(`Watching ${item.title} - Episode ${nextNumber}`, "", computedStart, computedEnd, coverUrl, item.title, "metadea", "Metadea").catch(() => {});
          }
        } else if (status.state === 'paused') {
          if (lastPresenceStartRef.current !== null) {
            lastPresenceStartRef.current = null;
            const coverUrl = item.cover && item.cover.startsWith('http') ? item.cover : undefined;
            updateDiscordPresence(`Watching ${item.title} - Episode ${nextNumber}`, "Paused", undefined, undefined, coverUrl, item.title, "metadea", "Metadea").catch(() => {});
          }
        }

        if (status.position >= AUTO_MARK_THRESHOLD) {
          markWatched(episodeNumber);
        }
      }).catch(() => {
        setIsPlaying(false);
      });
    }, POLL_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [isPlaying, nextFile, nextNumber, item.title, item.cover]);

  useEffect(() => {
    if (isPlaying) {
      const coverUrl = item.cover && item.cover.startsWith('http') ? item.cover : undefined;
      updateDiscordPresence(`Watching ${item.title} - Episode ${nextNumber}`, "", undefined, undefined, coverUrl, item.title, "metadea", "Metadea").catch(() => {});
    } else {
      lastPresenceStartRef.current = null;
      resetDiscordPresence().catch(() => {});
    }
    return () => {
      lastPresenceStartRef.current = null;
      resetDiscordPresence().catch(() => {});
    };
  }, [isPlaying, item.title, nextNumber, item.cover]);

  return (
    <div className="local-game-detail-panel">
      <div className="local-game-detail-header">
        <button className="local-game-detail-back" onClick={onClose} title="Cerrar panel">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="19" y1="12" x2="5" y2="12"></line>
            <polyline points="12 19 5 12 12 5"></polyline>
          </svg>
        </button>
        {item.cover ? (
          <img src={item.cover} alt={item.title} />
        ) : (
          <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-elevated)' }}>
            <IconFolder />
          </div>
        )}
        <div className="local-game-detail-backdrop" />
        <button className="local-game-detail-close" onClick={onClose}><IconX /></button>
      </div>

      <div className="local-game-detail-content">
        <div className="local-game-detail-title-block">
          <p className="local-game-detail-title">{item.title}</p>
        </div>

        <div className="local-media-detail-actions">
          <button
            type="button"
            className="local-game-detail-play"
            disabled={!playPath}
            title={playPath ? undefined : 'No se encontró el archivo del próximo episodio/capítulo'}
            onClick={handlePlay}
          >
            {isPlaying ? (
              <span className="spinner spinner--sm" />
            ) : (
              <svg width={16} height={16} viewBox="0 0 24 24" fill="currentColor">
                <polygon points="5 3 19 12 5 21 5 3" />
              </svg>
            )}
            {isPlaying ? 'Reproduciendo' : 'Reproducir'}
          </button>
          <button type="button" className="local-media-detail-edit-icon" onClick={handleEdit} title="Editar log en el catálogo">
            <IconPencil />
          </button>
          <a href={`/media?id=${item.externalId}`} className="local-game-detail-catalog-link">
            <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
              <polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
            </svg>
            Ver en catálogo
          </a>
        </div>

        {playError && (
          <p className="local-media-play-error">No se pudo abrir VLC: {playError}</p>
        )}

        {justMarked != null && (
          <p className="local-media-play-status local-media-play-status--ok">
            <IconCheck /> Episodio/capítulo {justMarked} marcado como visto.
          </p>
        )}

        {!rootFolder ? (
          <div className="local-state-placeholder">
            <IconFolder />
            <p>No hay carpeta asignada para esta categoría.</p>
          </div>
        ) : rootLoading ? (
          <div className="local-state-placeholder"><div className="spinner" /></div>
        ) : (
          <div className="local-media-match-row">
            <span className={`local-media-match-chip${matchedFolder ? ' ok' : ' fail'}`}>
              {matchedFolder ? <IconCheck /> : <IconAlertCircle />}
              {matchedFolder
                ? <>Carpeta encontrada: <strong>{matchedFolder.name}</strong></>
                : 'Carpeta no encontrada'}
            </span>

            {matchedFolder && (
              subLoading ? (
                <span className="local-media-match-chip">
                  <div className="spinner spinner--sm" />
                  Buscando próximo episodio…
                </span>
              ) : (
                <span className={`local-media-match-chip${nextFile ? ' ok' : ' fail'}`}>
                  {nextFile ? <IconCheck /> : <IconAlertCircle />}
                  {nextFile
                    ? <>Próximo episodio: <strong>{nextFile.name}</strong></>
                    : `Próximo episodio (${nextNumber}) no encontrado`}
                </span>
              )
            )}
          </div>
        )}

        {history.length > 0 && (
          <div className="local-media-history">
            <p className="local-media-history-title">Historial</p>
            <div className="local-media-history-feed">
              {history.map(h => (
                <div key={h.id} className="local-media-history-item">
                  <IconCheck />
                  <span>Episodio/capítulo <strong>{h.episode_number}</strong></span>
                  <span className="local-media-history-date">{formatWatchedAt(h.watched_at)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
