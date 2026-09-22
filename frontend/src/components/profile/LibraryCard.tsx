// Split out of LibrarySection.tsx: a single library grid cell, plus its private emoji-tag helper.
import { useEffect, useRef, useState, useMemo, memo, type MouseEvent } from 'react';
import {
  BookImage, BookMarked, BookOpen, BookText, Clapperboard, Gamepad2,
  MessageSquareText, Tv, TvMinimalPlay, type LucideIcon,
} from 'lucide-react';
import { getCatalogEntry, type MediaCatalogEntry, type LibraryEntry, type DbMediaRelation } from '../../lib/tauri';
import { getT } from '../../i18n/client';
import { getActiveRatingSystem, formatRatingHtml } from '../../lib/media/rating-utils';
import { getRating2System, getRating2Max, type RatingSlot, isUnifySeasonsHighestRatedCoverEnabled, isCompletedMangaIssueCoverEnabled } from '../../lib/settings/preferences';
import { CALENDAR_ICON } from '../../lib/shared/icon-strings';
import { formatDateNumeric } from '../../lib/shared/formatDate';
import { averageRating, latestInProgressMember } from '../../lib/profile/library-grouping';
import { toMediumCover, toSmallCover } from '../../lib/shared/small-cover';
import { stripSeasonSuffix } from '../../lib/media/mapper-utils';
import { isInProgressStatus, pickAggregateStatus } from '../../lib/constants/media';
import { LOCAL_CATEGORY_BY_MEDIA_TYPE } from '../local/utils/constants';

const LIBRARY_MEDIA_ICONS: Record<string, LucideIcon> = {
  game: Gamepad2,
  anime: TvMinimalPlay,
  manga: BookOpen,
  lnovel: BookMarked,
  vnovel: MessageSquareText,
  series: Tv,
  movie: Clapperboard,
  book: BookText,
  comic: BookImage,
};

function nextReadingIssueCover(
  item: LibraryEntry,
  issueRelations: DbMediaRelation[],
  catalogEntry?: MediaCatalogEntry,
): string | null {
  const type = item.type.split('_')[0];
  if (type !== 'manga' && type !== 'comic') return null;
  const isCompleted = item.status === 'completed';
  if (type === 'manga' && isCompleted && !isCompletedMangaIssueCoverEnabled()) return null;
  if (!isCompleted && !isInProgressStatus(item.status) && item.status !== 'paused' && item.status !== 'dropped') return null;

  // Manga tracks volumes separately from chapters; Comic Vine comics track
  // issue numbers in the primary progress field. Completed works use the
  // final known volume/issue instead of asking for a nonexistent next one.
  const completedCount = type === 'manga' ? item.progress_2 : item.progress;
  const issueNumbers = issueRelations
    .filter(relation => relation.relation_type === 'ISSUE' && !!relation.cover)
    .map(relation => Number(relation.title.match(/^#\s*(\d+(?:\.\d+)?)/)?.[1]))
    .filter(number => Number.isFinite(number) && number > 0);
  const lastAvailableIssue = issueNumbers.length ? Math.max(...issueNumbers) : null;
  const catalogTotal = type === 'manga' ? catalogEntry?.total_count_2 : catalogEntry?.total_count;
  const targetIssueNumber = isCompleted
    ? catalogTotal && catalogTotal > 0
      ? catalogTotal
      : completedCount > 0
        ? Math.floor(completedCount)
        : lastAvailableIssue
    : Math.floor(completedCount) + 1;
  if (targetIssueNumber == null || !Number.isSafeInteger(targetIssueNumber) || targetIssueNumber < 1) return null;

  const match = issueRelations.find(relation => {
    if (relation.relation_type !== 'ISSUE' || !relation.cover) return false;
    const issueNumber = relation.title.match(/^#\s*(\d+(?:\.\d+)?)/)?.[1];
    return issueNumber != null && Number(issueNumber) === targetIssueNumber;
  });
  return match?.cover ?? null;
}

export function LibraryTypeIcon({ type, size = 16 }: { type: string; size?: number }) {
  const baseType = type.split('_')[0] || 'book';
  const Icon = LIBRARY_MEDIA_ICONS[baseType] ?? BookText;
  return <Icon size={size} strokeWidth={2} aria-hidden="true" />;
}

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

export const LibraryCard = memo(({ item, grouped, bundleMeta, titleOverride, aggregateStats, hideGroupingUi, mediaExternalId, catalogMap, p, readOnly, ratingSlot = 'rating', showResumeAction, playableResumeIds, issueRelations }: {
  item: LibraryEntry;
  grouped: LibraryEntry[];
  bundleMeta?: MediaCatalogEntry;
  /** Saga's assigned name, shown instead of the earliest work's title. */
  titleOverride?: string;
  /** Saga-chain merge (see refineSagaGroups) — aggregate stats without swapping the cover. */
  aggregateStats?: boolean;
  /** "Unificar temporadas" cards (unifyAnimeSeasons) - the card is still an
   *  aggregate (averaged rating, unified status) but should read as one
   *  clean card, not as an N-items stack: no "+N" badge, no stacked-shadow
   *  look, no hover flyout revealing the merged seasons underneath. */
  hideGroupingUi?: boolean;
  /** Unified event leagues retain individual season logs, while the card
   *  opens the competition container where those seasons can be explored. */
  mediaExternalId?: string;
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
  /** Show the quick action only in the library's in-progress sections. */
  showResumeAction?: boolean;
  /** External IDs confirmed playable by Local / Play. */
  playableResumeIds?: ReadonlySet<string>;
  /** Cached Comic Vine issue relations for this work, used for a display-only reading cover. */
  issueRelations?: DbMediaRelation[];
}) => {
  const meta = catalogMap.get(item.external_id);
  const rawTitle = bundleMeta?.title_main ?? titleOverride ?? meta?.title_main ?? item.external_id;
  // hideGroupingUi only ever comes from unifyAnimeSeasons (see
  // LibrarySection.tsx) — this card represents the whole chain, so a
  // trailing "2nd Season"/"The Final Season" from whichever season happened
  // to become the representative would misleadingly label the fused card.
  const title = hideGroupingUi ? stripSeasonSuffix(rawTitle) : rawTitle;
  const mediaUrl = `/media?id=${encodeURIComponent(bundleMeta?.external_id ?? mediaExternalId ?? item.external_id)}`;
  const badges = tagBadges(item.tags);
  const orderedGrouped = useMemo(() =>
    [...grouped].sort((a, b) => (a.started_at ?? '').localeCompare(b.started_at ?? '')),
    [grouped]
  );
  const groupedTitles = useMemo(() =>
    orderedGrouped.map(g => catalogMap.get(g.external_id)?.title_main ?? g.external_id),
    [orderedGrouped, catalogMap]
  );

  const aggregateMembers = useMemo(() =>
    bundleMeta ? orderedGrouped : [item, ...orderedGrouped],
    [bundleMeta, orderedGrouped, item]
  );

  const [dynamicCover, setDynamicCover] = useState<string | null>(null);
  useEffect(() => {
    if (!hideGroupingUi) {
      setDynamicCover(null);
      return;
    }

    const overallStatus = pickAggregateStatus(aggregateMembers.map(m => m.status));
    let targetMember: LibraryEntry | null = null;

    if (overallStatus === 'completed' && isUnifySeasonsHighestRatedCoverEnabled()) {
      let highestScore = -Infinity;
      for (const m of aggregateMembers) {
        const score = m.rating ?? -Infinity;
        if (score > highestScore) {
          highestScore = score;
          targetMember = m;
        }
      }
    }

    if (!targetMember) targetMember = latestInProgressMember(aggregateMembers);

    if (!targetMember) {
      setDynamicCover(null);
      return;
    }

    const cachedCover = catalogMap.get(targetMember.external_id)?.cover_url;
    if (cachedCover) {
      setDynamicCover(cachedCover);
      return;
    }

    let cancelled = false;
    getCatalogEntry(targetMember.external_id).then(entry => {
      if (!cancelled && entry?.cover_url) {
        setDynamicCover(entry.cover_url);
      }
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [hideGroupingUi, aggregateMembers, catalogMap]);

  const readingIssueCover = nextReadingIssueCover(item, issueRelations ?? [], meta);
  const cover = readingIssueCover
    ? toSmallCover(readingIssueCover)
    : toMediumCover(dynamicCover || (bundleMeta?.cover_url ?? meta?.cover_url ?? ''));

  // Same "which season is actually active" pick as inProgressCover above —
  // the card's own `item` is always the earliest-release season (see
  // unifyAnimeSeasons), so without this, clicking a fused card that's
  // visually showing (via inProgressCover) a later season you're mid-way
  // through would still open the editor on season 1 instead of the one the
  // card is actually representing right now.
  const activeSeasonId = useMemo(() => {
    if (!hideGroupingUi) return null;
    return latestInProgressMember(aggregateMembers)?.external_id ?? null;
  }, [hideGroupingUi, aggregateMembers]);

  const resumeTarget = useMemo(() => {
    if (activeSeasonId) return aggregateMembers.find(member => member.external_id === activeSeasonId) ?? item;
    const activeMembers = [item, ...aggregateMembers]
      .filter(member => isInProgressStatus(member.status) || member.status === 'in_progress')
      .sort((a, b) => (a.started_at ?? '').localeCompare(b.started_at ?? ''));
    return activeMembers[activeMembers.length - 1] ?? item;
  }, [activeSeasonId, aggregateMembers, item]);

  const resumeCategoryId = LOCAL_CATEGORY_BY_MEDIA_TYPE[resumeTarget.type];
  const canResume = showResumeAction && !readOnly && !!resumeCategoryId && playableResumeIds?.has(resumeTarget.external_id);
  const resumeTitle = p.continue_in_local;
  const handleResume = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (!resumeCategoryId) return;
    const url = new URL('/local', window.location.origin);
    url.searchParams.set('type', resumeCategoryId);
    url.searchParams.set('resume', resumeTarget.external_id);
    window.location.href = url.toString();
  };

  const customGeneralRating = useMemo(() => {
    if (!hideGroupingUi) return null;
    const val = localStorage.getItem(`general_rating:${item.external_id}`);
    return val ? parseFloat(val) : null;
  }, [hideGroupingUi, item.external_id]);

  const ratingHtml = useMemo(() => {
    const isAggregate = !!bundleMeta || !!aggregateStats;
    const isSecondaryRating = ratingSlot === 'rating_2';
    const members = aggregateMembers;
    if (isAggregate) {
      const displayScore = (hideGroupingUi && customGeneralRating !== null) ? customGeneralRating : averageRating(members, ratingSlot);
      return formatRatingHtml(displayScore, isSecondaryRating ? getRating2System() : getActiveRatingSystem(), 'library-card-rating', isSecondaryRating ? getRating2Max() : 10);
    }
    return formatRatingHtml(isSecondaryRating ? item.rating_2 : item.rating, isSecondaryRating ? getRating2System() : getActiveRatingSystem(), 'library-card-rating', isSecondaryRating ? getRating2Max() : 10);
  }, [bundleMeta, aggregateStats, aggregateMembers, ratingSlot, item.rating, item.rating_2, hideGroupingUi, customGeneralRating]);

  const dateStr = useMemo(() => {
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
    return startDateStr === endDateStr
      ? startDateStr
      : [startDateStr, endDateStr].filter(Boolean).join(' → ');
  }, [aggregateMembers]);

  const cellRef = useRef<HTMLDivElement>(null);
  const flyoutRef = useRef<HTMLDivElement>(null);
  const [flyoutOnLeft, setFlyoutOnLeft] = useState(false);

  const checkFlyoutDirection = () => {
    if (!cellRef.current) return;
    const cellRect = cellRef.current.getBoundingClientRect();
    const count = orderedGrouped.length || 1;
    const flyoutWidth = count * 82 + 24;
    const spaceOnRight = window.innerWidth - cellRect.right;
    const spaceOnLeft = cellRect.left;
    setFlyoutOnLeft(spaceOnRight < flyoutWidth && spaceOnLeft > spaceOnRight);
  };

  const [isClosing, setIsClosing] = useState(false);
  const closingTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(closingTimeoutRef.current), []);

  const handleMouseLeave = () => {
    if (grouped.length === 0 || hideGroupingUi) return;
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
    if (bundleMeta || mediaExternalId || readOnly) {
      // A bundle has no library log of its own, and read-only (someone
      // else's profile) has no local log to open — go to the media page.
      window.location.href = mediaUrl;
      return;
    }
    window.dispatchEvent(new CustomEvent('open-profile-editor', {
      detail: { externalId: item.external_id, libraryEntry: item, catalogEntry: meta, ratingSlot, initialActiveLogId: activeSeasonId ?? undefined },
    }));
  };

  // hideGroupingUi (unifyAnimeSeasons cards) still uses `grouped` for the
  // rating average/date range above (aggregateMembers/ratingHtml/dateStr),
  // just not for anything that visually reveals "this is N stacked items."
  const showGroupUi = grouped.length > 0 && !hideGroupingUi;

  return (
    <div
      ref={cellRef}
      className={`library-card-cell${showGroupUi ? ' library-card-cell--stacked' : ''}${flyoutOnLeft ? ' library-card-cell--flyout-left' : ''}${isClosing ? ' library-card-cell--closing' : ''}${canResume ? ' library-card-cell--resumable' : ''}`}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {/* stack-extra is a sibling of .library-card, not a child — the card needs
          overflow:hidden permanently (clips its blurred bg), so the flyout escapes via the wrapper instead. */}
      <div className="library-card" data-id={item.external_id} onClick={openEditor}>
        {cover && <div className="library-card-bg"><img className="library-card-bg-img" src={cover} alt="" /></div>}
        {showGroupUi && (
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
            ? <img src={cover} alt={title} loading="lazy" decoding="async" />
            : <div className="library-card-no-cover"><span>{title.slice(0, 2).toUpperCase()}</span></div>}
        </a>
        <div className="library-card-info">
          <span className="library-card-title">{title}</span>
          <div className="library-card-bottom-group">
            <span dangerouslySetInnerHTML={{ __html: ratingHtml }} />
            <div className="library-card-footer">
              {dateStr && <span className="library-card-date" dangerouslySetInnerHTML={{ __html: CALENDAR_ICON + dateStr }} />}
              <span className="library-card-type"><LibraryTypeIcon type={item.type} size={20} /></span>
            </div>
          </div>
        </div>
      </div>
      {canResume && (
        <button
          type="button"
          className="library-card-resume"
          title={resumeTitle}
          aria-label={`${resumeTitle}: ${catalogMap.get(resumeTarget.external_id)?.title_main ?? resumeTarget.external_id}`}
          onClick={handleResume}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <polygon points="5 3 19 12 5 21 5 3" />
          </svg>
        </button>
      )}
      {showGroupUi && (
        // Hidden until hover (.library-card--stacked:hover in profile.css) — a peek at the "+N" badge's contents.
        <div className="library-card-stack-extra" ref={flyoutRef}>
          {orderedGrouped.map(g => {
            const gMeta = catalogMap.get(g.external_id);
            const gTitle = gMeta?.title_main ?? g.external_id;
            const gCover = toMediumCover(gMeta?.cover_url ?? '');
            return (
              <a
                key={g.external_id}
                className="library-card-stack-extra-item"
                href={`/media?id=${encodeURIComponent(g.external_id)}`}
                title={gTitle}
                onClick={e => e.stopPropagation()}
              >
                {gCover
                  ? <img src={gCover} alt={gTitle} loading="lazy" decoding="async" />
                  : <div className="library-card-no-cover"><span>{gTitle.slice(0, 2).toUpperCase()}</span></div>}
              </a>
            );
          })}
        </div>
      )}
    </div>
  );
});
LibraryCard.displayName = 'LibraryCard';
