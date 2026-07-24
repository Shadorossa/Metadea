import { useEffect, useMemo, useState } from 'react';
import type { MediaCatalogEntry, LibraryEntry } from '../../lib/tauri';
import { getT } from '../../i18n/client';
import { getActiveRatingSystem, syncActiveRatingSystem, formatRatingHtml } from '../../lib/media/rating-utils';
import { typeIconMap } from '../../lib/shared/icon-strings';
import { HOF_GRADIENTS } from '../../lib/profile/hof';
import { getCachedLibraryAndCatalog } from '../../lib/profile/library-data-cache';
import { getTypeLabel } from '../../lib/constants/media';

type SortMode = 'date' | 'rating';

export function ReviewsSection() {
  const t = getT();
  const p = t.profile;
  const TYPE_ICON = useMemo(() => typeIconMap(14), []);

  const [loading, setLoading] = useState(true);
  const [reviewed, setReviewed] = useState<LibraryEntry[]>([]);
  const [catalogMap, setCatalogMap] = useState<Map<string, MediaCatalogEntry>>(new Map());
  const [sortMode, setSortMode] = useState<SortMode>('date');
  const [filterType, setFilterType] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { items, catalog: catalogEntries } = await getCachedLibraryAndCatalog();
      // Refreshes the localStorage cache read by getActiveRatingSystem() below.
      await syncActiveRatingSystem();
      if (cancelled) return;

      setCatalogMap(new Map(catalogEntries.map(e => [e.external_id, e])));
      setReviewed(items.filter(item => item.notes && item.notes.trim().length > 0));
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  const types = useMemo(() => [...new Set(reviewed.map(i => i.type))], [reviewed]);

  const filtered = useMemo(() => {
    let res = reviewed;
    if (filterType) res = res.filter(i => i.type === filterType);
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      res = res.filter(i => {
        const meta = catalogMap.get(i.external_id);
        const title = meta?.title_main ?? i.external_id;
        return title.toLowerCase().includes(q) || (i.notes ?? '').toLowerCase().includes(q);
      });
    }

    if (sortMode === 'rating') {
      res = [...res].sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));
    } else {
      res = [...res].sort((a, b) => {
        const da = a.updated_at ?? a.added_at ?? '';
        const db = b.updated_at ?? b.added_at ?? '';
        return db.localeCompare(da);
      });
    }
    return res;
  }, [reviewed, filterType, searchQuery, sortMode, catalogMap]);

  const system = getActiveRatingSystem();

  if (loading) {
    return <div className="profile-empty"><p>{p.stats_loading}</p></div>;
  }

  if (reviewed.length === 0) {
    return (
      <div className="profile-empty">
        <span className="profile-empty-icon">✍️</span>
        <p>{p.reviews_empty}</p>
      </div>
    );
  }

  const reviewsCountText = filtered.length === 1
    ? (p.reviews_count_singular || '{count} reseña').replace('{count}', String(filtered.length))
    : (p.reviews_count_plural || '{count} reseñas').replace('{count}', String(filtered.length));

  return (
    <div className="reviews-layout">
      <div className="reviews-toolbar">
        <input
          type="text"
          className="reviews-search"
          placeholder={p.reviews_search}
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
        />
        <div className="reviews-type-filters">
          <button
            type="button"
            className={`reviews-type-btn ${!filterType ? 'active' : ''}`}
            onClick={() => setFilterType('')}
          >
            <span>{p.section_all}</span>
          </button>
          {types.map(tp => (
            <button
              key={tp}
              type="button"
              className={`reviews-type-btn ${filterType === tp ? 'active' : ''}`}
              onClick={() => setFilterType(tp)}
            >
              <span dangerouslySetInnerHTML={{ __html: TYPE_ICON[tp] ?? TYPE_ICON['book'] }} />
              <span>{getTypeLabel(tp)}</span>
            </button>
          ))}
        </div>
        <div className="reviews-sort">
          <button
            type="button"
            className={`reviews-sort-btn ${sortMode === 'date' ? 'active' : ''}`}
            onClick={() => setSortMode('date')}
          >
            {p.reviews_sort_date}
          </button>
          <button
            type="button"
            className={`reviews-sort-btn ${sortMode === 'rating' ? 'active' : ''}`}
            onClick={() => setSortMode('rating')}
          >
            {p.reviews_sort_rating}
          </button>
        </div>
      </div>
      <p className="reviews-count">{reviewsCountText}</p>
      {filtered.length > 0 ? (
        <div className="reviews-list">
          {filtered.map(item => {
            const meta  = catalogMap.get(item.external_id);
            const title = meta?.title_main ?? item.external_id;
            const cover = meta?.cover_url ?? '';
            const fallback = HOF_GRADIENTS[item.type] ?? 'linear-gradient(160deg,#374151,#1f2937)';
            const date  = (item.updated_at ?? item.added_at ?? '').slice(0, 10);
            const ratingHtml = item.rating
              ? formatRatingHtml(item.rating, system, 'review-card-rating')
              : `<span style="color:var(--text-dim)">—</span>`;
            const url = `/media?id=${encodeURIComponent(item.external_id)}`;

            return (
              <article className="review-card" key={item.external_id}>
                <a className="review-card-cover-link" href={url}>
                  {cover ? (
                    <img className="review-card-cover" src={cover} alt={title} loading="lazy" />
                  ) : (
                    <div className="review-card-cover review-card-cover--fallback" style={{ background: fallback }}>
                      <span>{title.slice(0, 2).toUpperCase()}</span>
                    </div>
                  )}
                </a>
                <div className="review-card-body">
                  <div className="review-card-header">
                    <a href={url} className="review-card-title">{title}</a>
                    <div className="review-card-meta">
                      <span className="review-card-type">
                        <span dangerouslySetInnerHTML={{ __html: TYPE_ICON[item.type] ?? '' }} /> {getTypeLabel(item.type)}
                      </span>
                      <span className="review-card-rating" dangerouslySetInnerHTML={{ __html: ratingHtml }} />
                      {date && <time className="review-card-date">{date}</time>}
                    </div>
                  </div>
                  <p className="review-card-note">{item.notes}</p>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="profile-empty" style={{ padding: '2rem 0' }}><p>{t.media.no_results}</p></div>
      )}
    </div>
  );
}
