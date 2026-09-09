import React, { useEffect, useRef, useState } from 'react';
import type { LocalMediaItem } from '../hooks/useLocalMediaEntries';
import { IconFolder } from '../ui/icons';
import { getCachedCover, wrapAssetUrl } from '../../../lib/tauri';
import { toMediumCover } from '../../../lib/shared/small-cover';
import { isReadingType } from '../../../lib/constants/media';

interface LocalMediaCardProps {
  item:    LocalMediaItem;
  onClick: (item: LocalMediaItem) => void;
  // Pre-resolved by the parent's own useCoverCacheBatch call (one bulk
  // exists-check for the whole grid) — when present, this card already
  // knows its cover is cached and skips both the IntersectionObserver wait
  // and its own getCachedCover round trip entirely.
  cachedPath?: string;
}

export function LocalMediaCard({ item, onClick, cachedPath }: LocalMediaCardProps) {
  // Visual novels AND games both log progress as hours played (see
  // getProgressConfig in MediaEditorModal), not a discrete episode/chapter
  // count, so the badge needs its own unit here instead of falling into
  // either "Cap." or "Ep." — this card is also used for Videojuegos' own
  // library-only "Pendiente"/"En progreso" entries (see LocalLibrary), not
  // just the Visual Novel tab.
  const isHourBased = item.libraryEntry.type === 'vnovel' || item.libraryEntry.type === 'game';
  const unitLabel = isReadingType(item.libraryEntry.type) ? 'Cap.' : 'Ep.';
  const badgeLabel = item.status === 'planning'
    ? 'Pendiente'
    : isHourBased ? `${item.progress}h` : `${unitLabel} ${item.progress}`;

  // Catalog covers (AniList/TMDB/IGDB/Open Library) used to be re-fetched
  // straight from their remote CDN on every single load — this caches each
  // one to disk as webp the first time (see get_cached_cover, mirrors what
  // Videojuegos already does for matched Steam games), so later loads read
  // a local asset:// file instead of depending on that CDN's latency again.
  // Starts null (shows the placeholder) rather than the raw remote URL, to
  // avoid paying for the same download twice (once here, once in Rust).
  const [coverSrc, setCoverSrc] = useState<string | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  // Only cards actually near the viewport fire their own getCachedCover
  // call — a category grid with 100+ uncached items used to fire that many
  // concurrent IPC calls the instant it mounted. A card whose cover is
  // already known via the parent's batch prefetch (cachedPath) skips this
  // wait entirely, same as it skips the round trip itself below.
  const [inView, setInView] = useState(!!cachedPath);
  useEffect(() => {
    if (cachedPath || inView) return;
    const el = cardRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([e]) => { if (e.isIntersecting) { setInView(true); observer.disconnect(); } },
      { rootMargin: '300px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [cachedPath, inView]);

  useEffect(() => {
    if (cachedPath) { setCoverSrc(wrapAssetUrl(cachedPath)); return; }
    if (!item.cover || !inView) return;
    let cancelled = false;
    getCachedCover(item.externalId, toMediumCover(item.cover))
      .then(path => { if (!cancelled) setCoverSrc(wrapAssetUrl(path)); })
      .catch(() => { if (!cancelled) setCoverSrc(item.cover); });
    return () => { cancelled = true; };
  }, [item.cover, item.externalId, cachedPath, inView]);

  return (
    <div
      ref={cardRef}
      className="local-game-card"
      onClick={() => onClick(item)}
      role="button"
      tabIndex={0}
      onKeyDown={e => e.key === 'Enter' && onClick(item)}
    >
      <div className="local-game-cover">
        {coverSrc
          // No loading="lazy" here: the <img> itself doesn't exist in the DOM
          // at all until coverSrc resolves (see the effect above) — src is
          // always already known the moment this element is created, unlike
          // before this card started caching covers (a plain item.cover URL
          // present from the very first render). Native lazy-loading on top
          // of an already-deferred src assignment made the WebView (Chromium/
          // WebView2) sometimes never repaint the image at all after an F5
          // reload, until something else forced a reflow (moving the mouse).
          ? <img src={coverSrc} alt={item.title} decoding="async" onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
          : <div className="local-game-cover-placeholder"><IconFolder /></div>}
        <span className={`local-media-status-badge${item.status === 'planning' ? ' local-media-status-badge--planning' : ''}`}>
          {badgeLabel}
        </span>
      </div>
      <p className="local-game-name">{item.title}</p>
    </div>
  );
}
