import { useMemo, useState } from 'react';
import {
  collectCandidateFacets, filterLibraryCandidates, DEFAULT_CANDIDATE_FILTERS, STATUS_FILTERS,
  TIER_TEMPLATE_IDS, TIER_TEMPLATE_PARAMS, templateFilters,
  type LibraryCandidateFilters, type StatusFilter, type TierCandidate, type TierTemplateId,
} from '../../lib/tier/tier-candidates';
import { getGenreLabel, getTypeLabel } from '../../lib/media/media-types';
import { averageScoreSuffix, formatAverageScore, getActiveRatingSystem } from '../../lib/media/rating-utils';
import { CoverImage } from '../shared/CoverImage';
import type { Translations } from '../../i18n/types';
import type { TierLibraryData } from './hooks/useTierLibraryData';
import { tileCoverSrc } from './TierTile';

// "Library" and "Quick fill" tabs of the add-items dialog: both query the
// user's own library through lib/tier/tier-candidates.ts, excluding what is
// already on the board.

const MIN_RATINGS = [5, 6, 7, 8, 9] as const;
const PREVIEW_LIMIT = 48;

interface Props {
  data: TierLibraryData;
  exclude: ReadonlySet<string>;
  onAdd: (candidates: TierCandidate[]) => void;
  t: Translations['tier'];
  p: Translations['profile'];
}

function statusLabel(status: StatusFilter, t: Translations['tier'], p: Translations['profile']): string {
  switch (status) {
    case 'any': return t.filter_status_any;
    case 'in_progress': return t.filter_status_in_progress;
    case 'planning': return p.status_planning;
    case 'completed': return p.status_completed;
    case 'paused': return p.status_paused;
    case 'dropped': return p.status_dropped;
  }
}

export function TierLibraryPanel({ data, exclude, onAdd, t, p }: Props) {
  const [filters, setFilters] = useState<LibraryCandidateFilters>(DEFAULT_CANDIDATE_FILTERS);
  const facets = useMemo(() => collectCandidateFacets(data.entries, data.catalog), [data]);
  const matches = useMemo(
    () => filterLibraryCandidates(data.entries, data.catalog, filters, exclude, data.favoriteIds),
    [data, filters, exclude],
  );
  const system = getActiveRatingSystem();
  const set = (patch: Partial<LibraryCandidateFilters>) => setFilters(prev => ({ ...prev, ...patch }));
  const completedOnly = filters.status === 'completed';

  if (!data.loaded) return <p className="tier-filler-empty">{t.loading_library}</p>;

  return (
    <div className="tier-filler-panel">
      <div className="tier-filler-filters">
        <label className="tier-field">
          <span>{t.filter_type}</span>
          <select value={filters.type} onChange={e => set({ type: e.target.value })}>
            <option value="all">{t.filter_type_all}</option>
            {facets.types.map(type => <option key={type} value={type}>{getTypeLabel(type)}</option>)}
          </select>
        </label>
        <label className="tier-field">
          <span>{t.filter_status}</span>
          <select value={filters.status} onChange={e => set({ status: e.target.value as StatusFilter })}>
            {STATUS_FILTERS.map(status => <option key={status} value={status}>{statusLabel(status, t, p)}</option>)}
          </select>
        </label>
        <label className="tier-field">
          <span>{t.filter_year}</span>
          <select value={filters.year ?? ''} onChange={e => set({ year: e.target.value ? Number(e.target.value) : null })}>
            <option value="">{t.filter_year_any}</option>
            {facets.years.map(year => <option key={year} value={year}>{year}</option>)}
          </select>
        </label>
        <label className="tier-field">
          <span>{t.filter_genre}</span>
          <select value={filters.genre ?? ''} onChange={e => set({ genre: e.target.value || null })}>
            <option value="">{t.filter_genre_any}</option>
            {facets.genres.map(genre => <option key={genre} value={genre}>{getGenreLabel(genre)}</option>)}
          </select>
        </label>
        <label className="tier-field">
          <span>{t.filter_min_rating}</span>
          <select value={filters.minRating ?? ''} onChange={e => set({ minRating: e.target.value ? Number(e.target.value) : null })}>
            <option value="">{t.filter_rating_any}</option>
            {MIN_RATINGS.map(r => <option key={r} value={r}>≥ {formatAverageScore(r, system)}{averageScoreSuffix(system)}</option>)}
          </select>
        </label>
        <label className="tier-check">
          <input type="checkbox" checked={completedOnly} onChange={e => set({ status: e.target.checked ? 'completed' : 'any' })} />
          <span>{t.filter_completed_only}</span>
        </label>
        <label className="tier-check">
          <input type="checkbox" checked={filters.favoritesOnly} onChange={e => set({ favoritesOnly: e.target.checked })} />
          <span>{t.filter_favorites}</span>
        </label>
      </div>

      <div className="tier-filler-summary">
        <span>{t.matches.replace('{count}', String(matches.length))}</span>
        <button type="button" className="tier-btn tier-btn--primary" disabled={matches.length === 0} onClick={() => onAdd(matches)}>
          {t.add_matches.replace('{count}', String(matches.length))}
        </button>
      </div>
      <CandidatePreview candidates={matches} />
    </div>
  );
}

export function CandidatePreview({ candidates }: { candidates: ReadonlyArray<Pick<TierCandidate, 'id' | 'title' | 'cover'>> }) {
  return (
    <ul className="tier-filler-preview" aria-hidden="true">
      {candidates.slice(0, PREVIEW_LIMIT).map(c => (
        <li key={c.id} className="tier-filler-preview-item" title={c.title ?? c.id}>
          {c.cover
            ? <CoverImage externalId={c.id} src={tileCoverSrc(c.cover, 'small')} alt="" className="cover-image-fill" loading="lazy" />
            : <span className="tier-tile-fallback">{(c.title ?? c.id).slice(0, 2).toUpperCase()}</span>}
        </li>
      ))}
    </ul>
  );
}

export function TierTemplatesPanel({ data, exclude, onAdd, t }: Omit<Props, 'p'>) {
  const currentYear = new Date().getFullYear();
  const facets = useMemo(() => collectCandidateFacets(data.entries, data.catalog), [data]);
  const years = useMemo(() => {
    const all = new Set<number>([...facets.years]);
    for (let y = currentYear; y > currentYear - 5; y--) all.add(y);
    return [...all].sort((a, b) => b - a);
  }, [facets.years, currentYear]);
  const [params, setParams] = useState<Record<TierTemplateId, { type: string; year: number }>>(() => Object.fromEntries(
    TIER_TEMPLATE_IDS.map(id => [id, { type: 'all', year: currentYear - 1 }]),
  ) as Record<TierTemplateId, { type: string; year: number }>);

  if (!data.loaded) return <p className="tier-filler-empty">{t.loading_library}</p>;

  const labels: Record<TierTemplateId, string> = {
    completed_of_year: t.template_completed_of_year,
    finished_in_year: t.template_finished_in_year,
    top_rated: t.template_top_rated,
    favorites: t.template_favorites,
  };

  return (
    <ul className="tier-templates">
      {TIER_TEMPLATE_IDS.map(id => {
        const shape = TIER_TEMPLATE_PARAMS[id];
        const value = params[id];
        const matches = filterLibraryCandidates(data.entries, data.catalog, templateFilters(id, value), exclude, data.favoriteIds);
        const update = (patch: Partial<{ type: string; year: number }>) => setParams(prev => ({ ...prev, [id]: { ...prev[id], ...patch } }));
        return (
          <li key={id} className="tier-template">
            <span className="tier-template-label">{labels[id]}</span>
            <div className="tier-template-params">
              {shape.type && (
                <select aria-label={t.filter_type} value={value.type} onChange={e => update({ type: e.target.value })}>
                  <option value="all">{t.filter_type_all}</option>
                  {facets.types.map(type => <option key={type} value={type}>{getTypeLabel(type)}</option>)}
                </select>
              )}
              {shape.year && (
                <select aria-label={t.template_year} value={value.year} onChange={e => update({ year: Number(e.target.value) })}>
                  {years.map(year => <option key={year} value={year}>{year}</option>)}
                </select>
              )}
            </div>
            <span className="tier-template-count">{t.matches.replace('{count}', String(matches.length))}</span>
            <button type="button" className="tier-btn tier-btn--primary" disabled={matches.length === 0} onClick={() => onAdd(matches)}>
              {t.template_apply}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
