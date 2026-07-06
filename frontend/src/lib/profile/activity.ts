import { readUserJourney, writeUserJourney } from '../tauri';
import type { DayJourney, UserJourneyEvent, MediaCatalogEntry } from '../tauri';
import { typeIconMap } from '../shared/icon-strings';
import { TYPE_LABELS, TYPE_GRADIENTS } from '../constants/media';
import { STORAGE_KEYS } from '../shared/storage-keys';
import type { getT } from '../../i18n/client';

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
  return date.toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' });
}

function interpolate(template: string, vars: Record<string, string | number>): string {
  return Object.entries(vars).reduce((acc, [key, val]) => acc.replace(`{${key}}`, String(val)), template);
}

export async function buildActivityHtml(catalogMap: Map<string, MediaCatalogEntry>, p: P): Promise<string> {
  const journey = await readUserJourney();
  const j = p.journey || {};

  const journeyArr: DayJourney[] = Array.isArray(journey) ? journey : [];
  const daysWithEvents = journeyArr.filter(day => day && day.date && day.events && day.events.length > 0).slice(0, 7);

  if (daysWithEvents.length === 0) {
    return `<div class="act-empty"><span>${p.no_activity}</span></div>`;
  }

  // Flatten and filter events: no 'start' events, no hours (game/vnovel progress)
  const allEvents = daysWithEvents.flatMap(day => {
    const formattedDate = formatDay(day.date);
    return (day.events || [])
      .filter(Boolean)
      .filter(event => event.type !== 'start') // Remove start events
      .filter(event => {
        // Remove hours-based progress (game/vnovel)
        if (event.type === 'progress' && (event.mediaType === 'game' || event.mediaType === 'vnovel')) {
          return false;
        }
        return true;
      })
      .map(event => ({
        ...event,
        date: day.date,
        formattedDate
      }));
  });

  // Optionally show progress events by date and media (batch them)
  const batchEpisodes = typeof localStorage !== 'undefined'
    ? localStorage.getItem(STORAGE_KEYS.activityBatchEpisodes) === 'true'
    : true; // Default: true (batched)

  let finalEvents: typeof allEvents;

  if (batchEpisodes) {
    // Group progress events by date and media
    const groupedEvents: typeof allEvents = [];
    const progressByDateAndMedia = new Map<string, ActivityEvent>();

    for (const event of allEvents) {
      if (event.type === 'progress') {
        const key = `${event.date}_${event.externalId}`;
        if (progressByDateAndMedia.has(key)) {
          // Merge with existing progress for this date+media
          const existing = progressByDateAndMedia.get(key)!;
          existing.progressEnd = event.progressEnd;
          existing.timestamp = event.timestamp;
        } else {
          progressByDateAndMedia.set(key, event);
          groupedEvents.push(event);
        }
      } else {
        // Non-progress events (complete) are not grouped
        groupedEvents.push(event);
      }
    }
    finalEvents = groupedEvents;
  } else {
    // Show only 'complete' events, filter out all progress events
    finalEvents = allEvents.filter(event => event.type !== 'progress');
  }

  const eventCards = finalEvents.map(event => {
    if (!event || !event.externalId) return '';
    const meta = catalogMap.get(event.externalId);
    const title = meta?.title_main ?? event.externalId;
    const cover = meta?.cover_url ?? '';

    const mediaNameBold = `<strong class="act-card-bold-title">${title}</strong>`;
    const mType = event.mediaType || 'book';

    let text = '';
    if (event.type === 'complete') {
      text = interpolate(j.completed || 'Completed {media}', { media: mediaNameBold });
    } else if (event.type === 'progress') {
      const start = event.progressStart ?? 0;
      const end = event.progressEnd ?? 0;
      const isSingle = start === end;

      if (mType === 'anime' || mType === 'series') {
        const tmpl = isSingle ? (j.watched_episode || 'Watched episode {end} of {media}') : (j.watched_episodes || 'Watched episodes {start}-{end} of {media}');
        text = interpolate(tmpl, { media: mediaNameBold, start, end });
      } else if (mType === 'manga' || mType === 'lnovel' || mType === 'book') {
        const tmpl = isSingle ? (j.read_chapter || 'Read chapter {end} of {media}') : (j.read_chapters || 'Read chapters {start}-{end} of {media}');
        text = interpolate(tmpl, { media: mediaNameBold, start, end });
      } else {
        text = interpolate(j.updated || 'Updated {media}', { media: mediaNameBold });
      }
    }

    const typeIc = TYPE_ICON[mType] ?? '';
    const typeLabelText = TYPE_LABELS[mType] || mType;
    const fallbackBg = TYPE_GRADIENTS[mType] || 'linear-gradient(135deg, #374151 0%, #1f2937 100%)';

    return `
      <div class="act-card" data-date="${event.date}" data-id="${event.externalId}" data-type="${event.type}" data-timestamp="${event.timestamp}">
        <a class="act-card-link" href="/media?id=${encodeURIComponent(event.externalId)}"></a>
        ${cover
          ? `<img class="act-card-cover" src="${cover}" alt="${title}" loading="lazy" />`
          : `<div class="act-card-cover-fallback" style="background:${fallbackBg}"><span>${title.slice(0, 1).toUpperCase()}</span></div>`
        }
        <div class="act-card-content">
          <span class="act-card-text">${text}</span>
          <div class="act-card-meta">
            <span class="act-card-type-icon">${typeIc}</span>
            <span class="act-card-type-label">${typeLabelText}</span>
            <span class="act-card-date">${event.formattedDate}</span>
          </div>
        </div>
      </div>
    `;
  }).join('');

  return `
    <div class="activity-feed">
      <div class="act-day-events">
        ${eventCards}
      </div>
    </div>
  `;
}

export function initActivityListeners(el: HTMLElement, catalogMap: Map<string, MediaCatalogEntry>, p: P) {
  const removeMenu = () => {
    const existing = document.getElementById('act-ctx-menu');
    if (existing) existing.remove();
  };
  
  document.removeEventListener('click', removeMenu);
  document.addEventListener('click', removeMenu);
  
  el.querySelectorAll<HTMLElement>('.act-card').forEach(card => {
    card.addEventListener('contextmenu', (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      
      removeMenu();
      
      const date = card.dataset.date || '';
      const externalId = card.dataset.id || '';
      const type = card.dataset.type || '';
      const timestamp = card.dataset.timestamp || '';
      
      const menu = document.createElement('div');
      menu.id = 'act-ctx-menu';
      menu.className = 'act-context-menu';
      menu.style.top = `${e.pageY}px`;
      menu.style.left = `${e.pageX}px`;
      
      const btn = document.createElement('button');
      btn.className = 'act-context-menu-item delete';
      btn.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 6px;"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
        <span>Eliminar actividad</span>
      `;
      
      btn.addEventListener('click', async () => {
        const journey = await readUserJourney();
        const updated = journey.map((day): DayJourney => {
          if (day.date === date) {
            day.events = (day.events || []).filter(evt =>
              !(evt.externalId === externalId && evt.type === type && evt.timestamp === timestamp)
            );
          }
          return day;
        }).filter((day): boolean => day.events && day.events.length > 0);
        
        await writeUserJourney(updated);
        
        // Re-render only the activity feed block
        const container = el.querySelector('.activity-feed');
        if (container) {
          const parent = container.parentElement!;
          parent.innerHTML = await buildActivityHtml(catalogMap, p);
          initActivityListeners(el, catalogMap, p);
        }
      });
      
      menu.appendChild(btn);
      document.body.appendChild(menu);
    });
  });
}
