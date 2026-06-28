import { getAllLibraryEntries, getAllCatalogEntries, readMonthlyHistory, readUserFavorites, writeUserFavorites } from '../tauri';
import type { MediaCatalogEntry } from '../tauri';
import { pad, typeLabel, statusLabel } from './utils';
import { getT } from '../../i18n/client';
import { buildHofHtml, initHofListeners } from './hof';
import { buildMonthlyHistoryHtml } from './monthly';
import { buildActivityHtml } from './activity';

type Items = Awaited<ReturnType<typeof getAllLibraryEntries>>;

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

function getActiveRatingSystem(): string {
  return typeof window !== 'undefined' ? (localStorage.getItem('metadea_rating_system') || '5-star') : '5-star';
}

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

  const system = getActiveRatingSystem();
  let avgRatingStr = '0.0';
  if (ratedCount > 0) {
    const avgVal = totalRating / ratedCount;
    if (system === '10-dec') {
      avgRatingStr = avgVal.toFixed(2);
    } else if (system === '10') {
      avgRatingStr = Math.round(avgVal).toString();
    } else if (system === '3-emoji') {
      const rounded = Math.round(avgVal);
      let emoji = '😐';
      if (rounded === 9) emoji = '😊';
      else if (rounded === 3) emoji = '😞';
      avgRatingStr = `${emoji} (${avgVal.toFixed(1)})`;
    } else {
      avgRatingStr = (avgVal / 2).toFixed(1);
    }
  }

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
        [p.stat_avg,       avgRatingStr],
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

  const favData = await readUserFavorites().catch(() => ({} as Record<string, string[]>));
  const multimediaIds = favData.multimedia || [];
  const hofItems = multimediaIds.map(id => items.find(item => item.external_id === id)).filter(Boolean) as Items;

  el.innerHTML = buildHofHtml(hofItems, catalogMap, p) + statsHtml + bottomHtml;
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

const STAR_FULL  = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1"><path d="M12 17.75l-6.172 3.245 1.179-6.873-4.993-4.867 6.9-1.002L12 2l3.086 6.253 6.9 1.002-4.993 4.867 1.179 6.873z"/></svg>`;
const STAR_HALF  = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><defs><clipPath id="h"><rect x="0" y="0" width="12" height="24"/></clipPath></defs><path d="M12 17.75l-6.172 3.245 1.179-6.873-4.993-4.867 6.9-1.002L12 2l3.086 6.253 6.9 1.002-4.993 4.867 1.179 6.873z" stroke="currentColor"/><path d="M12 17.75l-6.172 3.245 1.179-6.873-4.993-4.867 6.9-1.002L12 2l3.086 6.253 6.9 1.002-4.993 4.867 1.179 6.873z" fill="currentColor" clip-path="url(#h)"/></svg>`;
const STAR_EMPTY = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 17.75l-6.172 3.245 1.179-6.873-4.993-4.867 6.9-1.002L12 2l3.086 6.253 6.9 1.002-4.993 4.867 1.179 6.873z"/></svg>`;

function buildRatingHtml(rating: number | null | undefined): string {
  if (!rating) return '<span class="library-card-rating"></span>';

  const system = getActiveRatingSystem();

  if (system === '10-dec') {
    return `<span class="library-card-rating text-rating" style="font-size: 0.72rem; font-weight: 700; color: var(--accent);">${Number(rating).toFixed(2)} / 10</span>`;
  }
  if (system === '10') {
    return `<span class="library-card-rating text-rating" style="font-size: 0.72rem; font-weight: 700; color: var(--accent);">${Math.round(rating)} / 10</span>`;
  }
  if (system === '3-emoji') {
    const rounded = Math.round(rating);
    let emoji = '😐';
    let color = '#f59e0b';
    if (rounded === 9) {
      emoji = '😊';
      color = '#10b981';
    } else if (rounded === 3) {
      emoji = '😞';
      color = '#ef4444';
    }
    return `<span class="library-card-rating emoji-rating" style="font-size: 1.1rem; line-height: 1; color: ${color};">${emoji}</span>`;
  }

  // Default: rating is 0-10, display as 0-5 stars
  const stars5 = Math.max(0, Math.min(5, rating / 2));
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

  const SORT_ICON_SCORE = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></polygon></svg>`;
  const SORT_ICON_DATE = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>`;
  const SORT_ICON_DURATION = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`;

  let sortBy = 'date'; // 'rating' | 'date' | 'duration'

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

      <div class="library-content">
        <div class="library-content-header">
          <div class="library-filter-group select-sort">
            <span class="library-sort-label">Ordenar por</span>
            <div class="library-sort-options">
              <button type="button" class="library-sort-btn" data-sort="rating" title="Calificación">${SORT_ICON_SCORE}</button>
              <button type="button" class="library-sort-btn active" data-sort="date" title="Fecha">${SORT_ICON_DATE}</button>
              <button type="button" class="library-sort-btn" data-sort="duration" title="Duración">${SORT_ICON_DURATION}</button>
            </div>
          </div>
        </div>
        <div class="library-sections-list"></div>
      </div>
    </div>
  `;

  const filterName   = el.querySelector('#filter-name') as HTMLInputElement | null;
  const statusValEl  = el.querySelector('#status-val') as HTMLElement | null;
  const btnPrev      = el.querySelector('#status-prev') as HTMLButtonElement | null;
  const btnNext      = el.querySelector('#status-next') as HTMLButtonElement | null;
  const contentEl    = el.querySelector('.library-content') as HTMLElement | null;
  const typeBtns     = el.querySelectorAll('.library-type-btn');
  const sortBtns     = el.querySelectorAll('.library-sort-btn');

  const applyFilters = () => {
    if (!contentEl) return;
    const sectionsListEl = contentEl.querySelector('.library-sections-list') as HTMLElement | null;
    if (!sectionsListEl) return;

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
      sectionsListEl.innerHTML = `<div class="library-empty-filtered">Sin resultados para los filtros aplicados</div>`;
      return;
    }

    const sortItems = (itemList: Items) => {
      return [...itemList].sort((a, b) => {
        if (sortBy === 'rating') {
          return (b.rating ?? 0) - (a.rating ?? 0);
        } else if (sortBy === 'duration') {
          return (b.minutes_spent ?? 0) - (a.minutes_spent ?? 0);
        } else {
          const dateA = a.finished_at ? new Date(a.finished_at).getTime() : 0;
          const dateB = b.finished_at ? new Date(b.finished_at).getTime() : 0;
          if (dateA === 0 && dateB !== 0) return 1;
          if (dateB === 0 && dateA !== 0) return -1;
          return dateB - dateA; // newest finished to oldest finished
        }
      });
    };

    const inProgress = sortItems(filtered.filter(item => item.status === 'watching' || item.status === 'reading' || item.status === 'playing'));
    const completed  = sortItems(filtered.filter(item => item.status === 'completed'));
    const planning   = sortItems(filtered.filter(item => item.status === 'planning'));
    const paused     = sortItems(filtered.filter(item => item.status === 'paused'));
    const dropped    = sortItems(filtered.filter(item => item.status === 'dropped'));

    const sectionsData = [
      { title: p.section_in_progress, items: inProgress },
      { title: p.section_completed, items: completed },
      { title: p.section_planning, items: planning },
      { title: p.section_paused, items: paused },
      { title: p.section_dropped, items: dropped },
    ];

    sectionsListEl.innerHTML = sectionsData
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

  sortBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      sortBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      sortBy = (btn as HTMLElement).dataset.sort || 'date';
      applyFilters();
    });
  });

  applyFilters();
}

export async function renderStats(el: HTMLElement): Promise<void> {
  const t = getT();
  const p = t.profile;

  el.innerHTML = `<div class="profile-empty"><p>Cargando estadísticas...</p></div>`;

  const items = await getAllLibraryEntries().catch(() => [] as Items);

  if (items.length === 0) {
    el.innerHTML = `
      <div class="profile-empty">
        <span class="profile-empty-icon">📊</span>
        <p>Aún no tienes suficientes datos en tu biblioteca para generar estadísticas.</p>
        <a href="/search">${p.empty_cta}</a>
      </div>`;
    return;
  }
  // Overview stats calculation
  const totalWorks = items.length;
  const totalMinutes = items.reduce((acc, item) => acc + (item.minutes_spent || 0), 0);
  const totalHours = totalMinutes / 60;
  
  const ratedItems = items.filter(item => item.rating != null && item.rating > 0);
  const totalRating = ratedItems.reduce((acc, item) => acc + (item.rating || 0), 0);
  const avgScore = ratedItems.length > 0 ? (totalRating / ratedItems.length) : 0;

  // Status counts
  const completed = items.filter(item => item.status === 'completed').length;
  const currently = items.filter(item => item.status === 'watching' || item.status === 'reading' || item.status === 'playing').length;
  const paused = items.filter(item => item.status === 'paused').length;
  const dropped = items.filter(item => item.status === 'dropped').length;
  const planning = items.filter(item => item.status === 'planning').length;

  // Time metrics
  const totalDays = (totalHours / 24).toFixed(1);
  const avgPerWork = (totalHours / totalWorks).toFixed(1);

  // Breakdown by media type
  const byTypeMap = new Map<string, { count: number; minutes: number }>();
  for (const item of items) {
    const val = byTypeMap.get(item.type) || { count: 0, minutes: 0 };
    val.count++;
    val.minutes += (item.minutes_spent || 0);
    byTypeMap.set(item.type, val);
  }
  const byType = Array.from(byTypeMap.entries()).map(([type, val]) => ({
    type,
    count: val.count,
    hours: Number((val.minutes / 60).toFixed(1)),
  })).sort((a, b) => b.count - a.count);

  const ICON_STACK = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>`;
  const ICON_CLOCK = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`;
  const ICON_STAR = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></polygon></svg>`;
  const ICON_CHART = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>`;

  const ICON_STATUS_COMPLETED = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>`;
  const ICON_STATUS_PROGRESS = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>`;
  const ICON_STATUS_PENDING = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 2h14M5 22h14M19 2v4a7 7 0 0 1-14 0V2M5 22v-4a7 7 0 0 1 14 0v4"/></svg>`;
  const ICON_STATUS_PAUSED = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>`;
  const ICON_STATUS_DROPPED = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;

  const statusList = [
    { label: 'Completadas', value: completed, color: 'completed', icon: ICON_STATUS_COMPLETED },
    { label: 'En progreso', value: currently, color: 'in_progress', icon: ICON_STATUS_PROGRESS },
    { label: 'Pendientes',  value: planning,  color: 'planning', icon: ICON_STATUS_PENDING },
    { label: 'En pausa',    value: paused,    color: 'paused', icon: ICON_STATUS_PAUSED },
    { label: 'Abandonadas', value: dropped,   color: 'dropped', icon: ICON_STATUS_DROPPED },
  ].filter(s => s.value > 0);

  const system = getActiveRatingSystem();
  let avgScoreStr = '—';
  if (avgScore > 0) {
    if (system === '10-dec') {
      avgScoreStr = `${avgScore.toFixed(2)} / 10`;
    } else if (system === '10') {
      avgScoreStr = `${Math.round(avgScore)} / 10`;
    } else if (system === '3-emoji') {
      const rounded = Math.round(avgScore);
      let emoji = '😐';
      if (rounded === 9) emoji = '😊';
      else if (rounded === 3) emoji = '😞';
      avgScoreStr = `${emoji} (${avgScore.toFixed(1)})`;
    } else {
      avgScoreStr = `${(avgScore / 2).toFixed(1)} / 5`;
    }
  }

  el.innerHTML = `
    <div class="stats-layout">
      <!-- Cards grid -->
      <div class="stats-grid-4">
        <div class="stats-card">
          <div class="stats-card-icon">${ICON_STACK}</div>
          <span class="stats-card-label">Obras Totales</span>
          <span class="stats-card-value">${totalWorks.toLocaleString()}</span>
        </div>
        <div class="stats-card">
          <div class="stats-card-icon">${ICON_CLOCK}</div>
          <span class="stats-card-label">Horas Invertidas</span>
          <span class="stats-card-value">${totalHours.toFixed(0)}</span>
        </div>
        <div class="stats-card">
          <div class="stats-card-icon">${ICON_STAR}</div>
          <span class="stats-card-label">Nota Media</span>
          <span class="stats-card-value">${avgScoreStr}</span>
        </div>
        <div class="stats-card">
          <div class="stats-card-icon">${ICON_CHART}</div>
          <span class="stats-card-label">Obras Valoradas</span>
          <span class="stats-card-value">${ratedItems.length.toLocaleString()}</span>
        </div>
      </div>

      <!-- Extra time stats -->
      ${totalHours > 0 ? `
        <div class="stats-days-row">
          <div class="stats-day-item">
            <span class="stats-day-label">Días equivalentes</span>
            <span class="stats-day-value">${totalDays} d</span>
          </div>
          <div class="stats-day-item">
            <span class="stats-day-label">Media horas por obra</span>
            <span class="stats-day-value">${avgPerWork} h</span>
          </div>
        </div>
      ` : ''}

      <!-- Status breakdown -->
      ${statusList.length > 0 ? `
        <div class="stats-block">
          <h3 class="stats-block-title">Por estado</h3>
          <div class="stats-status-list">
            ${statusList.map(s => {
              const pct = ((s.value / totalWorks) * 100).toFixed(0);
              const pctPrecise = ((s.value / totalWorks) * 100).toFixed(1);
              return `
                <div class="stats-status-row">
                  <div class="stats-status-icon">${s.icon}</div>
                  <span class="stats-status-label">${s.label}</span>
                  <div class="stats-bar-outer">
                    <div class="stats-bar-inner ${s.color}" style="width: ${pctPrecise}%"></div>
                  </div>
                  <span class="stats-status-count">${s.value}</span>
                  <span class="stats-status-percent">${pct}%</span>
                </div>
              `;
            }).join('')}
          </div>
        </div>
      ` : ''}

      <!-- Per-type breakdown -->
      ${byType.length > 0 ? `
        <div class="stats-block">
          <h3 class="stats-block-title">Por tipo de medio</h3>
          <div class="stats-grid-3">
            ${byType.map(t => {
              const typeIcon = TYPE_ICON[t.type] || TYPE_ICON['book'];
              const typeLabel = TYPE_LABELS[t.type] || t.type;
              return `
                <div class="stats-type-card">
                  <div class="stats-type-icon">${typeIcon}</div>
                  <div class="stats-type-info">
                    <p class="stats-type-label">${typeLabel}</p>
                    <p class="stats-type-count">${t.count} obras</p>
                    ${t.hours > 0 ? `<p class="stats-type-hours">${t.hours} h</p>` : ''}
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        </div>
      ` : ''}
    </div>
  `;
}

/* ── Favorites Tab Render ────────────────────────────────────────────────── */
export async function renderFavorites(el: HTMLElement): Promise<void> {
  const t = getT();
  const p = t.profile;
  const s = t.search.types;

  if (!el.innerHTML || el.innerHTML.includes('Cargando')) {
    el.innerHTML = `<div class="profile-empty"><p>Cargando favoritos...</p></div>`;
  }

  const items = await getAllLibraryEntries().catch(() => [] as Items);
  const catalogEntries = await getAllCatalogEntries().catch(() => [] as MediaCatalogEntry[]);
  const catalogMap = new Map<string, MediaCatalogEntry>(
    catalogEntries.map(e => [e.external_id, e])
  );

  /* ── Load & Synchronize user_favorite.json ─────────────────────────────── */
  let favData = await readUserFavorites().catch(() => ({} as Record<string, string[]>));
  let modified = false;

  const favKeys = ['multimedia', 'anime', 'manga', 'game', 'vnovel', 'novel', 'series', 'movie', 'book'];
  for (const k of favKeys) {
    if (!favData[k]) {
      favData[k] = [];
      modified = true;
    }
  }

  for (const item of items) {
    const type = item.type || 'book';
    if (item.is_favorite === 1) {
      if (!favData[type].includes(item.external_id)) {
        favData[type].push(item.external_id);
        modified = true;
      }
    } else {
      if (favData[type].includes(item.external_id)) {
        favData[type] = favData[type].filter(id => id !== item.external_id);
        modified = true;
      }
      if (favData.multimedia.includes(item.external_id)) {
        favData.multimedia = favData.multimedia.filter(id => id !== item.external_id);
        modified = true;
      }
    }
  }

  if (modified) {
    await writeUserFavorites(favData).catch(() => {});
  }

  const getOrderedItems = (catKey: string) => {
    const ids = favData[catKey] || [];
    return ids.map(id => items.find(item => item.external_id === id)).filter(Boolean) as Items;
  };

  let activeCatKey = 'multimedia';
  let reorderModeActive = false;

  const renderContent = () => {
    // Categories definition
    const categories = [
      { key: 'multimedia', label: p.favorites_multimedia || 'Multimedia', getItems: () => getOrderedItems('multimedia'), icon: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>` },
      { key: 'anime', label: s.anime, getItems: () => getOrderedItems('anime'), icon: TYPE_ICON['anime'] },
      { key: 'manga', label: s.manga, getItems: () => getOrderedItems('manga'), icon: TYPE_ICON['manga'] },
      { key: 'game', label: s.game, getItems: () => getOrderedItems('game'), icon: TYPE_ICON['game'] },
      { key: 'vnovel', label: s.vnovel, getItems: () => getOrderedItems('vnovel'), icon: TYPE_ICON['vnovel'] },
      { key: 'novel', label: s.novel, getItems: () => getOrderedItems('novel'), icon: TYPE_ICON['novel'] },
      { key: 'series', label: s.series, getItems: () => getOrderedItems('series'), icon: TYPE_ICON['series'] },
      { key: 'movie', label: s.movie, getItems: () => getOrderedItems('movie'), icon: TYPE_ICON['movie'] },
      { key: 'book', label: s.book, getItems: () => getOrderedItems('book'), icon: TYPE_ICON['book'] },
    ];

    const cat = categories.find(c => c.key === activeCatKey) || categories[0];
    const catItems = cat.getItems();

    const gridHtml = catItems.map((item, idx) => {
      const meta = catalogMap.get(item.external_id);
      const title = meta?.title_main ?? item.external_id;
      const cover = meta?.cover_url ?? '';
      const mediaUrl = `/media?id=${encodeURIComponent(item.external_id)}`;
      const typeIc = TYPE_ICON[item.type] ?? TYPE_ICON['book'];
      const isCrowned = favData.multimedia?.includes(item.external_id);

      return `
        <div class="fav-card ${reorderModeActive ? 'reordering' : ''}" data-id="${item.external_id}" ${reorderModeActive ? 'draggable="true"' : ''}>
          <a class="fav-card-link" href="${mediaUrl}"></a>
          <div class="fav-badge">#${idx + 1}</div>

          <!-- Crown button overlay -->
          ${activeCatKey !== 'multimedia' ? `
            <button class="fav-crown-btn ${isCrowned ? 'active' : ''}" data-id="${item.external_id}" title="Multimedia" style="position: absolute; top: 10px; right: 10px; z-index: 10;">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="${isCrowned ? '#fbbf24' : 'none'}" stroke="${isCrowned ? '#fbbf24' : 'currentColor'}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 4l3 12h14l3-12-6 7-4-7-4 7-6-7z"/><path d="M3 20h18v2H3z"/></svg>
            </button>
          ` : ''}

          ${cover
            ? `<img class="fav-cover" src="${cover}" alt="${title}" loading="lazy" />`
            : `<div class="fav-no-cover"><span>${title.slice(0, 2).toUpperCase()}</span></div>`
          }
          <div class="fav-overlay">
            <span class="fav-title">${title}</span>
            <div class="fav-meta">
              <span>★ ${(item.rating ? (item.rating / 2).toFixed(1) : '0.0')}</span>
              <span class="fav-meta-type">${typeIc}</span>
            </div>
          </div>
        </div>
      `;
    }).join('');

    const emptyHtml = `
      <div class="fav-empty-state">
        <svg class="fav-empty-icon" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
        <h3 class="fav-empty-title">${cat.label}</h3>
        <p class="fav-empty-text">${p.empty_favorites}</p>
      </div>
    `;

    const tabsHtml = categories.map(c => {
      const cItems = c.getItems();
      return `
        <button class="fav-tab-btn ${c.key === activeCatKey ? 'active' : ''}" data-cat="${c.key}">
          ${c.icon}
          <span>${c.label}</span>
          ${cItems.length > 0 ? `<span class="fav-tab-count">${cItems.length}</span>` : ''}
        </button>
      `;
    }).join('');

    el.innerHTML = `
      <div class="fav-layout">
        <div class="fav-tabs-row">
          <div class="fav-tabs">
            ${tabsHtml}
          </div>
          <button class="fav-tab-btn fav-reorder-btn ${reorderModeActive ? 'active' : ''}" id="fav-reorder-toggle" title="${p.reorder}">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 3h5v5"/><path d="M21 3L14 10"/><path d="M18 14l3 3M14 21h7v-7"/><path d="M21 21L14 14"/><path d="M3 3l18 18"/></svg>
          </button>
        </div>
        <div class="fav-grid-container">
          ${catItems.length > 0 ? `<div class="fav-grid">${gridHtml}</div>` : emptyHtml}
        </div>
      </div>
    `;

    // Hook tab button click listeners
    el.querySelectorAll('.fav-tab-btn[data-cat]').forEach(btn => {
      btn.addEventListener('click', () => {
        activeCatKey = (btn as HTMLElement).dataset.cat || 'multimedia';
        renderContent();
      });
    });

    // Hook reorder mode toggle listener
    el.querySelector('#fav-reorder-toggle')?.addEventListener('click', () => {
      reorderModeActive = !reorderModeActive;
      renderContent();
    });

    // Hook crown overlay buttons click listeners
    el.querySelectorAll('.fav-crown-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = (btn as HTMLElement).dataset.id || '';
        if (!id) return;
        if (!favData.multimedia) favData.multimedia = [];
        
        if (favData.multimedia.includes(id)) {
          favData.multimedia = favData.multimedia.filter(x => x !== id);
        } else {
          favData.multimedia.push(id);
        }
        await writeUserFavorites(favData);
        renderContent();
      });
    });

    /* ── Hook Drag & Drop Listeners ───────────────────────────────────────── */
    if (reorderModeActive) {
      const container = el.querySelector('.fav-grid') as HTMLElement | null;
      if (container) {
        let activeDragSource: HTMLElement | null = null;

        const getInsertionPoint = (clientX: number, clientY: number) => {
          const cards = Array.from(container.querySelectorAll('.fav-card:not(.drag-source)')) as HTMLElement[];
          let closestCard: HTMLElement | null = null;
          let closestDistance = Infinity;
          let insertBefore = true;

          for (const card of cards) {
            const rect = card.getBoundingClientRect();
            if (
              clientX >= rect.left && clientX <= rect.right &&
              clientY >= rect.top && clientY <= rect.bottom
            ) {
              closestCard = card;
              insertBefore = (clientX - rect.left) < rect.width / 2;
              break;
            }

            const centerX = rect.left + rect.width / 2;
            const centerY = rect.top + rect.height / 2;
            const distance = Math.hypot(clientX - centerX, clientY - centerY);

            if (distance < closestDistance) {
              closestDistance = distance;
              closestCard = card;
              insertBefore = clientX < centerX;
            }
          }
          return { closestCard, insertBefore };
        };

        const cards = container.querySelectorAll('.fav-card') as NodeListOf<HTMLElement>;
        cards.forEach(card => {
          card.addEventListener('dragstart', (e: DragEvent) => {
            window.getSelection()?.removeAllRanges();
            activeDragSource = card;
            card.classList.add('drag-source');
            if (e.dataTransfer) {
              e.dataTransfer.effectAllowed = 'move';
              e.dataTransfer.setData('text/plain', card.getAttribute('data-id') || '');
              const img = card.querySelector('.fav-cover') as HTMLImageElement | null;
              if (img && e.dataTransfer.setDragImage) {
                // Set the cover image as the drag visual under the cursor
                e.dataTransfer.setDragImage(img, img.width / 2, img.height / 2);
              }
            }
          });

          card.addEventListener('dragend', () => {
            card.classList.remove('drag-source');
            activeDragSource = null;
          });
        });

        container.addEventListener('dragover', (e: DragEvent) => {
          e.preventDefault();
          if (!activeDragSource) return;

          const { closestCard, insertBefore } = getInsertionPoint(e.clientX, e.clientY);
          if (closestCard && closestCard !== activeDragSource) {
            if (insertBefore) {
              container.insertBefore(activeDragSource, closestCard);
            } else {
              container.insertBefore(activeDragSource, closestCard.nextSibling);
            }
          }
        });

        container.addEventListener('drop', async (e: DragEvent) => {
          e.preventDefault();
          if (activeDragSource) {
            // Update favData based on new DOM order
            const newOrder = Array.from(container.querySelectorAll('.fav-card'))
              .map(c => (c as HTMLElement).dataset.id)
              .filter(Boolean) as string[];

            favData[activeCatKey] = newOrder;
            await writeUserFavorites(favData);
            renderContent();
          }
        });
      }
    }
  };

  renderContent();
}
