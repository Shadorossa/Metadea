import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { search, type SearchResult as ApiSearchResult } from '../../lib/search';
import { fetchMediaEpisodes } from '../../lib/media/episode-list';
import type { MediaEpisode } from '../../lib/tauri';
import { useDebouncedSearch, dedupeByKey } from '../../lib/shared/useDebouncedSearch';
import { getT } from '../../i18n/client';

export interface EpisodeSearchResult {
  parentMedia: ApiSearchResult;
  episode: MediaEpisode;
  episodeExternalId: string;
}

export interface EpisodeSearchPopupProps {
  onSelect: (result: EpisodeSearchResult) => void;
  onClose: () => void;
  excludeIds?: string[];
  closeOnSelect?: boolean;
}

export function EpisodeSearchPopup({
  onSelect,
  onClose,
  excludeIds = [],
  closeOnSelect = false,
}: EpisodeSearchPopupProps) {
  const t = getT();
  const s = t.search;
  const p = t.profile;

  const [query, setQuery] = useState('');
  const [mediaTypeFilter, setMediaTypeFilter] = useState<'all' | 'anime' | 'series'>('all');
  const [selectedShow, setSelectedShow] = useState<ApiSearchResult | null>(null);
  const [episodes, setEpisodes] = useState<MediaEpisode[]>([]);
  const [isLoadingEpisodes, setIsLoadingEpisodes] = useState(false);

  const { results: showResults, isLoading: isSearchingShows } = useDebouncedSearch<ApiSearchResult>(
    query,
    async (q, signal) => {
      if (mediaTypeFilter === 'anime') {
        const res = await search(q, 'anime', signal).then(page => page.results).catch(() => [] as ApiSearchResult[]);
        return res.slice(0, 60);
      }
      if (mediaTypeFilter === 'series') {
        const res = await search(q, 'series', signal).then(page => page.results).catch(() => [] as ApiSearchResult[]);
        return res.slice(0, 60);
      }
      const [animeRes, seriesRes] = await Promise.all([
        search(q, 'anime', signal).then(page => page.results).catch(() => [] as ApiSearchResult[]),
        search(q, 'series', signal).then(page => page.results).catch(() => [] as ApiSearchResult[]),
      ]);
      return [...seriesRes, ...animeRes].slice(0, 60);
    },
    [mediaTypeFilter],
  );

  const deduplicatedShows = dedupeByKey(showResults, r => r.externalId);

  const handleSelectShow = async (show: ApiSearchResult) => {
    setSelectedShow(show);
    setIsLoadingEpisodes(true);
    try {
      const eps = await fetchMediaEpisodes(show.externalId, false);
      setEpisodes(eps);
    } catch (err) {
      console.error('Failed to fetch episodes:', err);
      setEpisodes([]);
    } finally {
      setIsLoadingEpisodes(false);
    }
  };

  const handleBackToShows = () => {
    setSelectedShow(null);
    setEpisodes([]);
  };

  const handleSelectEpisode = (ep: MediaEpisode) => {
    if (!selectedShow) return;
    const episodeExternalId = `episode:${selectedShow.externalId}:${ep.season_number}:${ep.episode_number}`;
    if (closeOnSelect) onClose();
    onSelect({
      parentMedia: selectedShow,
      episode: ep,
      episodeExternalId,
    });
  };

  const modal = (
    <div className="pr-editor-search-popup" onClick={e => { e.stopPropagation(); onClose(); }}>
      <div className="pr-editor-search-popup-content pr-editor-search-popup-content--wide" onClick={e => e.stopPropagation()}>
        {selectedShow ? (
          <div className="episode-search-show-header">
            <button
              type="button"
              className="episode-search-back-btn"
              onClick={handleBackToShows}
              title={p.lists_back}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M19 12H5" />
                <polyline points="12 19 5 12 12 5" />
              </svg>
              <span>{p.lists_back}</span>
            </button>
            <div className="episode-search-show-info">
              {selectedShow.coverUrl && (
                <img src={selectedShow.coverUrl} alt="" className="episode-search-show-thumb" />
              )}
              <div className="episode-search-show-meta">
                <span className="episode-search-show-title">{selectedShow.titleMain}</span>
                <span className="episode-search-show-badge">
                  {selectedShow.type === 'anime' ? s.types.anime : s.types.series}
                </span>
              </div>
            </div>
          </div>
        ) : (
          <div className="pr-editor-search-controls">
            <input
              type="text"
              placeholder={s.placeholder_multi_source}
              value={query}
              onChange={e => setQuery(e.target.value)}
              autoFocus
              className="pr-editor-search-input"
            />
            <select
              className="pr-editor-search-select"
              value={mediaTypeFilter}
              onChange={e => setMediaTypeFilter(e.target.value as 'all' | 'anime' | 'series')}
            >
              <option value="all">{s.types.all}</option>
              <option value="anime">{s.types.anime}</option>
              <option value="series">{s.types.series}</option>
            </select>
          </div>
        )}

        <div className="pr-editor-search-results pr-editor-search-results--grid">
          {/* Show Selection State */}
          {!selectedShow && (
            <>
              {isSearchingShows && <div className="pr-editor-search-loading">{s.search_loading}</div>}
              {!isSearchingShows && deduplicatedShows.length === 0 && query && (
                <div className="pr-editor-search-empty">{s.no_results}</div>
              )}
              <div className="pr-editor-search-grid">
                {deduplicatedShows.map(show => (
                  <button
                    key={show.externalId}
                    type="button"
                    className="pr-editor-search-result-card"
                    onClick={() => handleSelectShow(show)}
                  >
                    {show.coverUrl ? (
                      <img src={show.coverUrl} alt="" className="pr-editor-search-result-cover" />
                    ) : (
                      <div className="pr-editor-cover-placeholder" style={{ height: '140px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        —
                      </div>
                    )}
                    <div className="pr-editor-search-result-info">
                      <div className="pr-editor-search-result-id">{show.type === 'anime' ? s.types.anime : s.types.series}</div>
                      <div className="pr-editor-search-result-title">{show.titleMain || '—'}</div>
                    </div>
                  </button>
                ))}
              </div>
            </>
          )}

          {/* Episode Selection State */}
          {selectedShow && (
            <>
              {isLoadingEpisodes && <div className="pr-editor-search-loading">{s.search_loading}</div>}
              {!isLoadingEpisodes && episodes.length === 0 && (
                <div className="pr-editor-search-empty">{s.no_results}</div>
              )}
              <div className="episode-search-episodes-grid">
                {episodes.map(ep => {
                  const epId = `episode:${selectedShow.externalId}:${ep.season_number}:${ep.episode_number}`;
                  const isExcluded = excludeIds.includes(epId);
                  const epLabel = ep.season_number > 0
                    ? `T${ep.season_number} E${ep.episode_number}`
                    : `Ep. ${ep.episode_number}`;
                  const epTitle = ep.name || epLabel;

                  return (
                    <button
                      key={epId}
                      type="button"
                      className={`episode-search-card${isExcluded ? ' episode-search-card--excluded' : ''}`}
                      onClick={() => !isExcluded && handleSelectEpisode(ep)}
                      disabled={isExcluded}
                    >
                      <div className="episode-search-thumb-wrap">
                        {ep.cover_url || selectedShow.coverUrl ? (
                          <img
                            src={ep.cover_url || selectedShow.coverUrl!}
                            alt=""
                            className="episode-search-thumb"
                            loading="lazy"
                          />
                        ) : (
                          <div className="episode-search-thumb-fallback">
                            <span>{ep.episode_number}</span>
                          </div>
                        )}
                        <span className="episode-search-badge">{epLabel}</span>
                        {isExcluded && <span className="episode-search-added-badge">✓</span>}
                      </div>
                      <div className="episode-search-info">
                        <span className="episode-search-title" title={epTitle}>{epTitle}</span>
                        <span className="episode-search-show-name">{selectedShow.titleMain}</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );

  return typeof document !== 'undefined' ? createPortal(modal, document.body) : modal;
}
