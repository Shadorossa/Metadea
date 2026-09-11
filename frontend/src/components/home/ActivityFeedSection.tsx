// "Actividad reciente" on Home — activity from people you follow, read from
// the once-a-day cache (see lib/social/activity-feed.ts; this component never
// hits the network itself, BaseLayout.astro's daily refresh already did).
// Card format/CSS reused from the profile page's own "Actividad reciente"
// (ActivitySection.tsx / .act-card in profile.css) — same layout, just with
// a friend avatar badge and bolded username added since this feed spans
// multiple people instead of just the local user.
import { useEffect, useMemo, useState, memo } from 'react';
import { getCachedActivityFeed, getCachedGeneralActivityFeed, type ActivityFeedEntry } from '../../lib/social/activity-feed';
import { getCatalogEntry, type MediaCatalogEntry } from '../../lib/tauri';
import { getT } from '../../i18n/client';
import { typeIconMap } from '../../lib/shared/icon-strings';
import { getTypeLabel, isReadingType } from '../../lib/constants/media';
import { HOF_GRADIENTS } from '../../lib/profile/hof';
import { formatLocalDateLong } from '../../lib/shared/formatDate';
import { toSmallCover } from '../../lib/shared/small-cover';
import { interpolate } from '../../lib/shared/interpolate';

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

export function ActivityFeedSection({ title }: { title: string }) {
  const p = getT().profile;
  const [tab, setTab] = useState<FeedTab>('friends');
  const [friendEntries] = useState<ActivityFeedEntry[]>(() => getCachedActivityFeed());
  const [generalEntries] = useState<ActivityFeedEntry[]>(() => getCachedGeneralActivityFeed());
  const [catalog, setCatalog] = useState<Record<string, MediaCatalogEntry>>({});

  const entries = useMemo(
    () => tab === 'friends' ? friendEntries : generalEntries,
    [tab, friendEntries, generalEntries]
  );

  const events = useMemo<FlatEvent[]>(() => {
    const flat = entries.flatMap(entry =>
      entry.activity.map(ev => ({
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
    Promise.all(uniqueIds.map(async id => [id, await getCatalogEntry(id).catch(() => null)] as const))
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

  if (events.length === 0) {
    return (
      <>
        {header}
        <div className="act-empty"><span>{p.no_activity}</span></div>
      </>
    );
  }

  const j = p.journey;

  const describe = useMemo(() => (ev: FlatEvent, title: string): string => {
    if (ev.type === 'complete') return interpolate(j.completed, { media: title });
    if (ev.type === 'progress') {
      const start = ev.progressStart ?? 0;
      const end = ev.progressEnd ?? 0;
      const isSingle = start === end;
      if (ev.mediaType === 'anime' || ev.mediaType === 'series') {
        return interpolate(isSingle ? j.watched_episode : j.watched_episodes, { media: title, start, end });
      }
      if (isReadingType(ev.mediaType)) {
        return interpolate(isSingle ? j.read_chapter : j.read_chapters, { media: title, start, end });
      }
      return interpolate(j.updated, { media: title });
    }
    return interpolate(j.started, { media: title });
  }, [j]);

  const ActivityCard = useMemo(() => memo((props: { ev: FlatEvent; i: number }) => {
    const { ev, i } = props;
    const meta = catalog[ev.externalId];
    const mediaTitle = meta?.title_main ?? ev.externalId;
    const cover = toSmallCover(meta?.cover_url);
    const text = describe(ev, mediaTitle);
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
