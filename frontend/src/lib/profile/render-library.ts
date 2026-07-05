import { getAllLibraryEntries, getAllCatalogEntries } from '../tauri';
import type { MediaCatalogEntry } from '../tauri';
import { getT } from '../../i18n/client';
import { getActiveRatingSystem, formatRatingHtml } from '../media/rating-utils';
import { typeIconMap, CALENDAR_ICON, SORT_ICON_SCORE, SORT_ICON_DATE, SORT_ICON_DURATION } from '../shared/icon-strings';
import { TYPE_LABELS } from '../constants/media';

type Items = Awaited<ReturnType<typeof getAllLibraryEntries>>;

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
  let [rawItems, catalogEntries] = await Promise.all([
    getAllLibraryEntries().catch(() => []),
    getAllCatalogEntries().catch(() => [] as MediaCatalogEntry[]),
  ]);

  const childIds = new Set<string>();
  for (const item of rawItems) {
    if (item.selected_version) {
      for (const id of item.selected_version.split(',')) {
        childIds.add(id);
      }
    }
  }
  const items = rawItems.filter(item => !childIds.has(item.external_id));

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
    { key: '', label: p.section_all },
    { key: 'planning', label: p.status_planning },
    { key: 'in_progress', label: p.section_in_progress },
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
        <p class="library-filters-title">${p.library_filters}</p>

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
            <span class="library-status-val" id="status-val">${p.section_all}</span>
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

  const filterName = el.querySelector<HTMLInputElement>('#filter-name');
  const statusValEl = el.querySelector<HTMLElement>('#status-val');
  const btnPrev = el.querySelector<HTMLButtonElement>('#status-prev');
  const btnNext = el.querySelector<HTMLButtonElement>('#status-next');
  const contentEl = el.querySelector<HTMLElement>('.library-content');
  const typeBtns = el.querySelectorAll('.library-type-btn');
  const sortBtns = el.querySelectorAll('.library-sort-btn');

  const applyFilters = () => {
    if (!contentEl) return;
    const sectionsListEl = contentEl.querySelector<HTMLElement>('.library-sections-list');
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
        const hasEditions = !!item.selected_version;
        const stackClass = hasEditions ? ' library-card--stacked' : '';

        return `
                <div class="library-card${stackClass}" data-id="${item.external_id}" ${style}>
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
    const card = target.closest<HTMLElement>('.library-card');
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
