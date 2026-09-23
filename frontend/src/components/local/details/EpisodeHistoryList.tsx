import React from 'react';
import { createPortal } from 'react-dom';
import type { EpisodeHistoryEntry } from '../../../lib/tauri';
import { getT } from '../../../i18n/runtime';
import type { LocalMediaItem } from '../hooks/useLocalMediaEntries';
import type { ChainHistoryEntry, HistoryMenuState } from '../hooks/useEpisodeHistory';
import { formatEpisodeLabel, isRedundantEpisodeName } from '../../../lib/local/folder-match';
import { formatWatchedAt } from '../../../lib/local/formatters';
import { isReadingType } from '../../../lib/media/media-types';
import { IconCheck, IconTrash } from '../ui/icons';

interface EpisodeHistoryListProps {
  item:          LocalMediaItem;
  itemSeason:    number | null;
  isMovieFormat: boolean;
  history:       ChainHistoryEntry[];
  episodeNames:  Map<string, string>;
  historyMenu:   HistoryMenuState | null;
  onOpenMenu:    (menu: HistoryMenuState) => void;
  onDeleteEntry: (entry: EpisodeHistoryEntry) => void;
}

// The history feed plus its right-click delete menu. The menu portal is
// rendered even while the feed itself is empty (the feed reads as empty
// during a chain refetch, the menu is only cleared once it lands) —
// same as when both lived inline in LocalMediaDetailPanel.
export function EpisodeHistoryList({ item, itemSeason, isMovieFormat, history, episodeNames, historyMenu, onOpenMenu, onDeleteEntry }: EpisodeHistoryListProps) {
  const t = getT();

  return (
    <>
      {history.length > 0 && (
        <div className="local-media-history">
          <p className="local-media-history-title">{t.local.history_label}</p>
          <div className="local-media-history-feed">
            {history.map(h => (
              <div
                key={h.id}
                className="local-media-history-item"
                onContextMenu={e => {
                  e.preventDefault();
                  e.stopPropagation();
                  onOpenMenu({ x: e.pageX, y: e.pageY, entry: h });
                }}
              >
                <IconCheck />
                {isMovieFormat ? (
                  <span>{t.local.seen_count} <strong>{h.seasonTitle || item.title}</strong></span>
                ) : (
                  <span>
                    {isReadingType(item.libraryEntry.type) ? (
                      <>
                        {t.media.chapter} <strong>{h.episode_number}</strong> - {h.seasonTitle || item.title}
                      </>
                    ) : (
                      <>
                        <strong>{formatEpisodeLabel(h.seasonNum ?? itemSeason, h.episode_number, item.libraryEntry.type)}</strong>
                        {(() => {
                          const fetchedName = episodeNames.get(`${h.external_id}|${h.episode_number}`);
                          return fetchedName && !isRedundantEpisodeName(fetchedName, h.seasonTitle, item.title) ? <> - "{fetchedName}"</> : null;
                        })()} - {h.seasonTitle || item.title}
                      </>
                    )}
                  </span>
                )}
                <span className="local-media-history-date">{formatWatchedAt(h.watched_at)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {historyMenu && createPortal(
        <div
          className="context-menu local-history-context-menu"
          style={{ top: historyMenu.y, left: historyMenu.x }}
          onClick={e => e.stopPropagation()}
        >
          <button
            type="button"
            className="context-menu-item local-history-context-menu-item delete"
            onClick={() => onDeleteEntry(historyMenu.entry)}
          >
            <span style={{ marginRight: 6, display: 'inline-flex' }}><IconTrash /></span>
            <span>{t.local.delete_history_entry}</span>
          </button>
        </div>,
        document.body
      )}
    </>
  );
}
