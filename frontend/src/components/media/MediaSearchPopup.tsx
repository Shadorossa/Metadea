import React, { useState, useEffect } from 'react';
import { getCatalogEntry, saveCatalogEntry } from '../../lib/tauri/catalog';
import { search, type MediaType, type SearchResult as ApiSearchResult } from '../../lib/search';

// Every media type an API search can plausibly return — a saga/bundled-in
// relation isn't guaranteed to share the current entry's own type (e.g. a
// vnovel's saga can include a movie adaptation), so all of them are queried
// in parallel rather than restricting to the entry's own type.
const SEARCHABLE_TYPES: MediaType[] = ['anime', 'manga', 'lnovel', 'game', 'vnovel', 'movie', 'series', 'book'];

type SearchSort = 'relevance' | 'title_asc' | 'year_desc' | 'year_asc' | 'score_desc';

const SORT_FNS: Record<SearchSort, (a: ApiSearchResult, b: ApiSearchResult) => number> = {
  relevance: () => 0,
  title_asc: (a, b) => (a.titleMain || '').localeCompare(b.titleMain || ''),
  year_desc: (a, b) => (b.releaseYear ?? -Infinity) - (a.releaseYear ?? -Infinity),
  year_asc: (a, b) => (a.releaseYear ?? Infinity) - (b.releaseYear ?? Infinity),
  score_desc: (a, b) => (b.scoreGlobal ?? -Infinity) - (a.scoreGlobal ?? -Infinity),
};

// Ensures the id picked from a live API search is backed by a local catalog
// row — this is what makes external_id the same canonical value across every
// user's install (it's the API's own numeric id, not something invented
// locally). Only creates a thin skeleton when nothing exists yet: this must
// never overwrite a richer, already-cataloged row (save_catalog_entry is a
// full INSERT OR REPLACE, so writing a thin stub over an existing rich row
// would wipe its genres/synopsis/platforms/etc. back to null).
async function ensureSkeletonCatalogEntry(result: ApiSearchResult): Promise<void> {
  const existing = await getCatalogEntry(result.externalId).catch(() => null);
  if (existing) return;

  const now = new Date().toISOString();
  await saveCatalogEntry({
    id: '',
    external_id: result.externalId,
    type: result.type,
    format: result.format || null,
    source: result.source,
    title_main: result.titleMain,
    title_romaji: result.titleRomaji,
    title_native: result.titleNative,
    cover_url: result.coverUrl,
    release_year: result.releaseYear,
    release_month: result.releaseMonth,
    release_day: result.releaseDay,
    score_global: result.scoreGlobal,
    created_at: now,
    updated_at: now,
  }).catch(err => console.error('Failed to save skeleton catalog entry:', err));
}

export interface MediaSearchPopupProps {
  onSelect: (result: ApiSearchResult) => void;
  onClose: () => void;
  excludeIds?: string[];
  /** false keeps the popup open after picking a result (clears the query
   *  instead) — used for the Saga list, where adding several works in a row
   *  is the common case; true (default) closes immediately after one pick. */
  closeOnSelect?: boolean;
}

/** Live multi-provider search (AniList/IGDB/TMDB/OpenLibrary) used to attach
 *  a saga member or bundled-in work to the entry being edited. Closes only
 *  on an outside click (stopPropagation keeps that from also closing the
 *  parent PrEditorModal). */
export function MediaSearchPopup({ onSelect, onClose, excludeIds = [], closeOnSelect = true }: MediaSearchPopupProps) {
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<MediaType | 'all'>('all');
  const [sortBy, setSortBy] = useState<SearchSort>('relevance');
  const [results, setResults] = useState<ApiSearchResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }

    const typesToQuery = typeFilter === 'all' ? SEARCHABLE_TYPES : [typeFilter];
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setIsLoading(true);
      Promise.all(typesToQuery.map(t => search(query, t, controller.signal).catch(() => [])))
        .then(perType => {
          if (controller.signal.aborted) return;
          setResults(perType.flat().slice(0, 60));
        })
        .finally(() => {
          if (!controller.signal.aborted) setIsLoading(false);
        });
    }, 400);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, typeFilter]);

  const handleSelect = async (result: ApiSearchResult) => {
    if (closeOnSelect) {
      onClose();
    } else {
      setQuery(''); // clear the search box so the next pick starts fresh, popup stays open
    }
    await ensureSkeletonCatalogEntry(result);
    onSelect(result);
  };

  const sortedResults = [...results].sort(SORT_FNS[sortBy]);
  const filteredResults = sortedResults.filter(r => !excludeIds.includes(r.externalId));

  return (
    <div className="pr-editor-search-popup" onClick={e => { e.stopPropagation(); onClose(); }}>
      <div className="pr-editor-search-popup-content pr-editor-search-popup-content--wide" onClick={e => e.stopPropagation()}>
        <div className="pr-editor-search-controls">
          <input
            type="text"
            placeholder="Search titles across AniList, IGDB, TMDB, OpenLibrary..."
            value={query}
            onChange={e => setQuery(e.target.value)}
            autoFocus
            className="pr-editor-search-input"
          />
          <select
            className="pr-editor-search-select"
            value={typeFilter}
            onChange={e => setTypeFilter(e.target.value as MediaType | 'all')}
          >
            <option value="all">All types</option>
            <option value="anime">Anime</option>
            <option value="manga">Manga</option>
            <option value="lnovel">Light Novel</option>
            <option value="game">Game</option>
            <option value="vnovel">Visual Novel</option>
            <option value="movie">Movie</option>
            <option value="series">Series</option>
            <option value="book">Book</option>
          </select>
          <select
            className="pr-editor-search-select"
            value={sortBy}
            onChange={e => setSortBy(e.target.value as SearchSort)}
          >
            <option value="relevance">Relevance</option>
            <option value="title_asc">Title A-Z</option>
            <option value="year_desc">Newest first</option>
            <option value="year_asc">Oldest first</option>
            <option value="score_desc">Highest score</option>
          </select>
        </div>
        <div className="pr-editor-search-results pr-editor-search-results--grid">
          {isLoading && <div className="pr-editor-search-loading">Searching...</div>}
          {!isLoading && filteredResults.length === 0 && query && (
            <div className="pr-editor-search-empty">No results</div>
          )}
          <div className="pr-editor-search-grid">
             {(() => {
               const seen = new Set();
               return filteredResults
                 .filter(r => {
                   if (seen.has(r.externalId)) return false;
                   seen.add(r.externalId);
                   return true;
                 })
                 .map(r => (
                   <button
                     key={r.externalId}
                     type="button"
                     className="pr-editor-search-result-card"
                     onClick={() => handleSelect(r)}
                   >
                     {r.coverUrl && (
                       <img src={r.coverUrl} alt="" className="pr-editor-search-result-cover" />
                     )}
                     <div className="pr-editor-search-result-info">
                       <div className="pr-editor-search-result-id">{r.externalId}</div>
                       <div className="pr-editor-search-result-title">{r.titleMain || '—'}</div>
                     </div>
                   </button>
                 ));
             })()}
          </div>
        </div>
      </div>
    </div>
  );
}
