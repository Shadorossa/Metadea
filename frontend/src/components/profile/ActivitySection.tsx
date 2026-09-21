import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { getAuthToken, readUserJourney, writeUserJourney } from '../../lib/tauri';
import type { DayJourney, UserJourneyEvent, MediaCatalogEntry } from '../../lib/tauri';
import { typeIconMap } from '../../lib/shared/icon-strings';
import { IconTrash } from '../local/ui/icons';
import { getTypeLabel } from '../../lib/constants/media';
import { HOF_GRADIENTS } from '../../lib/profile/hof';
import { STORAGE_KEYS } from '../../lib/shared/storage-keys';
import type { getT } from '../../i18n/client';
import { formatLocalDateLong } from '../../lib/shared/formatDate';
import { toSmallCover } from '../../lib/shared/small-cover';
import { interpolate } from '../../lib/shared/interpolate';
import { decodeJwtPayload } from '../../lib/shared/encoding-utils';
import { removeCachedGeneralActivity, refreshGeneralActivityFeed } from '../../lib/social/activity-feed';

type P = ReturnType<typeof getT>['profile'];

interface ActivityEvent extends UserJourneyEvent {
  date: string;
  formattedDate: string;
}

const TYPE_ICON = typeIconMap(12);

interface Props {
  catalogMap: Map<string, MediaCatalogEntry>;
  p: P;
  // Someone else's profile (UserProfileView) has no local journey to read
  // via readUserJourney — it passes the social_user_activity cache,
  // reshaped into the same DayJourney[] grouping, instead. readOnly hides
  // the delete-event context menu (there's no local journey entry to
  // remove — this isn't the viewer's own data).
  overrideJourney?: DayJourney[];
  readOnly?: boolean;
}

interface ContextMenuState {
  x: number;
  y: number;
  event: ActivityEvent;
}

export function ActivitySection({ catalogMap, p, overrideJourney, readOnly }: Props) {
  const [journey, setJourney] = useState<DayJourney[] | null>(overrideJourney ?? null);
  const [menu, setMenu] = useState<ContextMenuState | null>(null);
  const j = p.journey || {};

  useEffect(() => {
    if (overrideJourney) {
      setJourney(overrideJourney);
      return;
    }
    let cancelled = false;
    readUserJourney().then(res => { if (!cancelled) setJourney(Array.isArray(res) ? res : []); });
    return () => { cancelled = true; };
  }, [overrideJourney]);

  const [visible, setVisible] = useState<boolean>(Boolean(overrideJourney));
  useEffect(() => {
    if (journey === null) return;
    setVisible(true);
  }, [journey]);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [menu]);

  const finalEvents = useMemo<ActivityEvent[]>(() => {
    if (!journey) return [];
    const daysWithEvents = journey
      .filter(day => day && day.date && day.events?.some(event => event.type === 'complete'))
      .slice(0, 7);

    return daysWithEvents.flatMap(day => {
      const formattedDate = formatLocalDateLong(day.date);
      return (day.events || [])
        .filter(Boolean)
        .filter(event => event.type === 'complete')
        .map(event => ({ ...event, date: day.date, formattedDate }));
    });
  }, [journey]);

  const handleDelete = async (event: ActivityEvent) => {
    const current = await readUserJourney();
    const updated = current.map((day): DayJourney => {
      if (day.date === event.date) {
        day.events = (day.events || []).filter(evt =>
          !(evt.externalId === event.externalId && evt.type === event.type && evt.timestamp === event.timestamp)
        );
      }
      return day;
    }).filter((day): boolean => Boolean(day.events && day.events.length > 0));

    await writeUserJourney(updated);
    setMenu(null);
    setJourney(updated);

    // This user action changes the local source of truth and must also update
    // the Worker snapshot that powers Home's General feed. The existing sync
    // endpoint replaces the profile snapshot (including its activity list).
    const session = await getAuthToken().catch(() => null);
    if (!session || session.token === 'offline_token') return;

    const payload = decodeJwtPayload(session.token);
    if (typeof payload.userId !== 'string') return;

    removeCachedGeneralActivity(payload.userId, event);
    let synced = false;
    try {
      const { syncProfileToServer } = await import('../../lib/social/profile-sync');
      synced = await syncProfileToServer(true);
    } catch { /* a failed upload keeps the Home prompt available for retry */ }
    if (synced) {
      await refreshGeneralActivityFeed(true);
    } else {
      // Let the daily Home prompt retry the now-dirty local snapshot.
      localStorage.removeItem(STORAGE_KEYS.profileSyncLastSync);
      console.warn('[Activity] Removed locally, but the Worker snapshot could not be updated.');
    }
  };

  if (journey === null) return null;

  if (finalEvents.length === 0) {
    return <div className={`act-empty${visible ? ' act-visible' : ''}`}><span>{p.no_activity}</span></div>;
  }

  return (
    <div className={`activity-feed${visible ? ' act-visible' : ''}`}>
      <div className="act-day-events">
        {finalEvents.map(event => {
          if (!event || !event.externalId) return null;
          const meta = catalogMap.get(event.externalId);
          const title = meta?.title_main ?? event.externalId;
          const cover = toSmallCover(meta?.cover_url);
          const mType = event.mediaType || 'book';

          let text = '';
          if (event.type === 'complete') {
            text = interpolate(j.completed || 'Completed {media}', { media: title });
          }

          const typeIc = TYPE_ICON[mType] ?? '';
          const typeLabelText = getTypeLabel(mType);
          const fallbackBg = HOF_GRADIENTS[mType] || 'linear-gradient(160deg, #374151 0%, #1f2937 100%)';
          // text embeds the title as a bolded fragment — the template comes
          // from user-configurable i18n strings with a single {media}
          // placeholder, not arbitrary HTML, so this stays a plain string
          // split around the title rather than dangerouslySetInnerHTML.
          const titleIdx = text.indexOf(title);
          const textNode = titleIdx === -1
            ? text
            : <>{text.slice(0, titleIdx)}<strong className="act-card-bold-title">{title}</strong>{text.slice(titleIdx + title.length)}</>;

          return (
            <div
              className="act-card"
              key={`${event.date}_${event.externalId}_${event.type}_${event.timestamp}`}
              onContextMenu={readOnly ? undefined : e => {
                e.preventDefault();
                e.stopPropagation();
                setMenu({ x: e.pageX, y: e.pageY, event });
              }}
            >
              <a className="act-card-link" href={`/media?id=${encodeURIComponent(event.externalId)}`} />
              {cover ? (
                <img className="act-card-cover" src={cover} alt={title} loading="lazy" decoding="async" />
              ) : (
                <div className="act-card-cover-fallback" style={{ background: fallbackBg }}>
                  <span>{title.slice(0, 1).toUpperCase()}</span>
                </div>
              )}
              <div className="act-card-content">
                <span className="act-card-text">{textNode}</span>
                <div className="act-card-meta">
                  <span className="act-card-type-icon" dangerouslySetInnerHTML={{ __html: typeIc }} />
                  <span className="act-card-type-label">{typeLabelText}</span>
                  <span className="act-card-date">{event.formattedDate}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {menu && createPortal(
        // Portaled to <body>, matching the old imperative version — the
        // .act-context-menu CSS class is already position:absolute, which
        // needs to resolve against the document (pageX/pageY), not whatever
        // positioned ancestor this component happens to render under.
        <div className="act-context-menu" style={{ top: menu.y, left: menu.x }} onClick={e => e.stopPropagation()}>
          <button
            type="button"
            className="context-menu-item act-context-menu-item delete"
            onClick={() => handleDelete(menu.event)}
          >
            <span style={{ marginRight: 6, display: 'inline-flex' }}><IconTrash /></span>
            <span>{p.activity_delete}</span>
          </button>
        </div>,
        document.body
      )}
    </div>
  );
}
