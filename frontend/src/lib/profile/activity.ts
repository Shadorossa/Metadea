import { readUserJourney, writeUserJourney } from '../tauri';

type P = any;

const TYPE_LABELS: Record<string, string> = {
  anime: "Anime",
  manga: "Manga",
  novel: "Novela Ligera",
  game: "Videojuego",
  vnovel: "Novela Visual",
  series: "Serie",
  movie: "Película",
  book: "Libro"
};

const TYPE_ICON: Record<string, string> = {
  game:   `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="20" height="12" rx="4"/><path d="M6 12h4m-2-2v4"/><circle cx="16" cy="11" r="1" fill="currentColor" stroke="none"/><circle cx="18" cy="13" r="1" fill="currentColor" stroke="none"/></svg>`,
  anime:  `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`,
  manga:  `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>`,
  novel:  `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>`,
  vnovel: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="20" height="12" rx="4"/><path d="M6 12h4m-2-2v4"/><circle cx="15" cy="12" r="1.5" fill="currentColor" stroke="none"/></svg>`,
  series: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="15" rx="2"/><path d="M17 2l-5 5-5-5"/></svg>`,
  movie:  `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="20" rx="2"/><path d="M7 2v20M17 2v20M2 12h20M2 7h5M17 7h5M2 17h5M17 17h5"/></svg>`,
  book:   `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>`,
};

const FALLBACK_GRADIENTS: Record<string, string> = {
  anime:  'linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)',
  manga:  'linear-gradient(135deg, #ec4899 0%, #be185d 100%)',
  novel:  'linear-gradient(135deg, #10b981 0%, #047857 100%)',
  game:   'linear-gradient(135deg, #f59e0b 0%, #b45309 100%)',
  vnovel: 'linear-gradient(135deg, #8b5cf6 0%, #6d28d9 100%)',
  series: 'linear-gradient(135deg, #ef4444 0%, #b91c1c 100%)',
  movie:  'linear-gradient(135deg, #6366f1 0%, #4338ca 100%)',
  book:   'linear-gradient(135deg, #6b7280 0%, #374151 100%)',
};

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

export async function buildActivityHtml(catalogMap: Map<string, any>, p: P): Promise<string> {
  const journey = await readUserJourney();
  const j = p.journey || {};

  const journeyArr = Array.isArray(journey) ? journey : [];
  const daysWithEvents = journeyArr.filter(day => day && day.date && day.events && day.events.length > 0).slice(0, 7);

  if (daysWithEvents.length === 0) {
    return `<div class="act-empty"><span>${p.no_activity}</span></div>`;
  }

  // Flatten days and their events so we can render them in a clean grid
  const allEvents = daysWithEvents.flatMap(day => {
    const formattedDate = formatDay(day.date);
    return (day.events || []).filter(Boolean).map(event => ({
      ...event,
      date: day.date,
      formattedDate
    }));
  });

  const eventCards = allEvents.map(event => {
    if (!event || !event.externalId) return '';
    const meta = catalogMap.get(event.externalId);
    const title = meta?.title_main ?? event.externalId;
    const cover = meta?.cover_url ?? '';
    
    const mediaNameBold = `<strong class="act-card-bold-title">${title}</strong>`;
    const mType = event.mediaType || 'book';
    
    let text = '';
    if (event.type === 'start') {
      text = interpolate(j.started || 'Started {media}', { media: mediaNameBold });
    } else if (event.type === 'complete') {
      text = interpolate(j.completed || 'Completed {media}', { media: mediaNameBold });
    } else if (event.type === 'progress') {
      const start = event.progressStart ?? 0;
      const end = event.progressEnd ?? 0;
      const isSingle = start === end;
      
      if (mType === 'anime' || mType === 'series') {
        const tmpl = isSingle ? (j.watched_episode || 'Watched episode {end} of {media}') : (j.watched_episodes || 'Watched episodes {start}-{end} of {media}');
        text = interpolate(tmpl, { media: mediaNameBold, start, end });
      } else if (mType === 'manga' || mType === 'novel' || mType === 'book') {
        const tmpl = isSingle ? (j.read_chapter || 'Read chapter {end} of {media}') : (j.read_chapters || 'Read chapters {start}-{end} of {media}');
        text = interpolate(tmpl, { media: mediaNameBold, start, end });
      } else if (mType === 'game' || mType === 'vnovel') {
        const tmpl = isSingle ? (j.played_hour || 'Played {end} hours of {media}') : (j.played_hours || 'Played {start}-{end} hours of {media}');
        text = interpolate(tmpl, { media: mediaNameBold, start, end });
      } else {
        text = interpolate(j.updated || 'Updated {media}', { media: mediaNameBold });
      }
    }

    const typeIc = TYPE_ICON[mType] ?? '';
    const typeLabelText = TYPE_LABELS[mType] || mType;
    const fallbackBg = FALLBACK_GRADIENTS[mType] || 'linear-gradient(135deg, #374151 0%, #1f2937 100%)';
    
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

export function initActivityListeners(el: HTMLElement, catalogMap: Map<string, any>, p: any) {
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
        const updated = journey.map((day: any) => {
          if (day.date === date) {
            day.events = (day.events || []).filter((evt: any) => 
              !(evt.externalId === externalId && evt.type === type && evt.timestamp === timestamp)
            );
          }
          return day;
        }).filter((day: any) => day.events && day.events.length > 0);
        
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
