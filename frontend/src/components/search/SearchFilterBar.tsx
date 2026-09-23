import type { SeasonId, SearchFilters } from '../../lib/search/index';
import type { Translations } from '../../i18n/index';

type SearchTranslations = Translations['search'];

export type SearchSortField = 'releaseDate' | 'scoreGlobal';
export type SearchSortDirection = 'asc' | 'desc';
export type SearchDropdown = 'sort' | 'season' | 'genre';

const SEASON_ORDER: SeasonId[] = ['WINTER', 'SPRING', 'SUMMER', 'FALL'];
const SEASON_LABELS = (i18n: SearchTranslations): Record<SeasonId, string> => ({
  WINTER: i18n.season_winter,
  SPRING: i18n.season_spring,
  SUMMER: i18n.season_summer,
  FALL: i18n.season_fall,
});

interface Props {
  i18n: SearchTranslations;
  openDropdown: SearchDropdown | null;
  onOpenDropdownChange: (dropdown: SearchDropdown | null) => void;
  sortField: SearchSortField;
  sortDirection: SearchSortDirection;
  onToggleSort: (field: SearchSortField) => void;
  seasonFilter: SeasonId | '';
  onSeasonChange: (season: SeasonId | '') => void;
  yearFilter: string;
  onYearDraftChange: (year: string) => void;
  onYearCommit: (year: string) => void;
  onYearStep: (delta: number) => void;
  genreFilters: string[];
  availableGenres: string[];
  onToggleGenre: (genre: string) => void;
  appliedFilters: SearchFilters;
  onClearFilters: () => void;
}

// Presentational only — every piece of state is owned by SearchIsland and
// threaded through as props/callbacks.
export function SearchFilterBar({
  i18n, openDropdown, onOpenDropdownChange, sortField, sortDirection, onToggleSort,
  seasonFilter, onSeasonChange, yearFilter, onYearDraftChange, onYearCommit, onYearStep,
  genreFilters, availableGenres, onToggleGenre, appliedFilters, onClearFilters,
}: Props) {
  return (
    <div className="search-toolbar">
      {/* Ordenar: un único cuadrado, Fecha y Nota lado a lado en el panel */}
      <div className="search-filter-wrap">
        <button
          type="button"
          onClick={() => onOpenDropdownChange(openDropdown === 'sort' ? null : 'sort')}
          className={`search-filter-btn${openDropdown === 'sort' ? ' active' : ''}`}
          title={i18n.sort_date}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 6h18M6 12h12M10 18h4"/>
          </svg>
        </button>
        {openDropdown === 'sort' && (
          <div className="search-filter-panel search-filter-panel--row">
            <button
              type="button"
              onClick={() => onToggleSort('releaseDate')}
              className={`search-sort-btn${sortField === 'releaseDate' ? ' active' : ''}`}
              title={i18n.sort_date}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '2px' }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
                </svg>
                {sortField === 'releaseDate' ? (
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    {sortDirection === 'desc' ? <polyline points="6 9 12 15 18 9"/> : <polyline points="18 15 12 9 6 15"/>}
                  </svg>
                ) : (
                  <span style={{ width: '10px' }} />
                )}
              </div>
            </button>
            <button
              type="button"
              onClick={() => onToggleSort('scoreGlobal')}
              className={`search-sort-btn${sortField === 'scoreGlobal' ? ' active' : ''}`}
              title={i18n.sort_rating}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '2px' }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
                </svg>
                {sortField === 'scoreGlobal' ? (
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    {sortDirection === 'desc' ? <polyline points="6 9 12 15 18 9"/> : <polyline points="18 15 12 9 6 15"/>}
                  </svg>
                ) : (
                  <span style={{ width: '10px' }} />
                )}
              </div>
            </button>
          </div>
        )}
      </div>

      {/* Temporada (trimestre) + año — un select y el año a su derecha */}
      <div className="search-filter-wrap">
        <button
          type="button"
          onClick={() => onOpenDropdownChange(openDropdown === 'season' ? null : 'season')}
          className={`search-filter-btn${openDropdown === 'season' ? ' active' : ''}${appliedFilters.season || appliedFilters.year ? ' has-value' : ''}`}
          title={i18n.filter_season_year}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
          </svg>
        </button>
        {openDropdown === 'season' && (
          <div className="search-filter-panel">
            <div className="search-filter-panel--row">
              <select
                className="search-filter-select"
                value={seasonFilter}
                onChange={e => onSeasonChange(e.target.value as SeasonId | '')}
              >
                <option value="">{i18n.filter_all}</option>
                {SEASON_ORDER.map(s => (
                  <option key={s} value={s}>{SEASON_LABELS(i18n)[s]}</option>
                ))}
              </select>
              <div className="search-filter-year-group">
                <button
                  type="button"
                  className="search-filter-year-step"
                  onClick={() => onYearStep(-1)}
                  aria-label="-1"
                >
                  −
                </button>
                <input
                  type="number"
                  className="search-filter-year-input"
                  placeholder={String(new Date().getFullYear())}
                  value={yearFilter}
                  onChange={e => onYearDraftChange(e.target.value)}
                  onBlur={() => onYearCommit(yearFilter)}
                  onKeyDown={e => e.key === 'Enter' && onYearCommit(yearFilter)}
                />
                <button
                  type="button"
                  className="search-filter-year-step"
                  onClick={() => onYearStep(1)}
                  aria-label="+1"
                >
                  +
                </button>
              </div>
              <button
                type="button"
                className="search-filter-clear-x"
                onClick={onClearFilters}
                title={i18n.filter_clear}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Género — lista con checkboxes, selección múltiple. Solo se
          ofrece para tipos cuyo proveedor de verdad soporta filtrar
          por género server-side (ver GENRE_OPTIONS). */}
      {availableGenres.length > 0 && (
        <div className="search-filter-wrap">
          <button
            type="button"
            onClick={() => onOpenDropdownChange(openDropdown === 'genre' ? null : 'genre')}
            className={`search-filter-btn${openDropdown === 'genre' ? ' active' : ''}${appliedFilters.genres?.length ? ' has-value' : ''}`}
            title={i18n.filter_genre}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20.59 13.41 11 3.83A2 2 0 0 0 9.59 3.24L4 3a1 1 0 0 0-1 1l.24 5.59a2 2 0 0 0 .59 1.41l9.58 9.58a2 2 0 0 0 2.83 0l4.35-4.35a2 2 0 0 0 0-2.82Z"/>
              <circle cx="7.5" cy="7.5" r="1"/>
            </svg>
          </button>
          {openDropdown === 'genre' && (
            <div className="search-filter-panel search-filter-panel--genres">
              <ul className="search-filter-genre-list">
                {availableGenres.map(g => (
                  <li key={g}>
                    <label className="search-filter-genre-item">
                      <input
                        type="checkbox"
                        checked={genreFilters.includes(g)}
                        onChange={() => onToggleGenre(g)}
                      />
                      {g}
                    </label>
                  </li>
                ))}
              </ul>
              {(genreFilters.length > 0) && (
                <div className="search-filter-panel-actions">
                  <button type="button" className="search-filter-clear" onClick={onClearFilters}>
                    {i18n.filter_clear}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
