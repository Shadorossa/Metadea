import { useState } from 'react';
import { igdbSearchUnfiltered, igdbImageUrl } from '../../lib/tauri';
import { graphqlPost, fetchJson } from '../../lib/api/client';
import { API_ENDPOINTS } from '../../lib/api/endpoints';
import { getTmdbAuth, tmdbLocale } from '../../lib/search/providers/tmdb';
import { bookIdFromWorkKey } from '../../lib/search/providers/openlibrary';
import { useDebouncedSearch } from '../../lib/shared/useDebouncedSearch';

type ApiProvider = 'igdb' | 'anilist' | 'tmdb' | 'openlibrary' | 'comicvine';

interface RawResult {
  // Canonical "{type}:{id}" external id — same convention the rest of the
  // app uses (media-relations.ts, catalog.ts, MediaPage's URL param, ...),
  // NOT a provider-prefixed id — this is what makes a result pickable
  // directly into the local catalog without any further translation.
  externalId: string;
  title: string;
  cover: string | null;
  year: number | null;
  extra: string | null;
}

const PROVIDER_LABELS: Record<ApiProvider, string> = {
  igdb:        'IGDB (Juegos / VNs)',
  anilist:     'AniList (Anime / Manga)',
  tmdb:        'TMDB (Películas / Series)',
  openlibrary: 'Open Library (Libros)',
  comicvine:   'Comic Vine (Cómics)',
};

// ── AniList raw search — no format/type filter ────────────────────────────────
const ANILIST_RAW_QUERY = `
  query Search($q: String!, $page: Int) {
    Page(page: $page, perPage: 50) {
      media(search: $q, sort: SEARCH_MATCH) {
        id type format
        title { romaji english native }
        coverImage { large }
        startDate { year }
      }
    }
  }
`;

async function searchAniListRaw(query: string, signal: AbortSignal): Promise<RawResult[]> {
  const { ok, result } = await graphqlPost<any>(
    API_ENDPOINTS.ANILIST,
    ANILIST_RAW_QUERY,
    { q: query, page: 1 },
    { signal },
  );
  if (!ok) return [];
  return (result?.data?.Page?.media ?? []).map((m: any) => {
    // Same anime/manga/lnovel split as the normal search flow (lib/search/index.ts):
    // AniList only has ANIME/MANGA types — a light novel is a MANGA-type entry
    // with format NOVEL.
    const type = m.type === 'ANIME' ? 'anime' : m.format === 'NOVEL' ? 'lnovel' : 'manga';
    return {
      externalId: `${type}:${m.id}`,
      title: m.title?.romaji || m.title?.english || m.title?.native || `#${m.id}`,
      cover: m.coverImage?.large ?? null,
      year:  m.startDate?.year ?? null,
      extra: [m.type, m.format].filter(Boolean).join(' · '),
    };
  });
}

// ── TMDB multi-search — movies + series without anime filter ─────────────────
async function searchTmdbRaw(query: string, signal: AbortSignal): Promise<RawResult[]> {
  const auth = await getTmdbAuth();
  if (!auth) return [];
  const url = `${API_ENDPOINTS.TMDB}/search/multi?query=${encodeURIComponent(query)}&page=1&language=${tmdbLocale()}`;
  const headers: Record<string, string> = auth.accessToken
    ? { Authorization: `Bearer ${auth.accessToken}` }
    : {};
  const qs = auth.apiKey && !auth.accessToken ? `&api_key=${auth.apiKey}` : '';
  const data = await fetchJson<any>(url + qs, { signal, headers });
  if (!data) return [];
  return (data.results ?? [])
    .filter((r: any) => r.media_type === 'movie' || r.media_type === 'tv')
    .map((r: any) => {
      const type = r.media_type === 'movie' ? 'movie' : 'series';
      return {
        externalId: `${type}:${r.id}`,
        title: r.title || r.name || `#${r.id}`,
        cover: r.poster_path ? `https://image.tmdb.org/t/p/w185${r.poster_path}` : null,
        year:  r.release_date
          ? parseInt(r.release_date.slice(0, 4))
          : r.first_air_date ? parseInt(r.first_air_date.slice(0, 4)) : null,
        extra: r.media_type === 'movie' ? 'Movie' : 'TV',
      };
    });
}

// ── OpenLibrary raw search — no cover filter ──────────────────────────────────
async function searchOpenLibraryRaw(query: string, signal: AbortSignal): Promise<RawResult[]> {
  const url = `https://openlibrary.org/search.json?q=${encodeURIComponent(query)}&limit=50&fields=key,title,author_name,first_publish_year,cover_i`;
  const data = await fetchJson<any>(url, { signal });
  if (!data) return [];
  return (data.docs ?? []).map((b: any) => ({
    externalId: `book:${bookIdFromWorkKey(b.key)}`,
    title: b.title,
    cover: b.cover_i ? `https://covers.openlibrary.org/b/id/${b.cover_i}-M.jpg` : null,
    year:  b.first_publish_year ?? null,
    extra: b.author_name?.[0] ?? null,
  }));
}

// ── Comic Vine raw search — no cover filter ───────────────────────────────────
async function searchComicVineRaw(query: string, signal: AbortSignal): Promise<RawResult[]> {
  const url = `/api/search/comics?q=${encodeURIComponent(query)}&page=1`;
  const data = await fetchJson<any>(url, { signal });
  if (!data) return [];
  return (data.results ?? []).map((v: any) => ({
    externalId: `comic:${v.id}`,
    title: v.name,
    cover: v.image?.medium_url ?? null,
    year:  v.start_year ? parseInt(v.start_year) : null,
    extra: v.publisher?.name ?? null,
  }));
}

// ── IGDB unfiltered search ────────────────────────────────────────────────────
async function searchIgdbRaw(query: string): Promise<RawResult[]> {
  const page = await igdbSearchUnfiltered(query, 1);
  return (page.games ?? []).map((g: any) => {
    const cover = g.cover?.image_id ? igdbImageUrl(g.cover.image_id, 'cover_big') : null;
    const year = g.first_release_date
      ? new Date(g.first_release_date * 1000).getFullYear()
      : null;
    const genres = Array.isArray(g.genres) ? g.genres.map((gn: any) => gn.name).join(', ') : null;
    const type = g.is_vn ? 'vnovel' : 'game';
    return {
      externalId: `${type}:${g.id}`,
      title: g.name,
      cover,
      year,
      extra: genres,
    };
  });
}

export interface AdminAddSearchResult {
  externalId: string;
  title: string;
  coverUrl: string | null;
}

interface AdminAddSearchProps {
  onSelect: (result: AdminAddSearchResult) => void;
}

/** Multi-provider search with zero filtering (no cover requirement, no
 *  category/VN allowlist) — finds works the normal search hides, for the
 *  admin panel's "add a missing work" flow. Visually matches
 *  MediaSearchPopup (the saga/bundled-in search inside PrEditorModal), but
 *  is a different search (raw per-provider, provider picked explicitly)
 *  rather than a merged live multi-type search. */
export function AdminAddSearch({ onSelect }: AdminAddSearchProps) {
  const [provider, setProvider] = useState<ApiProvider>('igdb');
  const [query, setQuery] = useState('');

  const { results, isLoading } = useDebouncedSearch<RawResult>(
    query,
    (q, signal) => {
      const search = provider === 'igdb'        ? searchIgdbRaw(q)
                    : provider === 'anilist'     ? searchAniListRaw(q, signal)
                    : provider === 'tmdb'        ? searchTmdbRaw(q, signal)
                    : provider === 'openlibrary' ? searchOpenLibraryRaw(q, signal)
                    : searchComicVineRaw(q, signal);
      return search.catch(err => {
        console.error('[AdminAddSearch] Search error:', err);
        return [] as RawResult[];
      });
    },
    [provider],
  );

  return (
    <div className="pr-editor-search-popup-content pr-editor-search-popup-content--wide pr-editor-search-popup-content--inline">
      <div className="pr-editor-search-controls">
        <input
          type="text"
          placeholder={`Buscar en ${PROVIDER_LABELS[provider]}...`}
          value={query}
          onChange={e => setQuery(e.target.value)}
          autoFocus
          className="pr-editor-search-input"
        />
        <select
          className="pr-editor-search-select"
          value={provider}
          onChange={e => { setProvider(e.target.value as ApiProvider); setQuery(''); }}
        >
          {(Object.entries(PROVIDER_LABELS) as [ApiProvider, string][]).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
      </div>
      <div className="pr-editor-search-results pr-editor-search-results--grid">
        {isLoading && <div className="pr-editor-search-loading">{getT().character.loading}</div>}
        {!isLoading && query.trim() && results.length === 0 && (
          <div className="pr-editor-search-empty">{getT().media.no_results}</div>
        )}
        <div className="pr-editor-search-grid">
          {results.map(r => (
            <button
              key={r.externalId}
              type="button"
              className="pr-editor-search-result-card"
              onClick={() => onSelect({ externalId: r.externalId, title: r.title, coverUrl: r.cover })}
            >
              {r.cover && <img src={r.cover} alt="" className="pr-editor-search-result-cover" />}
              <div className="pr-editor-search-result-info">
                <div className="pr-editor-search-result-id">{r.externalId}</div>
                <div className="pr-editor-search-result-title">
                  {r.title}
                  {(r.year || r.extra) && ` (${[r.year, r.extra].filter(Boolean).join(' · ')})`}
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
