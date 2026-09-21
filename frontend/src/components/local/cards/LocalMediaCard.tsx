import React, { useEffect, useRef, useState } from 'react';
import type { LocalMediaItem } from '../hooks/useLocalMediaEntries';
import { IconFolder } from '../ui/icons';
import { getCachedCover, wrapAssetUrl, type LocalGame } from '../../../lib/tauri';
import { toMediumCover } from '../../../lib/shared/small-cover';
import { isReadingType } from '../../../lib/constants/media';
import { MediaCardShell } from './MediaCardShell';

interface LocalMediaCardProps {
  item:    LocalMediaItem;
  onClick: (item: LocalMediaItem) => void;
  // Pre-resolved by the parent's own useCoverCacheBatch call (one bulk
  // exists-check for the whole grid) — when present, this card already
  // knows its cover is cached and skips both the IntersectionObserver wait
  // and its own getCachedCover round trip entirely.
  cachedPath?: string;
  // Right-click "Eliminar de la lista" — only wired by callers that track
  // library items this way (Videojuegos' Pendientes/En progreso, Visual
  // Novel), never by e.g. anime/manga grids reusing this same card. Deletes
  // the underlying library entry itself (see deleteLibraryEntry), unlike
  // GameCard's own onRequestDelete which hides a scanned install instead.
  onRequestDelete?: (item: LocalMediaItem, x: number, y: number) => void;
  // Set only for a season/update/episode-style catalog entry matched to a
  // real install (see buildLibraryStatusEntries/sourceCatalogOf) — no
  // launcher tracks a season's playtime separately from its base game, so
  // item.progress for one of these just sits at whatever was last logged
  // by hand (usually 0, nothing ever auto-tracks against it). The hours
  // badge below reads this instead when present, mirroring
  // GameDetailPanel's own stats row for that exact same season
  // (launchTarget.playtime_minutes there resolves through this same
  // matched game) — showing the real, live played time instead of a
  // stuck-at-zero number that silently disagreed with the panel/editor.
  launchGame?: LocalGame;
}

export function LocalMediaCard({ item, onClick, cachedPath, onRequestDelete, launchGame }: LocalMediaCardProps) {
  // AniList works use their catalog URL directly in Local; only other
  // catalog media types need the app's disk cover cache.
  const usesCatalogCoverDirectly = ['anime', 'manga', 'lnovel'].includes(item.libraryEntry.type);
  const usableCachedPath = usesCatalogCoverDirectly ? undefined : cachedPath;
  // Visual novels AND games both log progress as hours played (see
  // getProgressConfig in MediaEditorModal), not a discrete episode/chapter
  // count, so the badge needs its own unit here instead of falling into
  // either "Cap." or "Ep." — this card is also used for Videojuegos' own
  // library-only "Pendiente"/"En progreso" entries (see LocalLibrary), not
  // just the Visual Novel tab.
  const isHourBased = item.libraryEntry.type === 'vnovel' || item.libraryEntry.type === 'game';
  const unitLabel = isReadingType(item.libraryEntry.type) ? 'Cap.' : 'Ep.';
  const effectiveHours = launchGame?.playtime_minutes ? Math.round(launchGame.playtime_minutes / 6) / 10 : item.progress;
  const badgeLabel = item.status === 'planning'
    ? 'Pendiente'
    : isHourBased ? `${effectiveHours}h` : `${unitLabel} ${item.progress}`;

  // Most catalog covers are cached to disk as webp on first load. Anime,
  // manga and light novels intentionally bypass this cache and use the
  // medium-sized URL stored in media_catalog directly.
  // Starts null (shows the placeholder) rather than the raw remote URL, to
  // avoid paying for the same download twice (once here, once in Rust).
  const [coverSrc, setCoverSrc] = useState<string | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  // Only cards actually near the viewport fire their own getCachedCover
  // call — a category grid with 100+ uncached items used to fire that many
  // concurrent IPC calls the instant it mounted. A card whose cover is
  // already known via the parent's batch prefetch (cachedPath) skips this
  // wait entirely, same as it skips the round trip itself below.
  const [inView, setInView] = useState(!!usableCachedPath);
  useEffect(() => {
    if (usableCachedPath || inView) return;
    const el = cardRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([e]) => { if (e.isIntersecting) { setInView(true); observer.disconnect(); } },
      { rootMargin: '300px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [usableCachedPath, inView]);

  useEffect(() => {
    if (usesCatalogCoverDirectly) {
      setCoverSrc(item.cover && inView ? toMediumCover(item.cover) : null);
      return;
    }
    if (usableCachedPath) { setCoverSrc(wrapAssetUrl(usableCachedPath)); return; }
    if (!item.cover || !inView) return;
    let cancelled = false;
    getCachedCover(item.externalId, toMediumCover(item.cover))
      .then(path => { if (!cancelled) setCoverSrc(wrapAssetUrl(path)); })
      .catch(() => { if (!cancelled) setCoverSrc(item.cover); });
    return () => { cancelled = true; };
  }, [item.cover, item.externalId, usesCatalogCoverDirectly, usableCachedPath, inView]);

  return (
    <MediaCardShell
      ref={cardRef}
      title={item.title}
      cover={coverSrc}
      placeholderIcon={<IconFolder />}
      badge={
        <span className={`local-media-status-badge${item.status === 'planning' ? ' local-media-status-badge--planning' : ''}`}>
          {badgeLabel}
        </span>
      }
      onClick={() => onClick(item)}
      onContextMenu={onRequestDelete ? e => {
        e.preventDefault();
        onRequestDelete(item, e.pageX, e.pageY);
      } : undefined}
    />
  );
}
