import { useEffect, useRef, useState } from 'react';
import type { SakugaPost } from '../../lib/tauri/sakuga';
import { SakugaClipCard, type SakugaStrings } from './SakugaClipCard';
import { SakugaLightbox } from './SakugaLightbox';
import type { SakugaPager } from './hooks/useSakugaPager';

/** Placeholders while the first page loads, so the block doesn't jump. */
const SKELETON_COUNT = { strip: 4, grid: 8 } as const;

/** A card-sized placeholder (same box as a clip card). */
export function SakugaClipSkeleton({ label }: { label?: string }) {
  return (
    <span className="sakuga-clip sakuga-clip--skeleton" role={label ? 'status' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <span className="sakuga-clip__media" />
      <span className="sakuga-clip__footer"><span className="sakuga-clip__caption" /></span>
    </span>
  );
}

interface Props {
  pager: SakugaPager;
  t: SakugaStrings;
  /** strip: one horizontally scrolling row; grid: wrapping, page scroll. */
  layout: 'strip' | 'grid';
  /** Series label per clip, for lists spanning several series. */
  seriesOf?: (post: SakugaPost) => string | null;
  /** Extra classes for the list (the creator page reuses the works grid). */
  className?: string;
}

/** A vote-ordered list of clips that loads its next page when its end
 *  scrolls into view, and opens the lightbox over all loaded clips. */
export function SakugaClipList({ pager, t, layout, seriesOf, className }: Props) {
  const { state, loading, loadMore } = pager;
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const sentinelRef = useRef<HTMLSpanElement | null>(null);
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  // A fresh observer after every page: its first report reflects the new
  // layout, so a sentinel still near the edge keeps loading and one pushed
  // away by the new cards stops (a stale "visible" can't chain requests).
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || state.done || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) void loadMore();
    }, {
      root: layout === 'strip' ? scrollerRef.current : null,
      rootMargin: layout === 'strip' ? '0px 400px 0px 0px' : '400px',
    });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [state.fetched, state.done, loadMore, layout]);

  return (
    <>
      <div ref={scrollerRef} className={`sakuga-list sakuga-list--${layout}${className ? ` ${className}` : ''}`}>
        {state.posts.map((post, i) => (
          <SakugaClipCard key={post.id} post={post} t={t} seriesLabel={seriesOf?.(post)} onOpen={() => setOpenIndex(i)} />
        ))}
        {loading && Array.from({ length: state.posts.length === 0 ? SKELETON_COUNT[layout] : 1 }, (_, i) => (
          <SakugaClipSkeleton key={`skeleton-${i}`} label={i === 0 ? t.loading : undefined} />
        ))}
        {!state.done && <span ref={sentinelRef} className="sakuga-list__sentinel" aria-hidden="true" />}
      </div>
      {openIndex !== null && state.posts[openIndex] && (
        <SakugaLightbox
          posts={state.posts}
          index={openIndex}
          onIndexChange={setOpenIndex}
          onClose={() => setOpenIndex(null)}
          hasMore={!state.done}
          loadMore={loadMore}
          t={t}
        />
      )}
    </>
  );
}
