// Split out of LibrarySection.tsx: a single library grid cell, plus its private emoji-tag helper.
import type { MediaCatalogEntry, LibraryEntry } from '../../lib/tauri';
import { getT } from '../../i18n/client';
import { getActiveRatingSystem, formatRatingHtml } from '../../lib/media/rating-utils';
import { typeIconMap, CALENDAR_ICON } from '../../lib/shared/icon-strings';
import { formatDateNumeric } from '../../lib/shared/formatDate';
import { averageRating } from './library-grouping';

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

export function LibraryCard({ item, grouped, bundleMeta, titleOverride, aggregateStats, catalogMap, p }: {
  item: LibraryEntry;
  grouped: LibraryEntry[];
  bundleMeta?: MediaCatalogEntry;
  /** Saga's assigned name, shown instead of the earliest work's title. */
  titleOverride?: string;
  /** Saga-chain merge (see refineSagaGroups) — aggregate stats without swapping the cover. */
  aggregateStats?: boolean;
  catalogMap: Map<string, MediaCatalogEntry>;
  p: ReturnType<typeof getT>['profile'];
}) {
  const meta = catalogMap.get(item.external_id);
  const isAggregate = !!bundleMeta || !!aggregateStats;
  const title = bundleMeta?.title_main ?? titleOverride ?? meta?.title_main ?? item.external_id;
  const cover = bundleMeta?.cover_url ?? meta?.cover_url ?? '';
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
  const ratingHtml = isAggregate
    ? formatRatingHtml(averageRating(aggregateMembers), getActiveRatingSystem(), 'library-card-rating')
    : formatRatingHtml(item.rating, getActiveRatingSystem(), 'library-card-rating');
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

  const openEditor = () => {
    if (bundleMeta) {
      // A bundle has no library log of its own — go to its media page instead.
      window.location.href = mediaUrl;
      return;
    }
    window.dispatchEvent(new CustomEvent('open-profile-editor', {
      detail: { externalId: item.external_id, libraryEntry: item, catalogEntry: meta },
    }));
  };

  return (
    <div className={`library-card-cell${grouped.length > 0 ? ' library-card-cell--stacked' : ''}`}>
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
        <div className="library-card-stack-extra">
          {orderedGrouped.map(g => {
            const gMeta = catalogMap.get(g.external_id);
            const gTitle = gMeta?.title_main ?? g.external_id;
            const gCover = gMeta?.cover_url ?? '';
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
