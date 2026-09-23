// Home's recent-activity feed (friends / general), read from its
// localStorage caches. A client:only island: the first render already has
// the cached events and the titles/covers from the Home snapshot, so the
// sidebar paints complete instead of "no activity" then the list.
import { useEffect, useMemo, useState, memo } from 'react';
import { getCachedActivityFeed, getCachedGeneralActivityFeed, type ActivityFeedEntry } from '../../lib/social/activity-feed';
import type { CatalogSummary } from '../../lib/tauri';
import { readFeedCatalogRows } from '../../lib/home/feed-catalog';
import { getT } from '../../i18n/runtime';
import { readHomeSnapshot, updateHomeSnapshot } from '../../lib/home/home-snapshot';
import { typeIconMap } from '../../lib/dom/icon-strings';
import { getTypeLabel } from '../../lib/media/media-types';
import { HOF_GRADIENTS } from '../../lib/profile/hof';
import { formatLocalDateLong } from '../../lib/shared/text/format-date';
import { toSmallCover } from '../../lib/media/small-cover';
import { interpolate } from '../../lib/shared/text/interpolate';
import { Pagination } from '../media/Pagination';

type FeedTab = 'friends' | 'general';

const TYPE_ICON = typeIconMap(12);
// 10 cards per page; pages only slice the already-loaded cache.
export const FEED_PAGE_SIZE = 10;
// Cards visible without scrolling get their covers eagerly.
const EAGER_CARDS = 6;

interface FlatEvent {
  userId:    string;
  username:  string;
  avatarUrl: string | null;
  externalId: string;
  type:      'start' | 'complete' | 'progress';
  mediaType: string;
  date:      string;
  timestamp: string;
  progressStart?: number;
  progressEnd?:   number;
}

// Every string comes from getT() — the runtime UI locale — never from
// props rendered at build time, which carried the build locale.
export function ActivityFeedSection() {
  const p = getT().profile;
  const [tab, setTab] = useState<FeedTab>('friends');
  const [page, setPage] = useState(1);
  const selectTab = (next: FeedTab) => { setTab(next); setPage(1); };
  const [friendEntries, setFriendEntries] = useState<ActivityFeedEntry[]>(getCachedActivityFeed);
  const [generalEntries, setGeneralEntries] = useState<ActivityFeedEntry[]>(getCachedGeneralActivityFeed);
  const [catalog, setCatalog] = useState<Record<string, CatalogSummary>>(() => readHomeSnapshot()?.feedCatalog ?? {});

  useEffect(() => {
    const readCaches = () => {
      setFriendEntries(getCachedActivityFeed());
      setGeneralEntries(getCachedGeneralActivityFeed());
    };
    window.addEventListener('metadea:activity-feed-updated', readCaches);
    return () => window.removeEventListener('metadea:activity-feed-updated', readCaches);
  }, []);

  const entries = useMemo(
    () => tab === 'friends' ? friendEntries : generalEntries,
    [tab, friendEntries, generalEntries]
  );

  const events = useMemo<FlatEvent[]>(() => {
    const flat = entries.flatMap(entry =>
      entry.activity.filter(ev => ev.type === 'complete').map(ev => ({
        userId: entry.userId,
        username: entry.username,
        avatarUrl: entry.avatarUrl,
        ...ev,
      }))
    );
    flat.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    return flat;
  }, [entries]);

  const totalPages = Math.max(1, Math.ceil(events.length / FEED_PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageEvents = useMemo(
    () => events.slice((currentPage - 1) * FEED_PAGE_SIZE, currentPage * FEED_PAGE_SIZE),
    [events, currentPage]
  );

  // Catalog rows only for the page on screen (memoised per visit in
  // lib/home/feed-catalog.ts, so paging back costs nothing).
  const uniqueIds = useMemo(
    () => [...new Set(pageEvents.map(e => e.externalId))],
    [pageEvents]
  );

  // The friends tab's first page is what the next visit opens on: remember
  // how many cards it showed and whether it paginates, so the pre-paint
  // skeleton reserves exactly that.
  useEffect(() => {
    if (tab === 'friends') updateHomeSnapshot({ feedCount: Math.min(events.length, FEED_PAGE_SIZE), feedPaged: events.length > FEED_PAGE_SIZE });
  }, [tab, events.length]);

  useEffect(() => {
    let cancelled = false;
    // One batched read, memoised across mounts and tab switches (see
    // lib/home/feed-catalog.ts) instead of one get_catalog_entry per card.
    readFeedCatalogRows(uniqueIds).then(map => {
      if (cancelled) return;
      // Merged, so a failed read keeps the snapshot's rows on screen.
      setCatalog(prev => ({ ...prev, ...map }));
      if (Object.keys(map).length > 0) updateHomeSnapshot({ feedCatalog: map });
    });
    return () => { cancelled = true; };
  }, [uniqueIds]);

  const header = (
    <div className="home-activity-header">
      <h2 className="home-activity-title">{p.recent_activity}</h2>
      <div className="home-activity-tabs">
        <button
          type="button"
          className={`home-activity-tab${tab === 'friends' ? ' active' : ''}`}
          onClick={() => selectTab('friends')}
        >
          {p.activity_tab_friends}
        </button>
        <span className="home-activity-tab-divider">|</span>
        <button
          type="button"
          className={`home-activity-tab${tab === 'general' ? ' active' : ''}`}
          onClick={() => selectTab('general')}
        >
          {p.activity_tab_general}
        </button>
      </div>
    </div>
  );

  // Both hooks below must run unconditionally on every render, same as
  // every other one above — they used to sit after the early return further
  // down, so a render that took that branch (still loading, or a genuinely
  // empty feed) called fewer hooks than one that didn't, which is exactly
  // the "rendered more hooks than during the previous render" crash React's
  // Rules of Hooks exist to prevent. Neither depends on `mounted`/`events`,
  // so hoisting them here changes nothing about what they compute.
  const j = p.journey;

  const describe = useMemo(() => (title: string): string => {
    return interpolate(j.completed, { media: title });
  }, [j]);

  const ActivityCard = useMemo(() => memo((props: { ev: FlatEvent; i: number }) => {
    const { ev, i } = props;
    const meta = catalog[ev.externalId];
    const mediaTitle = meta?.title_main ?? ev.externalId;
    const cover = toSmallCover(meta?.cover_url);
    const text = describe(mediaTitle);
    const titleIdx = text.indexOf(mediaTitle);
    const textNode = titleIdx === -1
      ? text
      : <>{text.slice(0, titleIdx)}<strong className="act-card-bold-title">{mediaTitle}</strong>{text.slice(titleIdx + mediaTitle.length)}</>;
    const fallbackBg = HOF_GRADIENTS[ev.mediaType] || 'linear-gradient(160deg, #374151 0%, #1f2937 100%)';

    return (
      <div className="act-card" key={`${ev.userId}-${ev.externalId}-${ev.timestamp}-${i}`}>
        <a className="act-card-link" href={`/media?id=${encodeURIComponent(ev.externalId)}`} />
        {cover ? (
          <img className="act-card-cover" src={cover} alt={mediaTitle} loading={i < EAGER_CARDS ? 'eager' : 'lazy'} decoding="async" />
        ) : (
          <div className="act-card-cover-fallback" style={{ background: fallbackBg }}>
            <span>{mediaTitle.slice(0, 1).toUpperCase()}</span>
          </div>
        )}
        {ev.avatarUrl
          ? <img className="act-card-user-avatar" src={ev.avatarUrl} alt="" />
          : <div className="act-card-user-avatar act-card-user-avatar--placeholder" />}
        <div className="act-card-content">
          <span className="act-card-text"><strong className="act-card-bold-title">{ev.username}</strong> {textNode}</span>
          <div className="act-card-meta">
            <span className="act-card-type-icon" dangerouslySetInnerHTML={{ __html: TYPE_ICON[ev.mediaType] ?? '' }} />
            <span className="act-card-type-label">{getTypeLabel(ev.mediaType)}</span>
            <span className="act-card-date">{formatLocalDateLong(ev.date)}</span>
          </div>
        </div>
      </div>
    );
  }), [catalog, describe]);

  if (events.length === 0) {
    return (
      <>
        {header}
        <div className="act-empty"><span>{p.no_activity}</span></div>
      </>
    );
  }

  const paged = totalPages > 1;
  return (
    <>
      {header}
      <div className="activity-feed">
        {pageEvents.map((ev, i) => (
          <ActivityCard key={`${ev.userId}-${ev.externalId}-${ev.timestamp}-${i}`} ev={ev} i={i} />
        ))}
        {/* A short last page keeps the full 10-card height, so the page
            picker below never jumps. */}
        {paged && Array.from({ length: FEED_PAGE_SIZE - pageEvents.length }, (_, i) => (
          <div className="act-card act-card--filler" aria-hidden="true" key={`filler-${i}`}>
            <div className="act-card-cover-fallback" />
            <div className="act-card-content"><span className="act-card-text">&nbsp;</span><div className="act-card-meta">&nbsp;</div></div>
          </div>
        ))}
      </div>
      {paged && (
        <div className="home-activity-pagination">
          <Pagination currentPage={currentPage} totalPages={totalPages} onChange={setPage} />
        </div>
      )}
    </>
  );
}
