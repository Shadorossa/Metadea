// "Actividad reciente" on Home — activity from people you follow, read from
// the once-a-day cache (see lib/social/activity-feed.ts; this component never
// hits the network itself, BaseLayout.astro's daily refresh already did).
import { useEffect, useMemo, useState } from 'react';
import { getCachedActivityFeed, getCachedGeneralActivityFeed, type ActivityFeedEntry } from '../../lib/social/activity-feed';
import { getCatalogEntry } from '../../lib/tauri';
import { getT } from '../../i18n/client';
import { typeIconMap } from '../../lib/shared/icon-strings';

type FeedTab = 'friends' | 'general';

const TYPE_ICON = typeIconMap(14);
const MAX_EVENTS_SHOWN = 15;

interface FlatEvent {
  userId:    string;
  username:  string;
  avatarUrl: string | null;
  externalId: string;
  type:      'start' | 'complete' | 'progress';
  mediaType: string;
  timestamp: string;
  progressStart?: number;
  progressEnd?:   number;
}

function interpolate(template: string, vars: Record<string, string | number>): string {
  return Object.entries(vars).reduce((acc, [key, val]) => acc.replace(`{${key}}`, String(val)), template);
}

export function ActivityFeedSection() {
  const p = getT().profile;
  const [tab, setTab] = useState<FeedTab>('friends');
  const [friendEntries] = useState<ActivityFeedEntry[]>(() => getCachedActivityFeed());
  const [generalEntries] = useState<ActivityFeedEntry[]>(() => getCachedGeneralActivityFeed());
  const [titles, setTitles] = useState<Record<string, string>>({});

  const entries = tab === 'friends' ? friendEntries : generalEntries;

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

  useEffect(() => {
    let cancelled = false;
    // Only shows a real title for works you also have in your own local
    // catalog — same "you can only see what you already know" model the
    // whole social feature follows, not a server-side lookup.
    const uniqueIds = [...new Set(events.map(e => e.externalId))];
    Promise.all(uniqueIds.map(async id => [id, await getCatalogEntry(id).catch(() => null)] as const))
      .then(results => {
        if (cancelled) return;
        const map: Record<string, string> = {};
        for (const [id, entry] of results) if (entry?.title_main) map[id] = entry.title_main;
        setTitles(map);
      });
    return () => { cancelled = true; };
  }, [events]);

  const tabs = (
    <div className="home-activity-tabs">
      <button
        type="button"
        className={`home-activity-tab${tab === 'friends' ? ' active' : ''}`}
        onClick={() => setTab('friends')}
      >
        {p.activity_tab_friends}
      </button>
      <button
        type="button"
        className={`home-activity-tab${tab === 'general' ? ' active' : ''}`}
        onClick={() => setTab('general')}
      >
        {p.activity_tab_general}
      </button>
    </div>
  );

  if (events.length === 0) {
    return (
      <>
        {tabs}
        <div className="home-activity-empty">
          <p>{p.no_activity}</p>
        </div>
      </>
    );
  }

  const j = p.journey;

  const describe = (ev: FlatEvent): string => {
    const media = titles[ev.externalId] ?? ev.externalId;
    if (ev.type === 'complete') return interpolate(j.completed, { media });
    if (ev.type === 'progress') {
      return ev.progressStart === ev.progressEnd
        ? interpolate(j.watched_episode, { end: ev.progressEnd ?? 0, media })
        : interpolate(j.watched_episodes, { start: ev.progressStart ?? 0, end: ev.progressEnd ?? 0, media });
    }
    return interpolate(j.started, { media });
  };

  return (
    <>
      {tabs}
      <div className="home-activity-list">
      {events.map((ev, i) => (
        <div className="home-activity-item" key={`${ev.userId}-${ev.externalId}-${ev.timestamp}-${i}`}>
          {ev.avatarUrl
            ? <img className="home-activity-avatar" src={ev.avatarUrl} alt="" />
            : <div className="home-activity-avatar home-activity-avatar--placeholder" />}
          <span className="home-activity-icon" dangerouslySetInnerHTML={{ __html: TYPE_ICON[ev.mediaType] ?? '' }} />
          <p className="home-activity-text">
            <strong>{ev.username}</strong> {describe(ev)}
          </p>
        </div>
      ))}
      </div>
    </>
  );
}
