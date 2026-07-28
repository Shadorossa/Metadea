// Split out of LibrarySection.tsx: a single library grid cell, plus its private emoji-tag helper.
import { useEffect, useRef, useState } from 'react';
import type { MediaCatalogEntry, LibraryEntry } from '../../lib/tauri';
import { getT } from '../../i18n/client';
import { getActiveRatingSystem, formatRatingHtml } from '../../lib/media/rating-utils';
import { getRating2System, getRating2Max, type RatingSlot } from '../../lib/settings/preferences';
import { typeIconMap, CALENDAR_ICON } from '../../lib/shared/icon-strings';
import { formatDateNumeric } from '../../lib/shared/formatDate';
import { averageRating } from './library-grouping';
import { toSmallCover } from '../../lib/shared/small-cover';

export const TYPE_ICON = typeIconMap(16);

// Leading emoji + optional variation selector, e.g. "🎨Arte" → "🎨" / "Arte". Plain-text tags are skipped.
const TAG_EMOJI_RE = /^(\p{Extended_Pictographic}️?)(.*)$/u;

function tagBadges(tags: string[] | null | undefined): { emoji: string; label: string }[] {
  if (!tags || tags.length === 0) return [];
  return tags
    .map(tag => {
      const match = TAG_EMOJI_RE.exec(tag.trim());
      if (!match) return null;
      const [, emoji, name] = match;
      return { emoji, label: name.trim() || tag.trim() };
    })
    .filter((t): t is { emoji: string; label: string } => t !== null);
}

export function LibraryCard({ item, grouped, bundleMeta, titleOverride, aggregateStats, catalogMap, p, readOnly, ratingSlot = 'rating' }: {
  item: LibraryEntry;
  grouped: LibraryEntry[];
  bundleMeta?: MediaCatalogEntry;
  /** Saga's assigned name, shown instead of the earliest work's title. */
  titleOverride?: string;
  /** Saga-chain merge (see refineSagaGroups) — aggregate stats without swapping the cover. */
  aggregateStats?: boolean;
  catalogMap: Map<string, MediaCatalogEntry>;
  p: ReturnType<typeof getT>['profile'];
  /** Someone else's profile (LibrarySection, fed via UserProfileView) — `item` is a synthesized
   * LibraryEntry that doesn't really exist in the viewer's own library, so
   * clicking must never open the local editor pre-filled with their data
   * (a stray save would write it into the viewer's own library under this
   * external_id). Goes straight to the media page instead, same as a bundle. */
  readOnly?: boolean;
  /** Settings > Preferencias' opt-in "doble calificación" selector, forwarded from
   * LibrarySection — which field the badge shows and which one the editor opens on. */
  ratingSlot?: RatingSlot;
}) {
  const meta = catalogMap.get(item.external_id);
  const isAggregate = !!bundleMeta || !!aggregateStats;
  const title = bundleMeta?.title_main ?? titleOverride ?? meta?.title_main ?? item.external_id;
  // Rendered only in the profile library grid — request the small CDN
  // variant here without touching the persisted media_catalog.cover_url,
  // which every other page still reads at its original size.
  const cover = toSmallCover(bundleMeta?.cover_url ?? meta?.cover_url ?? '');
  const typeIc = TYPE_ICON[item.type] ?? TYPE_ICON['book'];
  const mediaUrl = `/media?id=${encodeURIComponent(bundleMeta?.external_id ?? item.external_id)}`;
  const badges = tagBadges(item.tags);

  // Earliest started_at first (the date the user set in the media editor,
  // not the work's own release date) — so the flyout reads in the order the
  // user actually went through these, not IGDB/AniList's own chronology.
  const orderedGrouped = [...grouped].sort((a, b) => (a.started_at ?? '').localeCompare(b.started_at ?? ''));
  const groupedTitles = orderedGrouped.map(g => catalogMap.get(g.external_id)?.title_main ?? g.external_id);

  // groupBundles' `grouped` already includes the representative item;
  // refineSagaGroups' `grouped` is just "the others", so only the saga case re-adds `item`.
  const aggregateMembers = bundleMeta ? orderedGrouped : [item, ...orderedGrouped];
  const isSecondaryRating = ratingSlot === 'rating_2';
  const ratingHtml = isAggregate
    ? formatRatingHtml(averageRating(aggregateMembers, ratingSlot), isSecondaryRating ? getRating2System() : getActiveRatingSystem(), 'library-card-rating', isSecondaryRating ? getRating2Max() : 10)
    : formatRatingHtml(isSecondaryRating ? item.rating_2 : item.rating, isSecondaryRating ? getRating2System() : getActiveRatingSystem(), 'library-card-rating', isSecondaryRating ? getRating2Max() : 10);
  // Earliest started_at / latest finished_at across every member by actual
  // date value — not by release order (a bundle/saga's earliest-released
  // work isn't necessarily the one the user started first), which used to
  // show the range backwards whenever those didn't line up.
  const earliestDate = (dates: (string | null | undefined)[]): string => {
    const times = dates.filter((d): d is string => !!d).map(d => new Date(d).getTime()).filter(t => !isNaN(t));
    return times.length ? formatDateNumeric(new Date(Math.min(...times))) : '';
  };
  const latestDate = (dates: (string | null | undefined)[]): string => {
    const times = dates.filter((d): d is string => !!d).map(d => new Date(d).getTime()).filter(t => !isNaN(t));
    return times.length ? formatDateNumeric(new Date(Math.max(...times))) : '';
  };
  const startDateStr = earliestDate(aggregateMembers.map(m => m.started_at));
  const endDateStr = latestDate(aggregateMembers.map(m => m.finished_at));
  // A one-shot work (movie, single-episode anime, etc. — see MediaEditorModal's
  // isMovie) has its started_at/finished_at set to the same day, which would
  // otherwise render as a redundant "12/2/2024 → 12/2/2024" range.
  const dateStr = startDateStr === endDateStr
    ? startDateStr
    : [startDateStr, endDateStr].filter(Boolean).join(' → ');

  // A wide stack-extra flyout (see below) normally opens to the right of the
  // card — for a card sitting near the right edge of the grid, that runs it
  // off-screen with no way to reach the later covers. Measured on hover
  // (not e.g. once on mount) since the grid can reflow — window resize,
  // sidebar toggling, filters changing the column count — and a stale
  // measurement would flip the wrong cards.
  const cellRef = useRef<HTMLDivElement>(null);
  const flyoutRef = useRef<HTMLDivElement>(null);
  const [flyoutOnLeft, setFlyoutOnLeft] = useState(false);
  const checkFlyoutDirection = () => {
    if (!cellRef.current || !flyoutRef.current) return;
    const cellRect = cellRef.current.getBoundingClientRect();
    // scrollWidth reads the flyout's real content width regardless of its
    // own collapsed max-width (0 at rest) — every item inside has a fixed
    // 75px width, so this doesn't depend on the slide-open transition
    // having played out at all.
    const flyoutWidth = flyoutRef.current.scrollWidth;
    setFlyoutOnLeft(cellRect.right + flyoutWidth > window.innerWidth);
  };

  // Keeps this cell's z-index elevated for the same 0.35s the flyout takes
  // to slide shut after the cursor leaves — otherwise, moving straight from
  // this card onto a neighbor it visually overlaps (its own flyout, whether
  // sliding right or left) would raise that neighbor to the *same* z-index
  // this one already has, and the closing flyout (mid-animation, still very
  // visible) could end up rendered behind the freshly-hovered neighbor
  // instead of on top of it for that last stretch. A plain CSS
  // transition-delay can't win that tie (the held value is identical to the
  // hover value, 10, same as the neighbor's) — this deliberately holds a
  // *higher* one instead, so it always wins regardless of what any neighbor
  // is doing.
  const [isClosing, setIsClosing] = useState(false);
  const closingTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(closingTimeoutRef.current), []);
  const handleMouseLeave = () => {
    if (grouped.length === 0) return;
    setIsClosing(true);
    clearTimeout(closingTimeoutRef.current);
    closingTimeoutRef.current = setTimeout(() => setIsClosing(false), 350);
  };
  const handleMouseEnter = () => {
    clearTimeout(closingTimeoutRef.current);
    setIsClosing(false);
    checkFlyoutDirection();
  };

  const openEditor = () => {
    if (bundleMeta || readOnly) {
      // A bundle has no library log of its own, and read-only (someone
      // else's profile) has no local log to open — go to the media page.
      window.location.href = mediaUrl;
      return;
    }
    window.dispatchEvent(new CustomEvent('open-profile-editor', {
      detail: { externalId: item.external_id, libraryEntry: item, catalogEntry: meta, ratingSlot },
    }));
  };

  return (
    <div
      ref={cellRef}
      className={`library-card-cell${grouped.length > 0 ? ' library-card-cell--stacked' : ''}${flyoutOnLeft ? ' library-card-cell--flyout-left' : ''}${isClosing ? ' library-card-cell--closing' : ''}`}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {/* stack-extra is a sibling of .library-card, not a child — the card needs
          overflow:hidden permanently (clips its blurred bg), so the flyout escapes via the wrapper instead. */}
      <div className="library-card" data-id={item.external_id} onClick={openEditor}>
        {cover && <div className="library-card-bg"><img className="library-card-bg-img" src={cover} alt="" /></div>}
        {grouped.length > 0 && (
          <span className="library-card-group-badge" title={`${p.library_group_editions_hint}: ${groupedTitles.join(', ')}`}>
            <span className="library-card-group-badge-count">+{grouped.length}</span>
            <span className="library-card-group-badge-arrow">›</span>
          </span>
        )}
        {badges.length > 0 && (
          <div className="library-card-tag-badges">
            {badges.map((b, i) => <span className="library-card-tag-badge" title={b.label} key={i}>{b.emoji}</span>)}
          </div>
        )}
        <a className="library-card-thumb" href={mediaUrl} onClick={e => e.stopPropagation()}>
          {cover
            ? <img src={cover} alt={title} loading="lazy" />
            : <div className="library-card-no-cover"><span>{title.slice(0, 2).toUpperCase()}</span></div>}
        </a>
        <div className="library-card-info">
          <span className="library-card-title">{title}</span>
          <div className="library-card-bottom-group">
            <span dangerouslySetInnerHTML={{ __html: ratingHtml }} />
            <div className="library-card-footer">
              {dateStr && <span className="library-card-date" dangerouslySetInnerHTML={{ __html: CALENDAR_ICON + dateStr }} />}
              <span className="library-card-type" dangerouslySetInnerHTML={{ __html: typeIc }} />
            </div>
          </div>
        </div>
      </div>
      {grouped.length > 0 && (
        // Hidden until hover (.library-card--stacked:hover in profile.css) — a peek at the "+N" badge's contents.
        <div className="library-card-stack-extra" ref={flyoutRef}>
          {orderedGrouped.map(g => {
            const gMeta = catalogMap.get(g.external_id);
            const gTitle = gMeta?.title_main ?? g.external_id;
            const gCover = toSmallCover(gMeta?.cover_url ?? '');
            return (
              <a
                key={g.external_id}
                className="library-card-stack-extra-item"
                href={`/media?id=${encodeURIComponent(g.external_id)}`}
                title={gTitle}
                onClick={e => e.stopPropagation()}
              >
                {gCover
                  ? <img src={gCover} alt={gTitle} loading="lazy" />
                  : <div className="library-card-no-cover"><span>{gTitle.slice(0, 2).toUpperCase()}</span></div>}
              </a>
            );
          })}
        </div>
      )}
    </div>
  );
}
