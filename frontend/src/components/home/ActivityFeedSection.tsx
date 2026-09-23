// Feed de actividad reciente en Home (amigos y general) con datos en cache.
import { useEffect, useMemo, useState, memo } from 'react';
import { mapById } from '../../lib/shared/collections/batch';
import { getCachedActivityFeed, getCachedGeneralActivityFeed, type ActivityFeedEntry } from '../../lib/social/activity-feed';
import { getCatalogEntry, type MediaCatalogEntry } from '../../lib/tauri';
import { getT } from '../../i18n/runtime';
import { typeIconMap } from '../../lib/dom/icon-strings';
import { getTypeLabel } from '../../lib/media/media-types';
import { HOF_GRADIENTS } from '../../lib/profile/hof';
import { formatLocalDateLong } from '../../lib/shared/text/format-date';
import { toSmallCover } from '../../lib/media/small-cover';
import { interpolate } from '../../lib/shared/text/interpolate';

type FeedTab = 'friends' | 'general';

const TYPE_ICON = typeIconMap(12);
const MAX_EVENTS_SHOWN = 15;

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

export function ActivityFeedSection({ title, i18n }: { title: string; i18n?: any }) {
  const p = i18n ?? getT().profile;
  const [tab, setTab] = useState<FeedTab>('friends');
  const [friendEntries, setFriendEntries] = useState<ActivityFeedEntry[]>([]);
  const [generalEntries, setGeneralEntries] = useState<ActivityFeedEntry[]>([]);
  const [catalog, setCatalog] = useState<Record<string, MediaCatalogEntry>>({});
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const readCaches = () => {
      setFriendEntries(getCachedActivityFeed());
      setGeneralEntries(getCachedGeneralActivityFeed());
    };
    readCaches();
    setMounted(true);
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
    return flat.slice(0, MAX_EVENTS_SHOWN);
  }, [entries]);

  const uniqueIds = useMemo(
    () => [...new Set(events.map(e => e.externalId))],
    [events]
  );

  useEffect(() => {
    let cancelled = false;
    mapById(uniqueIds, id => getCatalogEntry(id).catch(() => null))
      .then(results => {
        if (cancelled) return;
        const map: Record<string, MediaCatalogEntry> = {};
        for (const [id, entry] of results) if (entry) map[id] = entry;
        setCatalog(map);
      });
    return () => { cancelled = true; };
  }, [uniqueIds]);

  const header = (
    <div className="home-activity-header">
      <h2 className="home-activity-title">{title}</h2>
      <div className="home-activity-tabs">
        <button
          type="button"
          className={`home-activity-tab${tab === 'friends' ? ' active' : ''}`}
          onClick={() => setTab('friends')}
        >
          {p.activity_tab_friends}
        </button>
        <span className="home-activity-tab-divider">|</span>
        <button
          type="button"
          className={`home-activity-tab${tab === 'general' ? ' active' : ''}`}
          onClick={() => setTab('general')}
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
          <img className="act-card-cover" src={cover} alt={mediaTitle} loading="lazy" />
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

  if (!mounted || events.length === 0) {
    return (
      <>
        {header}
        <div className="act-empty"><span>{p.no_activity}</span></div>
      </>
    );
  }

  return (
    <>
      {header}
      <div className="activity-feed">
        {events.map((ev, i) => (
          <ActivityCard key={`${ev.userId}-${ev.externalId}-${ev.timestamp}-${i}`} ev={ev} i={i} />
        ))}
      </div>
    </>
  );
}
