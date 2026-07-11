import { getAllLibraryEntries, getAllCatalogEntries, getAllMediaRelations } from '../tauri';
import type { MediaCatalogEntry, DbMediaRelation } from '../tauri';
import { getT } from '../../i18n/client';
import { getActiveRatingSystem, syncActiveRatingSystem, formatRatingHtml } from '../media/rating-utils';
import { typeIconMap, CALENDAR_ICON, SORT_ICON_SCORE, SORT_ICON_DATE, SORT_ICON_DURATION, GROUP_EDITIONS_ICON } from '../shared/icon-strings';
import { TYPE_LABELS, isInProgressStatus } from '../constants/media';
import { getItemMinutes } from './stats-calculators';
import { compareByReleaseDate } from '../media/mapper-utils';

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

// Matches a single leading emoji (plus an optional variation selector) at the
// very start of a tag string — e.g. "🎨Arte" → emoji "🎨", name "Arte". Tags
// are free text (see MediaEditorModal's tag input), so only tags the user
// actually prefixed with an emoji get a bookmark; plain-text tags are skipped.
const TAG_EMOJI_RE = /^(\p{Extended_Pictographic}️?)(.*)$/u;

function buildTagBadgesHtml(tags: string[] | null | undefined): string {
  if (!tags || tags.length === 0) return '';
  return tags
    .map(tag => {
      const match = TAG_EMOJI_RE.exec(tag.trim());
      if (!match) return '';
      const [, emoji, name] = match;
      const label = name.trim() || tag.trim();
      return `<span class="library-card-tag-badge" title="${label.replace(/"/g, '&quot;')}">${emoji}</span>`;
    })
    .filter(Boolean)
    .join('');
}

function buildDateHtml(started: string | null | undefined, finished: string | null | undefined): string {
  if (!started && !finished) return '';
  const parts: string[] = [];
  if (started) parts.push(fmtDate(started));
  if (finished) parts.push(fmtDate(finished));
  return `<span class="library-card-date">${CALENDAR_ICON}${parts.join(' → ')}</span>`;
}

// Sequel/prequel relations are saved for games too (IGDB), not just
// anime/manga/lnovel (AniList) — Silent Hill, Metal Gear Solid, Final
// Fantasy VII etc. all have real SEQUEL/PREQUEL rows in media_relations,
// confirmed directly against the DB.
const SAGA_GROUPABLE_TYPES = new Set(['anime', 'manga', 'lnovel', 'game', 'vnovel']);

// Groups library entries that are editions of one another (remakes,
// remasters, ports, ...), or — for anime/manga/lnovel — entries linked by a
// saved SEQUEL/PREQUEL relation, under a single "slot" so they don't each
// claim a spot in the grid. Three independent signals decide who nests
// under whom:
//   1. Explicit edition link — the base entry's `selected_version`, a CSV of
//      linked external_ids written by MediaEditorModal's edition switcher
//      when the user manually flips between tabs and saves. Opt-in, gated
//      behind `includeEditions` (the "Agrupar por ediciones" toggle) — an
//      alternate edition genuinely is a different product.
//   2. Auto-detected edition link — the edition's own catalog entry
//      `parent_id`, cached from IGDB's `parent_game`/`version_parent` the
//      first time the edition's own media page was visited (see
//      MediaPage.tsx). Also gated behind `includeEditions`.
//   3. Saga link — a saved SEQUEL/PREQUEL row in media_relations between two
//      anime/manga/lnovel entries both already in this section. Also gated
//      behind `includeEditions` (same "Agrupar por ediciones" toggle) per
//      user preference. Relations are only recorded from whichever side the
//      user has actually opened (see mediaService.ts), so the graph can be
//      one-directional or only partially known — chains are resolved to
//      whichever entry is already the current root, so a 5-season saga
//      still collapses under its earliest entry even if the edges were
//      saved in a scattered order.
// All signals are resolved into a single child→parent map first so grouping
// doesn't depend on which order the items happen to sort in. Grouping is
// scoped to a single status section: an edition or saga entry tracked under
// a different status still gets its own card there instead of silently
// disappearing into a differently-labeled section.
function groupEditions<T extends { external_id: string; selected_version: string | null; type: string }>(
  sectionItems: T[],
  catalogMap: Map<string, MediaCatalogEntry>,
  sagaRelations: DbMediaRelation[],
  includeEditions: boolean,
): Array<{ item: T; grouped: T[] }> {
  const byId = new Map(sectionItems.map(i => [i.external_id, i]));
  const parentOf = new Map<string, string>();

  if (includeEditions) {
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
  }

  const rootOf = (id: string): string => {
    let cur = id;
    const seen = new Set<string>();
    while (parentOf.has(cur) && !seen.has(cur)) {
      seen.add(cur);
      cur = parentOf.get(cur)!;
    }
    return cur;
  };

  if (includeEditions) {
    for (const rel of sagaRelations) {
      // A relation_type bug fixed earlier this session used to store the
      // *translated* label uppercased instead of AniList's raw enum value
      // (e.g. "SECUELA"/"PRECUELA" in Spanish instead of "SEQUEL"/
      // "PREQUEL"), and that fix doesn't rewrite already-saved rows — so
      // existing libraries still have relations stuck under the old,
      // wrong-cased label. Recognizing both keeps saga grouping working for
      // data saved before and after that fix, without needing to touch the
      // database.
      const isSequel  = rel.relation_type === 'SEQUEL'  || rel.relation_type === 'SECUELA';
      const isPrequel = rel.relation_type === 'PREQUEL' || rel.relation_type === 'PRECUELA';
      if (!isSequel && !isPrequel) continue;
      if (!rel.media_external_id) continue;
      const a = rel.media_external_id;
      const b = rel.related_media_external_id;
      if (!byId.has(a) || !byId.has(b)) continue;
      if (!SAGA_GROUPABLE_TYPES.has(byId.get(a)!.type) || !SAGA_GROUPABLE_TYPES.has(byId.get(b)!.type)) continue;

      // relation_type is from `a`'s point of view: a SEQUEL edge to b means a
      // comes first; a PREQUEL edge to b means b comes first.
      const [earlier, later] = isSequel ? [a, b] : [b, a];
      if (parentOf.has(later)) continue; // already grouped under something else

      const root = rootOf(earlier);
      if (root === later) continue; // would create a cycle
      parentOf.set(later, root);
    }
  }

  // Flatten multi-level chains (e.g. Rebirth → Remake → Original, from two
  // separate direct parent_id edges) so every entry in the chain ends up
  // pointing straight at the same ultimate root. Without this, the output
  // loop below only matches *direct* children of a root — Remake would show
  // up grouped under Original, but Rebirth (parented to Remake, not
  // Original) would neither get its own top-level card (it "has a parent")
  // nor appear in anyone's grouped list, vanishing from the grid entirely.
  for (const id of [...parentOf.keys()]) {
    parentOf.set(id, rootOf(id));
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
  let [rawItems, catalogEntries, sagaRelations] = await Promise.all([
    getAllLibraryEntries().catch(() => []),
    getAllCatalogEntries().catch(() => [] as MediaCatalogEntry[]),
    getAllMediaRelations().catch(() => [] as DbMediaRelation[]),
  ]);
  // Refreshes the localStorage cache read by buildRatingHtml's
  // getActiveRatingSystem() below — see syncActiveRatingSystem's own doc.
  await syncActiveRatingSystem();

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
          return getItemMinutes(b, catalogMap) - getItemMinutes(a, catalogMap);
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
        // Saga (prequel/sequel) grouping always runs — see groupEditions'
        // own doc — only the edition-specific signals are gated behind the
        // "Agrupar por ediciones" toggle.
        const cards = groupEditions(sec.items, catalogMap, sagaRelations, groupByEdition);

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
          const stackClass = grouped.length > 0 ? ' library-card-cell--stacked' : '';
          // Chronological, earliest first — so a saga's flyout reads left to
          // right in release order (SH1, SH2, SH3, ...) instead of whatever
          // order the section's own sort (rating/date-finished/duration)
          // happened to leave them in.
          const orderedGrouped = [...grouped].sort((a, b) =>
            compareByReleaseDate(catalogMap.get(a.external_id) ?? {}, catalogMap.get(b.external_id) ?? {})
          );
          const groupedTitles = orderedGrouped.map(g => catalogMap.get(g.external_id)?.title_main ?? g.external_id);
          const badge = grouped.length > 0
            ? `<span class="library-card-group-badge" title="${p.library_group_editions_hint}: ${groupedTitles.join(', ').replace(/"/g, '&quot;')}">+${grouped.length}</span>`
            : '';
          const tagBadges = buildTagBadgesHtml(item.tags);

          // Hidden until hover (see .library-card--stacked:hover in
          // profile.css) — a peek at exactly what's collapsed under the
          // "+N" badge, sliding out to the right instead of making the user
          // guess from the badge's tooltip alone.
          const stackExtra = grouped.length > 0
            ? `<div class="library-card-stack-extra">
                ${orderedGrouped.map(g => {
                  const gMeta  = catalogMap.get(g.external_id);
                  const gTitle = gMeta?.title_main ?? g.external_id;
                  const gCover = gMeta?.cover_url ?? '';
                  const gUrl   = `/media?id=${encodeURIComponent(g.external_id)}`;
                  return `<a class="library-card-stack-extra-item" href="${gUrl}" title="${gTitle.replace(/"/g, '&quot;')}" onclick="event.stopPropagation()">
                    ${gCover
                      ? `<img src="${gCover}" alt="${gTitle}" loading="lazy" />`
                      : `<div class="library-card-no-cover"><span>${gTitle.slice(0, 2).toUpperCase()}</span></div>`
                    }
                  </a>`;
                }).join('')}
              </div>`
            : '';

          // .library-card-stack-extra is a *sibling* of .library-card, both
          // wrapped in .library-card-cell, instead of a child of the card
          // itself. The card needs overflow:hidden permanently (it clips
          // its own blurred cover background) — toggling that off on hover
          // so the flyout could escape also un-clipped the blur, making the
          // card visibly wider than its column on every hover, grouped or
          // not. The wrapper carries overflow:visible instead, and has no
          // painted content of its own to worry about clipping.
          return `
                <div class="library-card-cell${stackClass}">
                  <div class="library-card" data-id="${item.external_id}" ${style}>
                    ${cover ? `<div class="library-card-bg"></div>` : ''}
                    ${badge}
                    ${tagBadges ? `<div class="library-card-tag-badges">${tagBadges}</div>` : ''}
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
                  </div>
                  ${stackExtra}
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
