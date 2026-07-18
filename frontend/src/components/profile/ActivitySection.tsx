import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { readUserJourney, writeUserJourney } from '../../lib/tauri';
import type { DayJourney, UserJourneyEvent, MediaCatalogEntry } from '../../lib/tauri';
import { typeIconMap } from '../../lib/shared/icon-strings';
import { TYPE_LABELS } from '../../lib/constants/media';
import { HOF_GRADIENTS } from '../../lib/profile/hof';
import { STORAGE_KEYS } from '../../lib/shared/storage-keys';
import type { getT } from '../../i18n/client';
import { formatDateLong } from '../../lib/shared/formatDate';

type P = ReturnType<typeof getT>['profile'];

interface ActivityEvent extends UserJourneyEvent {
  date: string;
  formattedDate: string;
}

const TYPE_ICON = typeIconMap(12);

function formatDay(dateStr: string | null | undefined): string {
  if (!dateStr) return '';
  const parts = dateStr.split('-');
  if (parts.length !== 3) return dateStr;
  const [year, month, day] = parts;
  const date = new Date(Number(year), Number(month) - 1, Number(day));
  return formatDateLong(date);
}

function interpolate(template: string, vars: Record<string, string | number>): string {
  return Object.entries(vars).reduce((acc, [key, val]) => acc.replace(`{${key}}`, String(val)), template);
}

interface Props {
  catalogMap: Map<string, MediaCatalogEntry>;
  p: P;
}

interface ContextMenuState {
  x: number;
  y: number;
  event: ActivityEvent;
}

export function ActivitySection({ catalogMap, p }: Props) {
  const [journey, setJourney] = useState<DayJourney[] | null>(null);
  const [menu, setMenu] = useState<ContextMenuState | null>(null);
  const j = p.journey || {};

  useEffect(() => {
    let cancelled = false;
    readUserJourney().then(res => { if (!cancelled) setJourney(Array.isArray(res) ? res : []); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [menu]);

  const finalEvents = useMemo<ActivityEvent[]>(() => {
    if (!journey) return [];
    const daysWithEvents = journey.filter(day => day && day.date && day.events && day.events.length > 0).slice(0, 7);

    // Flatten and filter events: no 'start' events, no hours (game/vnovel progress)
    const allEvents: ActivityEvent[] = daysWithEvents.flatMap(day => {
      const formattedDate = formatDay(day.date);
      return (day.events || [])
        .filter(Boolean)
        .filter(event => event.type !== 'start')
        .filter(event => !(event.type === 'progress' && (event.mediaType === 'game' || event.mediaType === 'vnovel')))
        .map(event => ({ ...event, date: day.date, formattedDate }));
    });

    // Optionally batch progress events by date and media
    const batchEpisodes = typeof localStorage !== 'undefined'
      ? localStorage.getItem(STORAGE_KEYS.activityBatchEpisodes) === 'true'
      : true;

    if (!batchEpisodes) {
      return allEvents.filter(event => event.type !== 'progress');
    }

    const groupedEvents: ActivityEvent[] = [];
    const progressByDateAndMedia = new Map<string, ActivityEvent>();
    for (const event of allEvents) {
      if (event.type === 'progress') {
        const key = `${event.date}_${event.externalId}`;
        const existing = progressByDateAndMedia.get(key);
        if (existing) {
          existing.progressEnd = event.progressEnd;
          existing.timestamp = event.timestamp;
        } else {
          progressByDateAndMedia.set(key, event);
          groupedEvents.push(event);
        }
      } else {
        groupedEvents.push(event);
      }
    }
    return groupedEvents;
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
  };

  if (journey === null) return null;

  if (finalEvents.length === 0) {
    return <div className="act-empty"><span>{p.no_activity}</span></div>;
  }

  return (
    <div className="activity-feed">
      <div className="act-day-events">
        {finalEvents.map(event => {
          if (!event || !event.externalId) return null;
          const meta = catalogMap.get(event.externalId);
          const title = meta?.title_main ?? event.externalId;
          const cover = meta?.cover_url ?? '';
          const mType = event.mediaType || 'book';

          let text = '';
          if (event.type === 'complete') {
            text = interpolate(j.completed || 'Completed {media}', { media: title });
          } else if (event.type === 'progress') {
            const start = event.progressStart ?? 0;
            const end = event.progressEnd ?? 0;
            const isSingle = start === end;

            if (mType === 'anime' || mType === 'series') {
              const tmpl = isSingle ? (j.watched_episode || 'Watched episode {end} of {media}') : (j.watched_episodes || 'Watched episodes {start}-{end} of {media}');
              text = interpolate(tmpl, { media: title, start, end });
            } else if (mType === 'manga' || mType === 'lnovel' || mType === 'book' || mType === 'comic') {
              const tmpl = isSingle ? (j.read_chapter || 'Read chapter {end} of {media}') : (j.read_chapters || 'Read chapters {start}-{end} of {media}');
              text = interpolate(tmpl, { media: title, start, end });
            } else {
              text = interpolate(j.updated || 'Updated {media}', { media: title });
            }
          }

          const typeIc = TYPE_ICON[mType] ?? '';
          const typeLabelText = TYPE_LABELS[mType] || mType;
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
              onContextMenu={e => {
                e.preventDefault();
                e.stopPropagation();
                setMenu({ x: e.pageX, y: e.pageY, event });
              }}
            >
              <a className="act-card-link" href={`/media?id=${encodeURIComponent(event.externalId)}`} />
              {cover ? (
                <img className="act-card-cover" src={cover} alt={title} loading="lazy" />
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
            className="act-context-menu-item delete"
            onClick={() => handleDelete(menu.event)}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 6 }}>
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              <line x1="10" y1="11" x2="10" y2="17" />
              <line x1="14" y1="11" x2="14" y2="17" />
            </svg>
            <span>Eliminar actividad</span>
          </button>
        </div>,
        document.body
      )}
    </div>
  );
}
