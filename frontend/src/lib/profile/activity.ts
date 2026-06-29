import { readUserJourney } from '../tauri';

type P = any;

function formatDay(dateStr: string): string {
  const [year, month, day] = dateStr.split('-');
  const date = new Date(Number(year), Number(month) - 1, Number(day));
  return date.toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' });
}

function interpolate(template: string, vars: Record<string, string | number>): string {
  return Object.entries(vars).reduce((acc, [key, val]) => acc.replace(`{${key}}`, String(val)), template);
}

export async function buildActivityHtml(catalogMap: Map<string, any>, p: P): Promise<string> {
  const journey = await readUserJourney();
  const j = p.journey || {};

  // Filter out days that have no events
  const daysWithEvents = journey.filter(day => day.events && day.events.length > 0).slice(0, 7);

  if (daysWithEvents.length === 0) {
    return `<div class="act-empty"><span>${p.no_activity}</span></div>`;
  }

  const sections = daysWithEvents.map(day => {
    const formattedDate = formatDay(day.date);
    
    const eventRows = day.events.map(event => {
      const meta = catalogMap.get(event.externalId);
      const title = meta?.title_main ?? event.externalId;
      const link = `<a href="/media?id=${encodeURIComponent(event.externalId)}" style="color: var(--accent); font-weight: 700; text-decoration: underline;" class="act-link">${title}</a>`;
      
      let text = '';
      if (event.type === 'start') {
        text = interpolate(j.started || 'Started {media}', { media: link });
      } else if (event.type === 'complete') {
        text = interpolate(j.completed || 'Completed {media}', { media: link });
      } else if (event.type === 'progress') {
        const start = event.progressStart ?? 0;
        const end = event.progressEnd ?? 0;
        const isSingle = start === end;
        
        if (event.mediaType === 'anime' || event.mediaType === 'series') {
          const tmpl = isSingle ? (j.watched_episode || 'Watched episode {end} of {media}') : (j.watched_episodes || 'Watched episodes {start}-{end} of {media}');
          text = interpolate(tmpl, { media: link, start, end });
        } else if (event.mediaType === 'manga' || event.mediaType === 'novel' || event.mediaType === 'book') {
          const tmpl = isSingle ? (j.read_chapter || 'Read chapter {end} of {media}') : (j.read_chapters || 'Read chapters {start}-{end} of {media}');
          text = interpolate(tmpl, { media: link, start, end });
        } else if (event.mediaType === 'game' || event.mediaType === 'vnovel') {
          const tmpl = isSingle ? (j.played_hour || 'Played {end} hours of {media}') : (j.played_hours || 'Played {start}-{end} hours of {media}');
          text = interpolate(tmpl, { media: link, start, end });
        } else {
          text = interpolate(j.updated || 'Updated {media}', { media: link });
        }
      }
      
      return `<div class="act-event-row" style="font-size: 0.8rem; color: var(--text-muted); margin-bottom: 0.25rem;">
        • ${text}
      </div>`;
    }).join('');

    return `
      <div class="act-day-section" style="margin-bottom: 1.25rem;">
        <span class="act-day-title" style="font-size: 0.72rem; font-weight: 800; color: var(--accent); margin-bottom: 0.5rem; display: block; text-transform: uppercase; letter-spacing: 0.05em;">
          ${formattedDate}
        </span>
        <div class="act-day-events" style="display: flex; flex-direction: column; padding-left: 0.5rem; border-left: 2px solid var(--border-color);">
          ${eventRows}
        </div>
      </div>
    `;
  }).join('');

  return `<div class="activity-feed">${sections}</div>`;
}
