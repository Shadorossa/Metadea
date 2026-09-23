import { useEffect, useMemo, useState, memo } from 'react';
import { wrapAssetUrl, type CatalogSummary, type LibraryEntry } from '../../lib/tauri';
import { getT } from '../../i18n/runtime';
import { getActiveRatingSystem, formatRatingHtml } from '../../lib/media/rating-utils';
import { typeIconMap } from '../../lib/dom/icon-strings';
import { HOF_GRADIENTS } from '../../lib/profile/hof';
import { getCachedLibraryAndCatalog } from '../../lib/profile/library-data-cache';
import { syncActiveRatingSystemFromCachedInfo } from '../../lib/profile/user-info';
import { filterCoverCacheCandidates } from '../../lib/profile/cover-cache';
import { useCoverCacheBatch } from '../local/hooks/useCoverCacheBatch';
import { beginGlobalLoading } from '../../lib/dom/global-loading';
import { getTypeLabel } from '../../lib/media/media-types';
import { toMediumCover } from '../../lib/media/small-cover';

type SortMode = 'date' | 'rating';

interface Props {
  // Someone else's profile (UserProfileView) already has the mapped
  // library + the viewer's own catalogMap in hand — passing them in skips
  // this component's own local-only fetch entirely, and readOnly is a no-op
  // here since this tab has no edit affordances to hide in the first place.
  overrideItems?: LibraryEntry[];
  overrideCatalogMap?: Map<string, CatalogSummary>;
}

interface ReviewCardProps {
  item: LibraryEntry;
  catalogMap: Map<string, CatalogSummary>;
  ratingSystem: ReturnType<typeof getActiveRatingSystem>;
  typeIcon: Record<string, string>;
  /** Disk-cached cover (see ReviewsSection's useCoverCacheBatch) — painted
   *  instead of the remote cover_url when set. */
  cachedPath?: string;
}

const MemoizedReviewCard = memo(function ReviewCard({ item, catalogMap, ratingSystem, typeIcon, cachedPath }: ReviewCardProps) {
  const meta = catalogMap.get(item.external_id);
  const title = meta?.title_main ?? item.external_id;
  // 44x62px thumbnail — the medium provider size is already far larger
  // than that, no need to pull the full-size asset.
  const cover = cachedPath ? wrapAssetUrl(cachedPath) : toMediumCover(meta?.cover_url ?? '');
  const fallback = HOF_GRADIENTS[item.type] ?? 'linear-gradient(160deg,#374151,#1f2937)';
  const date = (item.updated_at ?? item.added_at ?? '').slice(0, 10);
  const ratingHtml = item.rating
    ? formatRatingHtml(item.rating, ratingSystem, 'review-card-rating')
    : `<span style="color:var(--text-dim)">—</span>`;
  const url = `/media?id=${encodeURIComponent(item.external_id)}`;

  return (
    <article className="review-card" key={item.external_id}>
      <div className="review-card-top">
        <a className="review-card-cover-link" href={url}>
          {cover ? (
            <img className="review-card-cover" src={cover} alt={title} loading="lazy" decoding="async" />
          ) : (
            <div className="review-card-cover review-card-cover--fallback" style={{ background: fallback }}>
              <span>{title.slice(0, 2).toUpperCase()}</span>
            </div>
          )}
        </a>
        <div className="review-card-headinfo">
          <a href={url} className="review-card-title">{title}</a>
          <div className="review-card-meta">
            <span className="review-card-type">
              <span dangerouslySetInnerHTML={{ __html: typeIcon[item.type] ?? '' }} /> {getTypeLabel(item.type)}
            </span>
            <span className="review-card-rating" dangerouslySetInnerHTML={{ __html: ratingHtml }} />
            {date && <time className="review-card-date">{date}</time>}
          </div>
        </div>
      </div>
      <p className="review-card-note">{item.notes}</p>
    </article>
  );
});

export function ReviewsSection({ overrideItems, overrideCatalogMap }: Props = {}) {
  const t = getT();
  const p = t.profile;
  const TYPE_ICON = useMemo(() => typeIconMap(14), []);

  const [reviewed, setReviewed] = useState<LibraryEntry[]>(
    overrideItems ? overrideItems.filter(item => item.notes && item.notes.trim().length > 0) : []
  );
  const [catalogMap, setCatalogMap] = useState<Map<string, CatalogSummary>>(overrideCatalogMap ?? new Map());
  const [sortMode, setSortMode] = useState<SortMode>('date');
  const [filterType, setFilterType] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  // No blocking "Cargando..." placeholder — renders immediately (empty at
  // first, or already filled from cache) while the global bottom loading
  // bar (BaseLayout.astro) shows the fetch is in flight.
  useEffect(() => {
    if (overrideItems) return;
    let cancelled = false;
    const endLoading = beginGlobalLoading();
    (async () => {
      try {
        const { items, catalog: catalogEntries } = await getCachedLibraryAndCatalog();
        // Refreshes the localStorage cache read by getActiveRatingSystem() below.
        await syncActiveRatingSystemFromCachedInfo();
        if (cancelled) return;

        setCatalogMap(new Map(catalogEntries.map(e => [e.external_id, e])));
        setReviewed(items.filter(item => item.notes && item.notes.trim().length > 0));
      } finally {
        endLoading();
      }
    })();
    return () => { cancelled = true; };
  }, [overrideItems]);

  const types = useMemo(() => [...new Set(reviewed.map(i => i.type))], [reviewed]);

  // Covers Local already cached to disk, in one exists-only IPC call — see
  // LibrarySection for the same pattern.
  const coverCacheIds = useMemo(() => filterCoverCacheCandidates(reviewed.map(i => i.external_id)), [reviewed]);
  const coverCacheHits = useCoverCacheBatch(coverCacheIds);

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

  if (reviewed.length === 0) {
    return (
      <div className="profile-empty">
        <span className="profile-empty-icon">✍️</span>
        <p>{p.reviews_empty}</p>
      </div>
    );
  }

  const reviewsCountText = filtered.length === 1
    ? p.reviews_count_singular.replace('{count}', String(filtered.length))
    : p.reviews_count_plural.replace('{count}', String(filtered.length));

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
          {filtered.map(item => (
            <MemoizedReviewCard
              key={item.external_id}
              item={item}
              catalogMap={catalogMap}
              ratingSystem={system}
              typeIcon={TYPE_ICON}
              cachedPath={coverCacheHits[item.external_id]}
            />
          ))}
        </div>
      ) : (
        <div className="profile-empty" style={{ padding: '2rem 0' }}><p>{t.search.no_results_generic}</p></div>
      )}
    </div>
  );
}
