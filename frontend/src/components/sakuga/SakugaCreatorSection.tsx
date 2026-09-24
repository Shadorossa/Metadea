// "Sakuga" on a creator page, full width below Biography and Works:
// every clip of the animator on Sakugabooru, most voted first, one row at a
// time. A page is exactly the clips that fit in that row, fetched on demand;
// "‹ Page X of Y ›" below, ←/→ on the focused row and horizontal wheel also
// page. Series tabs (a select past six series) narrow it down.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type WheelEvent } from 'react';
import { getSakugaRelatedSeries, resolveSakugaArtist, type SakugaPost, type SakugaTag } from '../../lib/tauri/sakuga';
import {
  humanizeSakugaTag,
  sakugaPostSeries,
  sakugaRowColumns,
  sakugaRowPage,
  sakugaRowPageCount,
  sakugaSeriesChips,
  sakugaTagUrl,
} from '../../lib/sakuga/sakuga-paging';
import { interpolate } from '../../lib/shared/text/interpolate';
import { openLink } from '../media/MediaStoreLinks';
import { PrevNextPagination } from '../shared/PrevNextPagination';
import { SakugaClipCard, type SakugaStrings } from './SakugaClipCard';
import { SakugaClipSkeleton } from './SakugaClipList';
import { SakugaLightbox } from './SakugaLightbox';
import { useSakugaPage } from './hooks/useSakugaPage';

/** More series than this (or a column too narrow for two clips) switch
 *  the filter from tabs to a select, so the tabs never pass two lines. */
const MAX_SERIES_TABS = 6;
/** Minimum time between two wheel-driven page turns. */
const WHEEL_PAGE_MS = 450;

interface Props {
  staffId: string;
  /** Primary name first, then alternative spellings. */
  names: string[];
  t: SakugaStrings;
  /** The works pagination's strings ("Previous", "Next", "Page {page} of {total}"). */
  pagination: { prev: string; next: string; page: string };
}

export function SakugaCreatorSection({ staffId, names, t, pagination }: Props) {
  const namesKey = [staffId, ...names].join('\n');
  const [artistResult, setArtistResult] = useState<{ key: string; tag: SakugaTag | null }>({ key: '', tag: null });
  const [seriesResult, setSeriesResult] = useState<{ tag: string; related: SakugaTag[] }>({ tag: '', related: [] });
  const [selected, setSelected] = useState<string | null>(null);
  /** Index of the first clip shown: survives column-count changes. */
  const [offset, setOffset] = useState(0);
  const [columns, setColumns] = useState(0);
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const pendingOpen = useRef<'first' | 'last' | null>(null);
  const lastWheel = useRef(0);
  const rowRef = useRef<HTMLDivElement | null>(null);

  const artist = artistResult.key === namesKey ? artistResult.tag : null;
  const related = useMemo(() => (artist && seriesResult.tag === artist.name ? seriesResult.related : []), [artist, seriesResult]);
  const series = useMemo(() => sakugaSeriesChips(related), [related]);
  const relatedNames = useMemo(() => related.map(tag => tag.name), [related]);
  const seriesOf = useCallback((post: SakugaPost) => sakugaPostSeries(post.tags, relatedNames), [relatedNames]);

  useEffect(() => {
    let cancelled = false;
    const [id, ...allNames] = namesKey.split('\n');
    void resolveSakugaArtist(id, allNames.filter(Boolean)).then(tag => {
      if (!cancelled) setArtistResult({ key: namesKey, tag });
    });
    return () => { cancelled = true; };
  }, [namesKey]);

  const artistName = artist?.name ?? '';
  useEffect(() => {
    if (!artistName) return;
    let cancelled = false;
    void getSakugaRelatedSeries(artistName).then(found => {
      if (!cancelled) setSeriesResult({ tag: artistName, related: found });
    });
    return () => { cancelled = true; };
  }, [artistName]);

  // Page size = the cards that fit in the row, re-measured on resize.
  useLayoutEffect(() => {
    const row = rowRef.current;
    if (!row) return;
    const measure = () => setColumns(sakugaRowColumns(row.clientWidth));
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(row);
    return () => observer.disconnect();
  }, [artistName]);

  const tags = useMemo(() => {
    if (!artist) return null;
    return selected ? [artist.name, selected] : [artist.name];
  }, [artist, selected]);
  const page = sakugaRowPage(offset, columns);
  const view = useSakugaPage(tags, page, columns);
  const total = view.data?.total ?? view.last?.total ?? null;
  const pageCount = sakugaRowPageCount(total, columns);
  const posts = view.data?.posts ?? [];
  const lightboxPosts = view.data?.posts ?? view.last?.posts ?? [];

  const goToPage = useCallback((next: number) => {
    if (next < 1 || next > pageCount) return;
    setOffset((next - 1) * Math.max(1, columns));
  }, [pageCount, columns]);

  // The lightbox stepped past an edge: open the new page's first/last clip.
  useEffect(() => {
    if (!pendingOpen.current || view.loading || !view.data) return;
    const count = view.data.posts.length;
    setOpenIndex(count === 0 ? null : pendingOpen.current === 'first' ? 0 : count - 1);
    pendingOpen.current = null;
  }, [view.loading, view.data]);

  if (!artist) return null;
  if (!selected && view.data && view.data.total === 0) return null;
  const moreUrl = sakugaTagUrl(artist.name);

  const onRowKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    if (event.key === 'ArrowLeft') { event.preventDefault(); goToPage(page - 1); }
    if (event.key === 'ArrowRight') { event.preventDefault(); goToPage(page + 1); }
  };
  const onRowWheel = (event: WheelEvent<HTMLDivElement>) => {
    if (Math.abs(event.deltaX) <= Math.abs(event.deltaY) || Math.abs(event.deltaX) < 20) return;
    const now = Date.now();
    if (now - lastWheel.current < WHEEL_PAGE_MS) return;
    lastWheel.current = now;
    goToPage(page + (event.deltaX > 0 ? 1 : -1));
  };
  const selectSeries = (tag: string | null) => { setSelected(tag); setOffset(0); };

  return (
    <section className="sakuga-creator" id="author-sakuga-section">
      <div className="media-section-header-row sakuga-creator__header">
        <p className="section-label">{t.section_title}</p>
        <div className="media-section-header-line" />
        <a
          className="sakuga-creator__meta"
          href={moreUrl}
          title={t.more_on_site}
          onClick={event => { event.preventDefault(); openLink(moreUrl); }}
        >
          {total !== null && `${interpolate(total === 1 ? t.clip_count_one : t.clip_count_other, { n: total })} · `}
          {t.site_name} ↗
        </a>
      </div>
      {series.length > 1 && (
        series.length <= MAX_SERIES_TABS && columns >= 2 ? (
          <div className="sakuga-series-tabs" role="group" aria-label={t.section_title}>
            <button type="button" className={`section-label section-label--tab sakuga-series-tab${selected === null ? ' active' : ''}`} aria-pressed={selected === null} onClick={() => selectSeries(null)}>
              {t.all_series}
            </button>
            {series.map(tag => (
              <button
                key={tag.name}
                type="button"
                className={`section-label section-label--tab sakuga-series-tab${selected === tag.name ? ' active' : ''}`}
                aria-pressed={selected === tag.name}
                onClick={() => selectSeries(tag.name)}
              >
                {humanizeSakugaTag(tag.name)} <span className="sakuga-series-tab__count">{tag.count}</span>
              </button>
            ))}
          </div>
        ) : (
          <select
            className="input-dark sakuga-series-select"
            aria-label={t.section_title}
            value={selected ?? ''}
            onChange={event => selectSeries(event.target.value || null)}
          >
            <option value="">{t.all_series}</option>
            {series.map(tag => <option key={tag.name} value={tag.name}>{humanizeSakugaTag(tag.name)} ({tag.count})</option>)}
          </select>
        )
      )}
      <div
        ref={rowRef}
        className="sakuga-list sakuga-row-page"
        style={{ gridTemplateColumns: `repeat(${Math.max(1, columns)}, minmax(0, 1fr))` }}
        tabIndex={0}
        aria-label={interpolate(pagination.page, { page, total: pageCount })}
        aria-busy={view.loading}
        onKeyDown={onRowKeyDown}
        onWheel={onRowWheel}
      >
        {view.loading || columns === 0
          ? Array.from({ length: Math.max(1, columns) }, (_, i) => <SakugaClipSkeleton key={i} label={i === 0 ? t.loading : undefined} />)
          : posts.map((post, i) => (
            <SakugaClipCard key={post.id} post={post} t={t} seriesLabel={selected ? null : seriesOf(post)} onOpen={() => setOpenIndex(i)} />
          ))}
      </div>
      <PrevNextPagination page={page} totalPages={pageCount} onChange={goToPage} strings={pagination} compact />
      {openIndex !== null && lightboxPosts[openIndex] && (
        <SakugaLightbox
          posts={lightboxPosts}
          index={openIndex}
          onIndexChange={setOpenIndex}
          onClose={() => { pendingOpen.current = null; setOpenIndex(null); }}
          hasMore={false}
          loadMore={() => Promise.resolve()}
          pageEdges={{
            hasBefore: page > 1,
            hasAfter: page < pageCount,
            onPastEnd: direction => {
              pendingOpen.current = direction > 0 ? 'first' : 'last';
              goToPage(page + direction);
            },
          }}
          t={t}
        />
      )}
    </section>
  );
}
