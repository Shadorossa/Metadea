import React, { useState } from 'react';
import { ModalShell } from '../shared/ModalShell';
import { comicVineSearch } from '../../lib/tauri';
import { API_ENDPOINTS } from '../../lib/api/endpoints';
import { searchTvIncludingAnime } from '../../lib/search/providers/tmdb';
import type { SearchResult } from '../../lib/search';
import { useDebouncedSearch } from '../shared/hooks/useDebouncedSearch';
import { getT } from '../../i18n/runtime';

export type MediaSourceMappingKind = 'episodes' | 'issues';

interface Props {
  kind: MediaSourceMappingKind;
  preferredIssueCount?: number | null;
  onSelect: (result: SearchResult) => void;
  onClose: () => void;
}

export function MediaSourceMappingSearchPopup({ kind, preferredIssueCount, onSelect, onClose }: Props) {
  const [query, setQuery] = useState('');
  const s = getT().search;
  const { results, isLoading } = useDebouncedSearch<SearchResult>(query, async (value, signal) => {
    if (kind === 'episodes') {
      const hits = await searchTvIncludingAnime(value, signal);
      return hits.map(hit => ({
        externalId: `series:${hit.id}`,
        type: 'series' as const,
        format: 'TV',
        source: 'tmdb' as const,
        titleMain: hit.name || `TMDB ${hit.id}`,
        titleRomaji: null,
        titleNative: null,
        coverUrl: hit.poster_path ? API_ENDPOINTS.TMDB_IMAGE(hit.poster_path, 'w185') : null,
        releaseYear: hit.first_air_date ? Number(hit.first_air_date.slice(0, 4)) || null : null,
        releaseMonth: null,
        releaseDay: null,
        scoreGlobal: null,
        genres: [],
      }));
    }

    const page = await comicVineSearch(value, 1);
    const volumes = preferredIssueCount && preferredIssueCount > 0
      ? page.volumes.filter(volume => volume.count_of_issues === preferredIssueCount)
      : page.volumes;
    return volumes.map(volume => ({
      externalId: `comic:${volume.id}`,
      type: 'comic' as const,
      format: 'VOLUME',
      source: 'comicvine' as const,
      titleMain: volume.name || `ComicVine ${volume.id}`,
      titleRomaji: null,
      titleNative: null,
      coverUrl: volume.image?.medium_url || volume.image?.small_url || null,
      releaseYear: volume.start_year ? Number(volume.start_year) || null : null,
      releaseMonth: null,
      releaseDay: null,
      scoreGlobal: null,
      genres: [],
    }));
  }, [kind, preferredIssueCount]);

  const placeholder = kind === 'episodes' ? 'Buscar serie en TMDB…' : 'Buscar volumen en ComicVine…';

  return (
    <ModalShell
      onClose={onClose}
      label={placeholder}
      overlayClassName="pr-editor-search-popup"
      panelClassName="pr-editor-search-popup-content pr-editor-search-popup-content--wide"
    >
        <div className="pr-editor-search-controls">
          <input
            autoFocus
            className="pr-editor-search-input"
            placeholder={placeholder}
            value={query}
            onChange={event => setQuery(event.target.value)}
          />
        </div>
        <div className="pr-editor-search-results pr-editor-search-results--grid">
          {isLoading && <div className="pr-editor-search-loading">{s.searching}</div>}
          {!isLoading && query && results.length === 0 && <div className="pr-editor-search-empty">{s.no_results_generic}</div>}
          <div className="pr-editor-search-grid">
            {results.map(result => (
              <button
                key={result.externalId}
                type="button"
                className="pr-editor-search-result-card"
                onClick={() => { onSelect(result); onClose(); }}
              >
                {result.coverUrl && <img src={result.coverUrl} alt="" className="pr-editor-search-result-cover" />}
                <div className="pr-editor-search-result-info">
                  <div className="pr-editor-search-result-id">{kind === 'episodes' ? 'TMDB' : 'ComicVine'} · {result.externalId.split(':').at(-1)}</div>
                  <div className="pr-editor-search-result-title">{result.titleMain}</div>
                  {result.releaseYear && <div className="pr-editor-search-result-id">{result.releaseYear}</div>}
                </div>
              </button>
            ))}
          </div>
        </div>
    </ModalShell>
  );
}
