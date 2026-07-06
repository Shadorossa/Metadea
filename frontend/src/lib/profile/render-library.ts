import { getAllLibraryEntries, getAllCatalogEntries } from '../tauri';
import type { MediaCatalogEntry } from '../tauri';
import { getT } from '../../i18n/client';
import { getActiveRatingSystem, formatRatingHtml } from '../media/rating-utils';
import { typeIconMap, CALENDAR_ICON, SORT_ICON_SCORE, SORT_ICON_DATE, SORT_ICON_DURATION, GROUP_EDITIONS_ICON } from '../shared/icon-strings';
import { TYPE_LABELS, isInProgressStatus } from '../constants/media';

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

// Groups library entries that are editions of one another (remakes,
// remasters, ports, ...) under a single "slot" so they don't each claim a
// spot in the grid. Two independent signals decide who nests under whom:
//   1. Explicit link — the base entry's `selected_version`, a CSV of linked
//      external_ids written by MediaEditorModal's edition switcher when the
//      user manually flips between tabs and saves.
//   2. Auto-detected link — the edition's own catalog entry `parent_id`,
//      cached from IGDB's `parent_game`/`version_parent` the first time the
//      edition's own media page was visited (see MediaPage.tsx). This is
//      what makes "Vengeance"-style editions group without the user ever
//      opening the editor's version switcher.
// Both signals are resolved into a single child→parent map first so
// grouping doesn't depend on which order the items happen to sort in.
// Grouping is scoped to a single status section: an edition tracked under a
// different status still gets its own card there instead of silently
// disappearing into a differently-labeled section.
function groupEditions<T extends { external_id: string; selected_version: string | null }>(
  sectionItems: T[],
  catalogMap: Map<string, MediaCatalogEntry>,
): Array<{ item: T; grouped: T[] }> {
  const byId = new Map(sectionItems.map(i => [i.external_id, i]));
  const parentOf = new Map<string, string>();

  for (const item of sectionItems) {
    const linkedIds = item.selected_version ? item.selected_version.split(',').map(s => s.trim()).filter(Boolean) : [];
    for (const linkedId of linkedIds) {
      if (linkedId !== item.external_id && byId.has(linkedId)) parentOf.set(linkedId, item.external_id);
    }
  }

  for (const item of sectionItems) {
    if (parentOf.has(item.external_id)) continue;
    const catalogParentId = catalogMap.get(item.external_id)?.parent_id;
    if (catalogParentId && catalogParentId !== item.external_id && byId.has(catalogParentId)) {
      parentOf.set(item.external_id, catalogParentId);
    }
  }

  const out: Array<{ item: T; grouped: T[] }> = [];
  for (const item of sectionItems) {
    if (parentOf.has(item.external_id)) continue; // rendered nested under its parent instead
    const grouped = sectionItems.filter(other => parentOf.get(other.external_id) === item.external_id);
    out.push({ item, grouped });
  }

  return out;
}

export async function renderLibrary(el: HTMLElement): Promise<void> {
  const p = getT().profile;
  let [rawItems, catalogEntries] = await Promise.all([
    getAllLibraryEntries().catch(() => []),
    getAllCatalogEntries().catch(() => [] as MediaCatalogEntry[]),
  ]);

  // Unlike the stats dashboard, the library grid itself shows every logged
  // entry — including version logs — so they stay browsable/editable even
  // though they don't count toward the profile's totals.
  const items = rawItems;

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
  let groupByEdition = false;

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

        <div class="library-filter-group">
          <button type="button" id="group-editions-btn" class="library-toggle-btn">
            ${GROUP_EDITIONS_ICON}
            <span>${p.library_group_editions}</span>
          </button>
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
  const groupEditionsBtn = el.querySelector<HTMLButtonElement>('#group-editions-btn');

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
          if (!isInProgressStatus(item.status)) return false;
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

    const inProgress = sortItems(filtered.filter(item => isInProgressStatus(item.status)));
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
      .map(sec => {
        const cards = groupByEdition ? groupEditions(sec.items, catalogMap) : sec.items.map(item => ({ item, grouped: [] as Items }));

        return `
        <div class="library-section">
          <h3 class="library-section-title">${sec.title}</h3>
          <div class="library-grid">
            ${cards.map(({ item, grouped }) => {
          const meta = catalogMap.get(item.external_id);
          const title = meta?.title_main ?? item.external_id;
          const cover = meta?.cover_url ?? '';
          const typeIc = TYPE_ICON[item.type] ?? TYPE_ICON['book'];
          const mediaUrl = `/media?id=${encodeURIComponent(item.external_id)}`;
          const style = cover ? `style="--cover: url('${cover}')"` : '';
          const stackClass = grouped.length > 0 ? ' library-card--stacked' : '';
          const groupedTitles = grouped.map(g => catalogMap.get(g.external_id)?.title_main ?? g.external_id);
          const badge = grouped.length > 0
            ? `<span class="library-card-group-badge" title="${p.library_group_editions_hint}: ${groupedTitles.join(', ').replace(/"/g, '&quot;')}">+${grouped.length}</span>`
            : '';

          return `
                <div class="library-card${stackClass}" data-id="${item.external_id}" ${style}>
                  ${cover ? `<div class="library-card-bg"></div>` : ''}
                  ${badge}
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
      `;
      }).join('');
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

  groupEditionsBtn?.addEventListener('click', () => {
    groupByEdition = !groupByEdition;
    groupEditionsBtn.classList.toggle('active', groupByEdition);
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
