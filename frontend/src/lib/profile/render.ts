import { getAllLibraryEntries, getAllCatalogEntries, readMonthlyHistory, readUserFavorites, writeUserFavorites, readUserJourney } from '../tauri';
import type { MediaCatalogEntry } from '../tauri';
import { pad, typeLabel, statusLabel } from './utils';
import { getT } from '../../i18n/client';
import { buildHofHtml, initHofListeners, HOF_GRADIENTS } from './hof';
import { buildMonthlyHistoryHtml } from './monthly';
import { buildActivityHtml, initActivityListeners } from './activity';
import { getActiveRatingSystem, formatRatingHtml, dbRatingToStars5 } from '../media/rating-utils';
import { typeIconMap, CALENDAR_ICON, SORT_ICON_SCORE, SORT_ICON_DATE, SORT_ICON_DURATION, ICON_STACK, ICON_CLOCK, ICON_STAR, ICON_CHART, STATUS_ICONS_14 } from '../shared/icon-strings';
import { TYPE_LABELS } from '../constants/media';

type Items = Awaited<ReturnType<typeof getAllLibraryEntries>>;

export async function renderOverview(el: HTMLElement, items: Items): Promise<void> {
  try {
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

      if (item.rating) { totalRating += item.rating; ratedCount++; }
      if (item.minutes_spent) totalMinutes += item.minutes_spent;
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
        let emoji = '😐';
        if (avgVal <= 3.5) emoji = '😞';
        else if (avgVal > 7) emoji = '😊';
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
        [p.stat_total, pad(items.length)],
        [p.stat_progress, pad(inProgress)],
        [p.stat_completed, pad(completed)],
        [p.stat_pending, pad(planning)],
        [p.stat_dropped, pad(dropped)],
        [p.stat_avg, avgRatingStr],
        [p.stat_hours, totalHours + 'h'],
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
        ${await buildActivityHtml(catalogMap, p)}
      </div>
    </div>`;

    const favData = await readUserFavorites().catch(() => ({} as Record<string, string[]>));
    const multimediaIds = favData.multimedia || [];
    const hofItems = multimediaIds.map(id => items.find(item => item.external_id === id)).filter(Boolean) as Items;

    el.innerHTML = buildHofHtml(hofItems, catalogMap, p) + statsHtml + bottomHtml;
    initHofListeners(el);
    initActivityListeners(el, catalogMap, p);
  } catch (error: any) {
    console.error("renderOverview failed:", error);
    el.innerHTML = `<div style="padding: 2rem; color: #ef4444; font-family: monospace; font-size: 0.9rem;">
      Error al renderizar perfil: ${error?.message || error}<br/>
      <pre>${error?.stack || ''}</pre>
    </div>`;
  }
}

const TYPE_ICON = typeIconMap(16);

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
}


function buildRatingHtml(rating: number | null | undefined): string {
  return formatRatingHtml(rating, getActiveRatingSystem(), 'library-card-rating');
}

function buildDateHtml(started: string | null | undefined, finished: string | null | undefined): string {
  if (!started && !finished) return '';
  const parts: string[] = [];
  if (started) parts.push(fmtDate(started));
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
    { key: '', label: (p as any).section_all ?? 'Todos' },
    { key: 'planning', label: p.status_planning },
    { key: 'in_progress', label: (p as any).section_in_progress ?? 'En progreso' },
    { key: 'completed', label: p.status_completed },
    { key: 'paused', label: p.status_paused },
    { key: 'dropped', label: p.status_dropped }
  ];
  let currentStatusIndex = 0;
  let selectedTypes: string[] = [];

  let sortBy = 'date'; // 'rating' | 'date' | 'duration'

  el.innerHTML = `
    <div class="library-layout">
      <aside class="library-filters">
        <p class="library-filters-title">${(p as any).library_filters ?? 'Filtros'}</p>

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
            <span class="library-status-val" id="status-val">${(p as any).section_all ?? 'Todos'}</span>
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

  const filterName = el.querySelector('#filter-name') as HTMLInputElement | null;
  const statusValEl = el.querySelector('#status-val') as HTMLElement | null;
  const btnPrev = el.querySelector('#status-prev') as HTMLButtonElement | null;
  const btnNext = el.querySelector('#status-next') as HTMLButtonElement | null;
  const contentEl = el.querySelector('.library-content') as HTMLElement | null;
  const typeBtns = el.querySelectorAll('.library-type-btn');
  const sortBtns = el.querySelectorAll('.library-sort-btn');

  const applyFilters = () => {
    if (!contentEl) return;
    const sectionsListEl = contentEl.querySelector('.library-sections-list') as HTMLElement | null;
    if (!sectionsListEl) return;

    const nameVal = filterName?.value.toLowerCase().trim() || '';
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
    const completed = sortItems(filtered.filter(item => item.status === 'completed'));
    const planning = sortItems(filtered.filter(item => item.status === 'planning'));
    const paused = sortItems(filtered.filter(item => item.status === 'paused'));
    const dropped = sortItems(filtered.filter(item => item.status === 'dropped'));

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
        const meta = catalogMap.get(item.external_id);
        const title = meta?.title_main ?? item.external_id;
        const cover = meta?.cover_url ?? '';
        const typeIc = TYPE_ICON[item.type] ?? TYPE_ICON['book'];
        const mediaUrl = `/media?id=${encodeURIComponent(item.external_id)}`;
        const style = cover ? `style="--cover: url('${cover}')"` : '';

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

  // Event delegation for library card clicks
  contentEl?.addEventListener('click', (e: Event) => {
    const target = e.target as HTMLElement;
    const card = target.closest('.library-card') as HTMLElement | null;
    if (!card) return;

    if (target.closest('.library-card-thumb')) return; // Allow thumb link

    const externalId = card.dataset.id;
    if (!externalId) return;

    const libraryEntry = items.find(i => i.external_id === externalId);
    const catalogEntry = catalogMap.get(externalId);

    window.dispatchEvent(new CustomEvent('open-profile-editor', {
      detail: { externalId, libraryEntry, catalogEntry }
    }));
  });

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
        <p>${p.stats_empty}</p>
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
  })).sort((a, b) => b.hours - a.hours); // Sorted by hours spent

  const statusList = [
    { label: p.section_completed, value: completed, color: 'completed', icon: STATUS_ICONS_14.completed },
    { label: p.section_in_progress, value: currently, color: 'in_progress', icon: STATUS_ICONS_14.in_progress },
    { label: p.section_planning, value: planning, color: 'planning', icon: STATUS_ICONS_14.planning },
    { label: p.section_paused, value: paused, color: 'paused', icon: STATUS_ICONS_14.paused },
    { label: p.section_dropped, value: dropped, color: 'dropped', icon: STATUS_ICONS_14.dropped },
  ].filter(s => s.value > 0);

  const system = getActiveRatingSystem();
  let avgScoreStr = '—';
  if (avgScore > 0) {
    if (system === '10-dec') {
      avgScoreStr = `${avgScore.toFixed(2)} / 10`;
    } else if (system === '10') {
      avgScoreStr = `${Math.round(avgScore)} / 10`;
    } else if (system === '3-emoji') {
      let emoji = '😐';
      if (avgScore <= 3.5) emoji = '😞';
      else if (avgScore > 7) emoji = '😊';
      avgScoreStr = `${emoji} (${avgScore.toFixed(1)})`;
    } else {
      avgScoreStr = `${(avgScore / 2).toFixed(1)} / 5`;
    }
  }

  // Scan catalog releases for planning items that haven't released yet
  const catalogEntries = await getAllCatalogEntries().catch(() => [] as MediaCatalogEntry[]);
  const catalogMap = new Map<string, MediaCatalogEntry>(
    catalogEntries.map(e => [e.external_id, e])
  );

  const now = new Date();
  const todayDate = new Date(now.getFullYear(), now.getMonth(), now.getDate()); // midnight today
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth(); // 0-indexed
  const currentMonthName = now.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });

  // Get all upcoming releases for items in planning
  const upcomingPlanningReleases = items
    .filter(item => item.status === 'planning')
    .map(item => {
      const entry = catalogMap.get(item.external_id);
      if (!entry) return null;

      const year = entry.release_year;
      const month = entry.release_month;
      const day = entry.release_day || 1;

      if (year && month) {
        const releaseDate = new Date(year, month - 1, day);
        if (releaseDate >= todayDate) {
          return {
            day,
            month,
            year,
            releaseDate,
            title: entry.title_main || entry.external_id,
            type: entry.type,
            cover: entry.cover_url || ''
          };
        }
      }
      return null;
    })
    .filter(Boolean) as { day: number; month: number; year: number; releaseDate: Date; title: string; type: string; cover: string }[];

  // Sort upcoming planning releases chronologically
  upcomingPlanningReleases.sort((a, b) => a.releaseDate.getTime() - b.releaseDate.getTime());

  // Filter those that fall into the current calendar month
  const releasesByDay: Record<number, typeof upcomingPlanningReleases> = {};
  for (const r of upcomingPlanningReleases) {
    if (r.year === currentYear && r.month === (currentMonth + 1)) {
      if (!releasesByDay[r.day]) releasesByDay[r.day] = [];
      releasesByDay[r.day].push(r);
    }
  }

  // Get total days in month
  const totalDaysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
  const firstDayOfWeek = new Date(currentYear, currentMonth, 1).getDay(); // 0 = Sunday, 1 = Monday
  const startOffset = firstDayOfWeek === 0 ? 6 : firstDayOfWeek - 1;

  // Generate calendar cells
  const calendarCells: string[] = [];
  const dayHeaders = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
  const calendarHeaderHtml = dayHeaders.map(h => `<div class="calendar-day-header">${h}</div>`).join('');

  // Padding cells before first day of month
  for (let i = 0; i < startOffset; i++) {
    calendarCells.push(`<div class="calendar-day other-month"></div>`);
  }

  // Real month cells
  for (let day = 1; day <= totalDaysInMonth; day++) {
    const isToday = day === now.getDate();
    const dayReleases = releasesByDay[day] || [];
    const hasReleases = dayReleases.length > 0;
    let cellStyle = '';
    let hasCoverClass = '';
    let dotHtml = '';
    let dayTooltip = '';
    if (hasReleases) {
      const firstRelease = dayReleases[0];
      if (firstRelease.cover) {
        cellStyle = `background-image: url('${firstRelease.cover}');`;
        hasCoverClass = 'has-cover';
      } else {
        dotHtml = `<div class="calendar-day-event-dot"></div>`;
      }
      dayTooltip = dayReleases.map(r => `• ${r.title}`).join('\n');
    }

    calendarCells.push(`
      <div class="calendar-day ${isToday ? 'today' : ''} ${hasCoverClass}" data-day="${day}" title="${dayTooltip}" style="${cellStyle}">
        <span class="calendar-day-num">${day}</span>
        ${dotHtml}
      </div>
    `);
  }

  // Build the list of releases below (list all future releases in planning)
  const releasesListHtml = upcomingPlanningReleases.length > 0
    ? upcomingPlanningReleases.map(r => {
      const typeLabelText = TYPE_LABELS[r.type] || r.type;
      const fallbackBg = HOF_GRADIENTS[r.type] || 'linear-gradient(160deg, #374151, #1f2937)';
      const style = r.cover ? `background-image: url('${r.cover}'); background-size: cover;` : `background: ${fallbackBg};`;
      const formattedReleaseDate = r.releaseDate.toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' });
      return `
          <div class="calendar-release-item">
            <div class="calendar-release-img" style="${style}"></div>
            <div class="calendar-release-info">
              <p class="calendar-release-title">${r.title}</p>
              <p class="calendar-release-meta">${formattedReleaseDate} · ${typeLabelText}</p>
            </div>
          </div>
        `;
    }).join('')
    : `<p style="font-size: 0.8rem; color: var(--text-dim); text-align: center; padding: 1.5rem 0;">${p.stats_no_calendar}</p>`;

  /* ── 3. Calculate Activity Heatmap ─────────────────────────────────────── */
  const journey = await readUserJourney().catch(() => []);
  const activityMap: Record<string, number> = {};
  for (const day of journey) {
    activityMap[day.date] = (day.events || []).length;
  }

  const heatmapCells: string[] = [];
  const startDay = new Date();
  startDay.setDate(startDay.getDate() - 195); // 196 days ago

  for (let i = 0; i < 196; i++) {
    const curDate = new Date(startDay);
    curDate.setDate(curDate.getDate() + i);
    const dateKey = curDate.toISOString().split('T')[0];
    const count = activityMap[dateKey] || 0;

    let level = 0;
    if (count > 0 && count <= 2) level = 1;
    else if (count > 2 && count <= 4) level = 2;
    else if (count > 4 && count <= 6) level = 3;
    else if (count > 6) level = 4;

    const formattedDate = curDate.toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' });
    const tooltipText = `${formattedDate}: ${count} ${count === 1 ? 'actividad' : 'actividades'}`;
    heatmapCells.push(`<div class="heatmap-cell level-${level}" data-date="${dateKey}" data-tooltip="${tooltipText}"></div>`);
  }

  /* ── 4. Advanced stats computation ────────────────────────────────────── */

  // Genre breakdown: top 10 genres from library items
  const genreCount: Record<string, number> = {};
  for (const item of items) {
    const entry = catalogMap.get(item.external_id);
    if (!entry?.genres_csv) continue;
    for (const g of entry.genres_csv.split(',')) {
      const genre = g.trim();
      if (genre) genreCount[genre] = (genreCount[genre] ?? 0) + 1;
    }
  }
  const topGenres = Object.entries(genreCount).sort((a, b) => b[1] - a[1]).slice(0, 10);
  const maxGenreCount = topGenres.length > 0 ? topGenres[0][1] : 1;

  // Score distribution (DB scale 0-10, 5 buckets)
  const scoreBuckets = [
    { label: '1–2', min: 1, max: 2.99 }, { label: '3–4', min: 3, max: 4.99 },
    { label: '5–6', min: 5, max: 6.99 }, { label: '7–8', min: 7, max: 8.99 },
    { label: '9–10', min: 9, max: 10 },
  ];
  const scoreDist = scoreBuckets.map(b => ({
    label: b.label,
    count: ratedItems.filter(i => (i.rating ?? 0) >= b.min && (i.rating ?? 0) <= b.max).length,
  }));
  const maxScoreCount = Math.max(...scoreDist.map(s => s.count), 1);

  // Completed by year
  const byYear: Record<number, number> = {};
  for (const item of items) {
    if (item.status !== 'completed') continue;
    const year = parseInt((item.finished_at ?? item.updated_at ?? '').slice(0, 4), 10);
    if (year > 2000 && year <= currentYear) byYear[year] = (byYear[year] ?? 0) + 1;
  }
  const yearEntries = Object.entries(byYear)
    .map(([y, c]) => ({ year: parseInt(y, 10), count: c }))
    .sort((a, b) => a.year - b.year);
  const maxYearCount = Math.max(...yearEntries.map(y => y.count), 1);

  /* ── 5. Render Dashboard ───────────────────────────────────────────────── */
  const maxHours = byType.length > 0 ? Math.max(...byType.map(t => t.hours)) : 1;

  el.innerHTML = `
    <div class="stats-layout">

      <!-- 1. KPI Cards -->
      <div class="stats-grid-4">
        <div class="stats-card">
          <div class="stats-card-icon">${ICON_STACK}</div>
          <span class="stats-card-label">${p.stat_total}</span>
          <span class="stats-card-value">${totalWorks.toLocaleString()}</span>
        </div>
        <div class="stats-card">
          <div class="stats-card-icon">${ICON_CLOCK}</div>
          <span class="stats-card-label">${p.stat_hours}</span>
          <span class="stats-card-value">${totalHours.toFixed(0)}</span>
          ${totalHours > 0 ? `<span class="stats-card-sub">${totalDays} d · ${avgPerWork} h/obra</span>` : ''}
        </div>
        <div class="stats-card">
          <div class="stats-card-icon">${ICON_STAR}</div>
          <span class="stats-card-label">${p.stat_avg}</span>
          <span class="stats-card-value">${avgScoreStr}</span>
        </div>
        <div class="stats-card">
          <div class="stats-card-icon">${ICON_CHART}</div>
          <span class="stats-card-label">${p.stats_rated}</span>
          <span class="stats-card-value">${ratedItems.length.toLocaleString()}</span>
        </div>
      </div>

      <!-- 2. Status + Time by category (side by side) -->
      <div class="stats-main-pair">

        ${statusList.length > 0 ? `
          <div class="stats-block-custom">
            <h3 class="stats-block-title">${p.stats_by_status}</h3>
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

        ${byType.length > 0 ? `
          <div class="stats-block-custom">
            <h3 class="stats-block-title">${p.stats_by_time}</h3>
            <div class="stats-time-bars">
              ${byType.map(t => {
    const label = TYPE_LABELS[t.type] || t.type;
    const percent = maxHours > 0 ? (t.hours / maxHours) * 100 : 0;
    return `
                  <div class="stats-time-row">
                    <div class="stats-time-meta">
                      <span class="stats-time-label">${label}</span>
                      <span class="stats-time-value">${t.hours.toFixed(0)} h <span class="stats-time-count">(${t.count})</span></span>
                    </div>
                    <div class="stats-bar-outer">
                      <div class="stats-bar-inner" style="width: ${percent}%; background: var(--accent); box-shadow: 0 0 6px var(--accent);"></div>
                    </div>
                  </div>
                `;
  }).join('')}
            </div>
          </div>
        ` : ''}

      </div>

      <!-- 3. Insight trio: Genres · Score distribution · Completed by year -->
      ${(topGenres.length > 0 || ratedItems.length > 0 || yearEntries.length > 0) ? `
        <div class="stats-insight-trio">

          ${topGenres.length > 0 ? `
            <div class="stats-block-custom">
              <h3 class="stats-block-title">${p.stats_genres}</h3>
              <div class="stats-histogram">
                ${topGenres.map(([genre, count]) => `
                  <div class="stats-hist-row">
                    <span class="stats-hist-label">${genre}</span>
                    <div class="stats-hist-bar-outer">
                      <div class="stats-hist-bar-inner" style="width:${(count / maxGenreCount) * 100}%"></div>
                    </div>
                    <span class="stats-hist-count">${count}</span>
                  </div>
                `).join('')}
              </div>
            </div>
          ` : ''}

          ${ratedItems.length > 0 ? `
            <div class="stats-block-custom">
              <h3 class="stats-block-title">${p.stats_score_dist}</h3>
              <div class="stats-histogram">
                ${scoreDist.map(s => `
                  <div class="stats-hist-row">
                    <span class="stats-hist-label">${s.label}</span>
                    <div class="stats-hist-bar-outer">
                      <div class="stats-hist-bar-inner" style="width:${(s.count / maxScoreCount) * 100}%;background:color-mix(in srgb, var(--accent) 65%, #818cf8);"></div>
                    </div>
                    <span class="stats-hist-count">${s.count}</span>
                  </div>
                `).join('')}
              </div>
            </div>
          ` : ''}

          ${yearEntries.length > 0 ? `
            <div class="stats-block-custom">
              <h3 class="stats-block-title">${p.stats_by_year}</h3>
              <div class="stats-histogram">
                ${yearEntries.map(y => `
                  <div class="stats-hist-row">
                    <span class="stats-hist-label">${y.year}</span>
                    <div class="stats-hist-bar-outer">
                      <div class="stats-hist-bar-inner" style="width:${(y.count / maxYearCount) * 100}%;background:color-mix(in srgb, var(--accent) 50%, #a78bfa);"></div>
                    </div>
                    <span class="stats-hist-count">${y.count}</span>
                  </div>
                `).join('')}
              </div>
            </div>
          ` : ''}

        </div>
      ` : ''}

      <!-- 4. Activity Heatmap (full width) -->
      <div class="stats-block-custom">
        <h3 class="stats-block-title">${p.stats_heatmap}</h3>
        <div class="stats-heatmap-grid">
          ${heatmapCells.join('')}
        </div>
        <div class="stats-heatmap-legend">
          <span>Menos</span>
          <div class="heatmap-legend-cell" style="background: rgba(255,255,255,0.02);"></div>
          <div class="heatmap-legend-cell" style="background: color-mix(in srgb, var(--accent) 25%, rgba(255,255,255,0.02));"></div>
          <div class="heatmap-legend-cell" style="background: color-mix(in srgb, var(--accent) 50%, rgba(255,255,255,0.02));"></div>
          <div class="heatmap-legend-cell" style="background: color-mix(in srgb, var(--accent) 75%, rgba(255,255,255,0.02));"></div>
          <div class="heatmap-legend-cell" style="background: var(--accent); box-shadow: 0 0 4px var(--accent);"></div>
          <span>Más</span>
        </div>
      </div>

      <!-- 5. Release Calendar (full width, grid + list side by side) -->
      <div class="stats-block-custom">
        <div class="stats-calendar-header">
          <h3 class="stats-block-title">${p.stats_calendar}</h3>
          <span class="stats-calendar-month">${currentMonthName}</span>
        </div>
        <div class="stats-calendar-layout">
          <div class="calendar-grid">
            ${calendarHeaderHtml}
            ${calendarCells.join('')}
          </div>
          <div class="stats-calendar-list">
            ${upcomingPlanningReleases.length > 0
      ? upcomingPlanningReleases.map(r => {
        const typeLabelText = TYPE_LABELS[r.type] || r.type;
        const fallbackBg = HOF_GRADIENTS[r.type] || 'linear-gradient(160deg, #374151, #1f2937)';
        const style = r.cover ? `background-image: url('${r.cover}'); background-size: cover;` : `background: ${fallbackBg};`;
        const formattedReleaseDate = r.releaseDate.toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' });
        return `
                    <div class="calendar-release-item">
                      <div class="calendar-release-img" style="${style}"></div>
                      <div class="calendar-release-info">
                        <p class="calendar-release-title">${r.title}</p>
                        <p class="calendar-release-meta">${formattedReleaseDate} · ${typeLabelText}</p>
                      </div>
                    </div>
                  `;
      }).join('')
      : `<p class="stats-calendar-empty">${p.stats_no_calendar}</p>`
    }
          </div>
        </div>
      </div>

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

  const favKeys = ['multimedia', 'anime', 'manga', 'game', 'vnovel', 'lnovel', 'series', 'movie', 'book', 'character'];
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
    await writeUserFavorites(favData).catch(() => { });
  }

  const getOrderedItems = (catKey: string) => {
    const ids = favData[catKey] || [];
    if (catKey === 'character') {
      return ids.map(id => ({ external_id: id, type: 'character' }));
    }
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
      { key: 'lnovel', label: s.lnovel, getItems: () => getOrderedItems('lnovel'), icon: TYPE_ICON['lnovel'] },
      { key: 'series', label: s.series, getItems: () => getOrderedItems('series'), icon: TYPE_ICON['series'] },
      { key: 'movie', label: s.movie, getItems: () => getOrderedItems('movie'), icon: TYPE_ICON['movie'] },
      { key: 'book', label: s.book, getItems: () => getOrderedItems('book'), icon: TYPE_ICON['book'] },
      { key: 'character', label: 'Personajes', getItems: () => getOrderedItems('character'), icon: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>` },
    ];

    const cat = categories.find(c => c.key === activeCatKey) || categories[0];
    const catItems = cat.getItems();

    const gridHtml = catItems.map((item, idx) => {
      const meta = catalogMap.get(item.external_id);
      const title = meta?.title_main ?? item.external_id;
      const cover = meta?.cover_url ?? '';
      const mediaUrl = item.type === 'character'
        ? `/character?id=${item.external_id.replace('character:', '')}`
        : `/media?id=${encodeURIComponent(item.external_id)}`;
      const typeIc = item.type === 'character'
        ? `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="opacity:0.7;"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`
        : (TYPE_ICON[item.type] ?? TYPE_ICON['book']);
      const isCrowned = favData.multimedia?.includes(item.external_id);

      return `
        <div class="fav-card ${reorderModeActive ? 'reordering' : ''}" data-id="${item.external_id}">
          <a class="fav-card-link" href="${mediaUrl}"></a>
          <div class="fav-badge">#${idx + 1}</div>

          <!-- Crown button overlay -->
          ${activeCatKey !== 'multimedia' && item.type !== 'character' ? `
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
              ${item.type !== 'character' ? `<span>★ ${item.rating ? dbRatingToStars5(item.rating).toFixed(1) : '0.0'}</span>` : ''}
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

    /* ── Pointer-based Reordering (works in Tauri WebView) ─────────────── */
    if (reorderModeActive) {
      const container = el.querySelector('.fav-grid') as HTMLElement | null;
      if (container) {
        let dragCard: HTMLElement | null = null;
        let dragActive = false;

        // Cache of card centers/edges, only recomputed right after a real
        // DOM reorder (insertBefore) — not on every mousemove/rAF tick —
        // since that was forcing a full-grid reflow on every frame.
        type CardRect = { el: HTMLElement; cx: number; cy: number; left: number; width: number };
        let rectCache: CardRect[] = [];

        const refreshRectCache = () => {
          rectCache = Array.from(container.querySelectorAll('.fav-card:not(.drag-source)')).map(cardEl => {
            const r = (cardEl as HTMLElement).getBoundingClientRect();
            return { el: cardEl as HTMLElement, cx: r.left + r.width / 2, cy: r.top + r.height / 2, left: r.left, width: r.width };
          });
        };

        const getClosestCard = (clientX: number, clientY: number): CardRect | null => {
          let closest: CardRect | null = null;
          let closestDist = Infinity;

          for (const entry of rectCache) {
            const dist = Math.hypot(clientX - entry.cx, clientY - entry.cy);
            if (dist < closestDist) {
              closestDist = dist;
              closest = entry;
            }
          }
          return closest;
        };

        let rafId = 0;
        let lastMoveX = 0;
        let lastMoveY = 0;
        let prevMoveX = 0;

        // Which side of the target card the dragged card lands on is
        // decided by the direction of travel, not a static 50/50 split:
        // moving right, it only swaps once the cursor has actually passed
        // the target's center (landing after it); moving left, once it's
        // passed the center from the other side (landing before it). This
        // is self-stabilizing — once swapped, the same test keeps holding
        // true without re-triggering a move, unlike a fixed midpoint check
        // which flips its own verdict as soon as the swap shifts the
        // target's position, causing an infinite back-and-forth flicker.
        const reorderTick = () => {
          rafId = 0;
          if (!dragCard) return;
          const target = getClosestCard(lastMoveX, lastMoveY);
          if (target && target.el !== dragCard) {
            const movingRight = lastMoveX >= prevMoveX;
            const midpoint = target.left + target.width / 2;
            const passedMidpoint = movingRight ? lastMoveX > midpoint : lastMoveX < midpoint;
            if (passedMidpoint) {
              if (movingRight) {
                container.insertBefore(dragCard, target.el.nextSibling);
              } else {
                container.insertBefore(dragCard, target.el);
              }
              // Layout just changed — refresh cached positions for the next comparison
              refreshRectCache();
            }
          }
          prevMoveX = lastMoveX;
        };

        const onMouseMove = (e: MouseEvent) => {
          if (!dragActive || !dragCard) return;
          e.preventDefault();

          // Throttle DOM reordering to one per frame
          lastMoveX = e.clientX;
          lastMoveY = e.clientY;
          if (!rafId) rafId = requestAnimationFrame(reorderTick);
        };

        const onMouseUp = async () => {
          document.removeEventListener('mousemove', onMouseMove);
          document.removeEventListener('mouseup', onMouseUp);
          if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }

          dragActive = false;
          container.classList.remove('is-dragging');
          if (dragCard) {
            dragCard.classList.remove('drag-source');

            // Persist new order from DOM
            const newOrder = Array.from(container.querySelectorAll('.fav-card'))
              .map(c => (c as HTMLElement).dataset.id)
              .filter(Boolean) as string[];
            favData[activeCatKey] = newOrder;
            await writeUserFavorites(favData);

            dragCard = null;
            renderContent();
          }
        };

        const cards = container.querySelectorAll('.fav-card') as NodeListOf<HTMLElement>;
        cards.forEach(card => {
          card.addEventListener('mousedown', (e: MouseEvent) => {
            if (!reorderModeActive) return;
            // Ignore clicks on crown buttons
            if ((e.target as HTMLElement).closest('.fav-crown-btn')) return;
            e.preventDefault();
            window.getSelection()?.removeAllRanges();

            dragCard = card;
            dragActive = true;
            prevMoveX = e.clientX;
            card.classList.add('drag-source');
            container.classList.add('is-dragging');
            refreshRectCache();

            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
          });
        });
      }
    }
  };

  renderContent();
}
