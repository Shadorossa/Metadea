// Split out of LibrarySection.tsx: a single library grid cell, plus its two
// private display helpers (date formatting, emoji-tag parsing).
import type { MediaCatalogEntry, LibraryEntry } from '../../lib/tauri';
import { getT } from '../../i18n/client';
import { getActiveRatingSystem, formatRatingHtml } from '../../lib/media/rating-utils';
import { typeIconMap, CALENDAR_ICON } from '../../lib/shared/icon-strings';
import { compareByReleaseDate } from '../../lib/media/mapper-utils';
import { formatDateNumeric } from '../../lib/shared/formatDate';
import { averageRating } from './library-grouping';

export const TYPE_ICON = typeIconMap(16);

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return formatDateNumeric(d);
}

// Matches a single leading emoji (plus an optional variation selector) at the
// very start of a tag string — e.g. "🎨Arte" → emoji "🎨", name "Arte". Tags
// are free text (see MediaEditorModal's tag input), so only tags the user
// actually prefixed with an emoji get a bookmark; plain-text tags are skipped.
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
  /** Saga's own assigned name (PrEditorModal's "Saga Name" field), shown
   *  instead of the earliest work's own title when a saga-chain merge found
   *  one — the bundle's own title_main plays the same role for bundles. */
  titleOverride?: string;
  /** True for a saga-chain merge (see refineSagaGroups) — same aggregate
   *  rating/date-range treatment as a bundle, just without swapping the
   *  cover (a saga still sits over its first work's own cover). */
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

  // Chronological, earliest first — so a saga's flyout reads left to right
  // in release order (SH1, SH2, SH3, ...) instead of whatever order the
  // section's own sort (rating/date-finished/duration) happened to leave
  // them in.
  const orderedGrouped = [...grouped].sort((a, b) =>
    compareByReleaseDate(catalogMap.get(a.external_id) ?? {}, catalogMap.get(b.external_id) ?? {})
  );
  const groupedTitles = orderedGrouped.map(g => catalogMap.get(g.external_id)?.title_main ?? g.external_id);

  // A bundle or saga-chain card merges every member's own rating/dates
  // instead of showing just the root's own — there's no single "item" that
  // represents the whole group's progress. groupBundles' own `grouped`
  // already includes the representative item itself (it's built by
  // concatenating every matched sub-group's own item+grouped, one of which
  // *is* the representative's), while refineSagaGroups' `grouped` is just
  // "the others" — so only the saga case needs `item` added back in here.
  const aggregateMembers = bundleMeta ? orderedGrouped : [item, ...orderedGrouped];
  const ratingHtml = isAggregate
    ? formatRatingHtml(averageRating(aggregateMembers), getActiveRatingSystem(), 'library-card-rating')
    : formatRatingHtml(item.rating, getActiveRatingSystem(), 'library-card-rating');
  const dateStr = isAggregate
    ? (() => {
        const sorted = [...aggregateMembers].sort((a, b) =>
          compareByReleaseDate(catalogMap.get(a.external_id) ?? {}, catalogMap.get(b.external_id) ?? {})
        );
        return [fmtDate(sorted[0]?.started_at), fmtDate(sorted[sorted.length - 1]?.finished_at)].filter(Boolean).join(' → ');
      })()
    : [fmtDate(item.started_at), fmtDate(item.finished_at)].filter(Boolean).join(' → ');

  const openEditor = () => {
    if (bundleMeta) {
      // The bundle itself has no library log of its own (it's not something
      // you "play" — its contents are), so there's nothing to open the
      // editor for; go to its media page instead, same as clicking the cover.
      window.location.href = mediaUrl;
      return;
    }
    window.dispatchEvent(new CustomEvent('open-profile-editor', {
      detail: { externalId: item.external_id, libraryEntry: item, catalogEntry: meta },
    }));
  };

  return (
    <div className={`library-card-cell${grouped.length > 0 ? ' library-card-cell--stacked' : ''}`}>
      {/* .library-card-stack-extra is a *sibling* of .library-card, both
          wrapped in .library-card-cell, instead of a child of the card
          itself. The card needs overflow:hidden permanently (it clips its
          own blurred cover background) — toggling that off on hover so the
          flyout could escape also un-clipped the blur, making the card
          visibly wider than its column on every hover, grouped or not. The
          wrapper carries overflow:visible instead, and has no painted
          content of its own to worry about clipping. */}
      <div className="library-card" data-id={item.external_id} onClick={openEditor}>
        {cover && <div className="library-card-bg"><img className="library-card-bg-img" src={cover} alt="" /></div>}
        {grouped.length > 0 && (
          <span className="library-card-group-badge" title={`${p.library_group_editions_hint}: ${groupedTitles.join(', ')}`}>
            +{grouped.length}
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
        // Hidden until hover (see .library-card--stacked:hover in
        // profile.css) — a peek at exactly what's collapsed under the "+N"
        // badge, sliding out to the right instead of making the user guess
        // from the badge's tooltip alone.
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
