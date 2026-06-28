import { getAllLibraryEntries, getAllCatalogEntries, readMonthlyHistory } from '../tauri';
import type { MediaCatalogEntry } from '../tauri';
import { pad, typeLabel, statusLabel } from './utils';
import { getT } from '../../i18n/client';
import { buildHofHtml, initHofListeners } from './hof';
import { buildMonthlyHistoryHtml } from './monthly';
import { buildActivityHtml } from './activity';

type Items = Awaited<ReturnType<typeof getAllLibraryEntries>>;

export async function renderOverview(el: HTMLElement, items: Items): Promise<void> {
  const t = getT();
  const p = t.profile;

  const catalogEntries = await getAllCatalogEntries().catch(() => [] as MediaCatalogEntry[]);
  const catalogMap = new Map<string, MediaCatalogEntry>(
    catalogEntries.map(e => [e.external_id, e])
  );

  const monthlyHistory = await readMonthlyHistory().catch(() => ({}));

  let completed = 0, inProgress = 0, planning = 0, dropped = 0;
  let totalRating = 0, ratedCount = 0, totalMinutes = 0;
  const completedByType: Record<string, number> = {};

  for (const item of items) {
    const s = item.status ?? 'planning';
    if (s === 'completed') {
      completed++;
      completedByType[item.type] = (completedByType[item.type] ?? 0) + 1;
    }
    else if (s === 'watching' || s === 'playing' || s === 'reading') inProgress++;
    else if (s === 'planning') planning++;
    else if (s === 'dropped') dropped++;

    if (item.rating)         { totalRating += item.rating; ratedCount++; }
    if (item.minutes_spent)    totalMinutes += item.minutes_spent;
  }

  const avgRating  = ratedCount > 0 ? (totalRating / ratedCount).toFixed(1) : '0.0';
  const totalHours = Math.round(totalMinutes / 60);

  const completedTooltipHtml = `
    <span class="stat-help-wrap">
      <span class="stat-help-icon">?</span>
      <span class="stat-tooltip">
        ${Object.entries(completedByType).length > 0 
          ? Object.entries(completedByType).map(([type, count]) => `
              <span class="stat-tooltip-row">
                <span class="stat-tooltip-label">${typeLabel(type)}</span>
                <span class="stat-tooltip-value">${count}</span>
              </span>
            `).join('')
          : `<span class="stat-tooltip-row"><span class="stat-tooltip-label">Ninguno</span></span>`
        }
      </span>
    </span>
  `;

  const statsHtml = `
    <div class="profile-stats-bar">
      ${([
        [p.stat_total,     pad(items.length)],
        [p.stat_progress,  pad(inProgress)],
        [p.stat_completed, pad(completed)],
        [p.stat_pending,   pad(planning)],
        [p.stat_dropped,   pad(dropped)],
        [p.stat_avg,       avgRating],
        [p.stat_hours,     totalHours + 'h'],
      ] as [string, string][]).map(([label, value]) =>
        `<div class="profile-stat">
           <span class="profile-stat-value">${value}</span>
           <span class="profile-stat-label">
             ${label}
             ${label === p.stat_completed ? completedTooltipHtml : ''}
           </span>
         </div>`
      ).join('')}
    </div>`;

  const bottomHtml = `
    <div class="profile-bottom-grid">
      <div class="profile-bottom-col">
        <p class="profile-section-label">${p.monthly_history}</p>
        ${buildMonthlyHistoryHtml(monthlyHistory, items, catalogMap)}
      </div>
      <div class="profile-bottom-col">
        <p class="profile-section-label">${p.recent_activity}</p>
        ${buildActivityHtml(items, catalogMap, p)}
      </div>
    </div>`;

  el.innerHTML = buildHofHtml(items, catalogMap, p) + statsHtml + bottomHtml;
  initHofListeners(el);
}

const TYPE_ICON: Record<string, string> = {
  game:   `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="20" height="12" rx="4"/><path d="M6 12h4m-2-2v4"/><circle cx="16" cy="11" r="1" fill="currentColor" stroke="none"/><circle cx="18" cy="13" r="1" fill="currentColor" stroke="none"/></svg>`,
  anime:  `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`,
  manga:  `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>`,
  novel:  `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>`,
  vnovel: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="20" height="12" rx="4"/><path d="M6 12h4m-2-2v4"/><circle cx="15" cy="12" r="1.5" fill="currentColor" stroke="none"/></svg>`,
  series: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="15" rx="2"/><path d="M17 2l-5 5-5-5"/></svg>`,
  movie:  `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="20" rx="2"/><path d="M7 2v20M17 2v20M2 12h20M2 7h5M17 7h5M2 17h5M17 17h5"/></svg>`,
  book:   `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>`,
};

const CALENDAR_ICON = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>`;

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

const STAR_FULL  = `<svg width="14" height="14" viewBox="0 0 24 24" fill="#fbbf24" stroke="#fbbf24" stroke-width="1"><path d="M12 17.75l-6.172 3.245 1.179-6.873-4.993-4.867 6.9-1.002L12 2l3.086 6.253 6.9 1.002-4.993 4.867 1.179 6.873z"/></svg>`;
const STAR_HALF  = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fbbf24" stroke-width="1.5"><defs><clipPath id="h"><rect x="0" y="0" width="12" height="24"/></clipPath></defs><path d="M12 17.75l-6.172 3.245 1.179-6.873-4.993-4.867 6.9-1.002L12 2l3.086 6.253 6.9 1.002-4.993 4.867 1.179 6.873z" stroke="#fbbf24"/><path d="M12 17.75l-6.172 3.245 1.179-6.873-4.993-4.867 6.9-1.002L12 2l3.086 6.253 6.9 1.002-4.993 4.867 1.179 6.873z" fill="#fbbf24" clip-path="url(#h)"/></svg>`;
const STAR_EMPTY = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fbbf2466" stroke-width="1.5"><path d="M12 17.75l-6.172 3.245 1.179-6.873-4.993-4.867 6.9-1.002L12 2l3.086 6.253 6.9 1.002-4.993 4.867 1.179 6.873z"/></svg>`;

function buildRatingHtml(rating: number | null | undefined): string {
  if (!rating) return '<span class="library-card-rating"></span>';
  // rating is 0-10, display as 0-5 stars
  const stars5 = rating / 2;
  let html = '';
  for (let i = 1; i <= 5; i++) {
    if (stars5 >= i)        html += STAR_FULL;
    else if (stars5 >= i - 0.5) html += STAR_HALF;
    else                    html += STAR_EMPTY;
  }
  return `<span class="library-card-rating">${html}</span>`;
}

function buildDateHtml(started: string | null | undefined, finished: string | null | undefined): string {
  if (!started && !finished) return '';
  const parts: string[] = [];
  if (started)  parts.push(fmtDate(started));
  if (finished) parts.push(fmtDate(finished));
  return `<span class="library-card-date">${CALENDAR_ICON}${parts.join(' → ')}</span>`;
}

export async function renderLibrary(el: HTMLElement): Promise<void> {
  const p = getT().profile;
  const [items, catalogEntries] = await Promise.all([
    getAllLibraryEntries().catch(() => []),
    getAllCatalogEntries().catch(() => [] as MediaCatalogEntry[]),
  ]);

  if (items.length === 0) {
    el.innerHTML = `
      <div class="profile-empty">
        <span class="profile-empty-icon">📚</span>
        <p>${p.empty}</p>
        <a href="/search">${p.empty_cta}</a>
      </div>`;
    return;
  }

  const catalogMap = new Map<string, MediaCatalogEntry>(
    catalogEntries.map(e => [e.external_id, e])
  );

  const STATUS_LIST = [
    { key: '', label: 'Todos' },
    { key: 'planning', label: p.status_planning },
    { key: 'in_progress', label: 'En progreso' },
    { key: 'completed', label: p.status_completed },
    { key: 'paused', label: p.status_paused },
    { key: 'dropped', label: p.status_dropped }
  ];
  let currentStatusIndex = 0;
  let selectedTypes: string[] = [];

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

  el.innerHTML = `
    <div class="library-layout">
      <aside class="library-filters">
        <p class="library-filters-title">Filtros</p>

        <div class="library-filter-group">
          <label class="library-filter-label" for="filter-name">Nombre</label>
          <input type="text" id="filter-name" class="library-filter-input" placeholder="Buscar por título..." />
        </div>

        <div class="library-filter-group">
          <label class="library-filter-label">Tipo de Medio</label>
          <div class="library-type-filters">
            ${Object.entries(TYPE_ICON).map(([type, svg]) => `
              <button type="button" class="library-type-btn" data-value="${type}" title="${TYPE_LABELS[type] || type}">
                ${svg}
              </button>
            `).join('')}
          </div>
        </div>

        <div class="library-filter-group">
          <label class="library-filter-label">Estado</label>
          <div class="library-status-cycler">
            <button type="button" class="library-status-arrow" id="status-prev">&lt;</button>
            <span class="library-status-val" id="status-val">Todos</span>
            <button type="button" class="library-status-arrow" id="status-next">&gt;</button>
          </div>
        </div>
      </aside>

      <div class="library-content"></div>
    </div>
  `;

  const filterName   = el.querySelector('#filter-name') as HTMLInputElement | null;
  const statusValEl  = el.querySelector('#status-val') as HTMLElement | null;
  const btnPrev      = el.querySelector('#status-prev') as HTMLButtonElement | null;
  const btnNext      = el.querySelector('#status-next') as HTMLButtonElement | null;
  const contentEl    = el.querySelector('.library-content') as HTMLElement | null;
  const typeBtns     = el.querySelectorAll('.library-type-btn');

  const applyFilters = () => {
    if (!contentEl) return;
    const nameVal   = filterName?.value.toLowerCase().trim() || '';
    const statusKey = STATUS_LIST[currentStatusIndex].key;

    const filtered = items.filter(item => {
      const meta = catalogMap.get(item.external_id);
      const title = (meta?.title_main ?? item.external_id).toLowerCase();

      if (nameVal && !title.includes(nameVal)) return false;
      if (selectedTypes.length > 0 && !selectedTypes.includes(item.type)) return false;
      if (statusKey) {
        if (statusKey === 'in_progress') {
          if (item.status !== 'watching' && item.status !== 'reading' && item.status !== 'playing') {
            return false;
          }
        } else {
          if (item.status !== statusKey) return false;
        }
      }
      return true;
    });

    if (filtered.length === 0) {
      contentEl.innerHTML = `<div class="library-empty-filtered">Sin resultados para los filtros aplicados</div>`;
      return;
    }

    const inProgress = filtered.filter(item => item.status === 'watching' || item.status === 'reading' || item.status === 'playing');
    const completed  = filtered.filter(item => item.status === 'completed');
    const planning   = filtered.filter(item => item.status === 'planning');
    const paused     = filtered.filter(item => item.status === 'paused');
    const dropped    = filtered.filter(item => item.status === 'dropped');

    const sectionsData = [
      { title: p.section_in_progress, items: inProgress },
      { title: p.section_completed, items: completed },
      { title: p.section_planning, items: planning },
      { title: p.section_paused, items: paused },
      { title: p.section_dropped, items: dropped },
    ];

    contentEl.innerHTML = sectionsData
      .filter(sec => sec.items.length > 0)
      .map(sec => `
        <div class="library-section">
          <h3 class="library-section-title">${sec.title}</h3>
          <div class="library-grid">
            ${sec.items.map(item => {
              const meta     = catalogMap.get(item.external_id);
              const title    = meta?.title_main ?? item.external_id;
              const cover    = meta?.cover_url ?? '';
              const typeIc   = TYPE_ICON[item.type] ?? TYPE_ICON['book'];
              const mediaUrl = `/media?id=${encodeURIComponent(item.external_id)}`;
              const style    = cover ? `style="--cover: url('${cover}')"` : '';

              return `
                <div class="library-card" data-id="${item.external_id}" ${style}>
                  ${cover ? `<div class="library-card-bg"></div>` : ''}
                  <a class="library-card-thumb" href="${mediaUrl}" onclick="event.stopPropagation()">
                    ${cover
                      ? `<img src="${cover}" alt="${title}" loading="lazy" />`
                      : `<div class="library-card-no-cover"><span>${title.slice(0, 2).toUpperCase()}</span></div>`
                    }
                  </a>
                  <div class="library-card-info">
                    <span class="library-card-title">${title}</span>
                    ${buildRatingHtml(item.rating)}
                    <div class="library-card-footer">
                      ${buildDateHtml(item.started_at, item.finished_at)}
                      <span class="library-card-type">${typeIc}</span>
                    </div>
                  </div>
                </div>`;
            }).join('')}
          </div>
        </div>
      `).join('');
  };

  typeBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const type = (btn as HTMLElement).dataset.value || '';
      if (selectedTypes.includes(type)) {
        selectedTypes = selectedTypes.filter(t => t !== type);
        btn.classList.remove('active');
      } else {
        selectedTypes.push(type);
        btn.classList.add('active');
      }
      applyFilters();
    });
  });

  btnPrev?.addEventListener('click', () => {
    currentStatusIndex = (currentStatusIndex - 1 + STATUS_LIST.length) % STATUS_LIST.length;
    if (statusValEl) statusValEl.textContent = STATUS_LIST[currentStatusIndex].label;
    applyFilters();
  });

  btnNext?.addEventListener('click', () => {
    currentStatusIndex = (currentStatusIndex + 1) % STATUS_LIST.length;
    if (statusValEl) statusValEl.textContent = STATUS_LIST[currentStatusIndex].label;
    applyFilters();
  });

  filterName?.addEventListener('input', applyFilters);

  applyFilters();
}

export function renderStats(el: HTMLElement): void {
  const p = getT().profile;
  el.innerHTML = `<div class="profile-coming-soon"><p>📊 ${p.coming_soon}</p></div>`;
}
