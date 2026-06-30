import { getAllLibraryEntries, getAllCatalogEntries, readUserLists, writeUserLists } from '../tauri';
import type { MediaCatalogEntry, UserList } from '../tauri';
import { getT } from '../../i18n/client';
import { HOF_GRADIENTS } from './hof';
import { dbRatingToStars5 } from '../media/rating-utils';

const TYPE_LABELS: Record<string, string> = {
  anime: 'Anime', manga: 'Manga', novel: 'Novela Ligera', game: 'Videojuego',
  vnovel: 'Novela Visual', series: 'Serie', movie: 'Película', book: 'Libro',
};

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escAttr(s: string): string {
  return s.replace(/"/g, '&quot;');
}

function genId(): string {
  return `list_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

export async function renderLists(el: HTMLElement): Promise<void> {
  const t  = getT();
  const p  = t.profile;

  el.innerHTML = `<div class="profile-empty"><p>${p.stats_loading}</p></div>`;

  const [items, catalogEntries, storedLists] = await Promise.all([
    getAllLibraryEntries().catch(() => []),
    getAllCatalogEntries().catch(() => [] as MediaCatalogEntry[]),
    readUserLists().catch(() => [] as UserList[]),
  ]);

  const catalogMap = new Map<string, MediaCatalogEntry>(
    catalogEntries.map(e => [e.external_id, e])
  );

  let userLists: UserList[] = storedLists;
  let activeListId: string | null = null;
  let isCreating = false;

  const save = async () => writeUserLists(userLists).catch(() => {});

  // ── Grid view ─────────────────────────────────────────────────────────────

  const renderGrid = () => {
    isCreating = false;

    const gridHtml = userLists.map(list => {
      const previewMetas = list.item_ids.slice(0, 4).map(id => catalogMap.get(id));
      const collageHtml = previewMetas.map(meta => {
        const cover    = meta?.cover_url ?? '';
        const fallback = HOF_GRADIENTS[meta?.type ?? 'anime'] ?? 'linear-gradient(160deg,#374151,#1f2937)';
        return cover
          ? `<img class="list-card-collage-img" src="${esc(cover)}" alt="" loading="lazy">`
          : `<div class="list-card-collage-img list-card-collage-fallback" style="background:${fallback}"></div>`;
      }).join('');

      return `
        <div class="list-card" data-list-id="${list.id}">
          <div class="list-card-collage${previewMetas.length === 0 ? ' list-card-collage--empty' : ''}">
            ${collageHtml || '<span class="list-card-empty-icon">📋</span>'}
          </div>
          <div class="list-card-info">
            <span class="list-card-title">${esc(list.name)}</span>
            <span class="list-card-count">${list.item_ids.length} ${p.lists_items}</span>
            ${list.description ? `<span class="list-card-desc">${esc(list.description)}</span>` : ''}
          </div>
        </div>
      `;
    }).join('');

    const createFormHtml = isCreating ? `
      <div class="list-create-form">
        <input type="text" class="list-input list-create-name" placeholder="${escAttr(p.lists_name_ph)}" maxlength="60" autofocus>
        <input type="text" class="list-input list-create-desc" placeholder="${escAttr(p.lists_desc_ph)}" maxlength="200">
        <div class="list-create-actions">
          <button class="list-btn list-btn--primary" id="list-create-confirm">${p.lists_create}</button>
          <button class="list-btn list-btn--ghost" id="list-create-cancel">${p.lists_cancel}</button>
        </div>
      </div>
    ` : '';

    el.innerHTML = `
      <div class="lists-layout">
        <div class="lists-header">
          <h2 class="lists-title">${p.lists}</h2>
          <button class="list-btn list-btn--primary" id="list-new-btn">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            ${p.lists_new}
          </button>
        </div>
        ${createFormHtml}
        ${userLists.length > 0
          ? `<div class="lists-grid">${gridHtml}</div>`
          : `<div class="lists-empty-state">
               <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/></svg>
               <p>${p.lists_empty}</p>
             </div>`
        }
      </div>
    `;

    el.querySelector('#list-new-btn')?.addEventListener('click', () => {
      isCreating = true;
      renderGrid();
    });

    el.querySelector('#list-create-cancel')?.addEventListener('click', () => {
      isCreating = false;
      renderGrid();
    });

    el.querySelector('#list-create-confirm')?.addEventListener('click', async () => {
      const nameEl = el.querySelector('.list-create-name') as HTMLInputElement | null;
      const descEl = el.querySelector('.list-create-desc') as HTMLInputElement | null;
      const name = nameEl?.value.trim();
      if (!name) { nameEl?.focus(); return; }

      userLists.push({
        id:          genId(),
        name,
        description: descEl?.value.trim() ?? '',
        created_at:  new Date().toISOString(),
        item_ids:    [],
      });
      await save();
      isCreating = false;
      renderGrid();
    });

    el.querySelectorAll<HTMLElement>('.list-card').forEach(card => {
      card.addEventListener('click', () => {
        activeListId = card.dataset.listId ?? null;
        if (activeListId) renderDetail(activeListId);
      });
    });
  };

  // ── Detail view ───────────────────────────────────────────────────────────

  const renderDetail = (listId: string) => {
    const list = userLists.find(l => l.id === listId);
    if (!list) { renderGrid(); return; }

    let searchQuery  = '';
    let showAddPanel = false;
    let isEditingMeta = false;

    const renderDetailContent = () => {
      const listEntries = list.item_ids.map(id => ({
        id,
        entry:  items.find(i => i.external_id === id),
        meta:   catalogMap.get(id),
      }));

      const listItemsHtml = listEntries.map(({ id, entry, meta }) => {
        const title    = meta?.title_main ?? id;
        const cover    = meta?.cover_url  ?? '';
        const fallback = HOF_GRADIENTS[meta?.type ?? 'anime'] ?? 'linear-gradient(160deg,#374151,#1f2937)';
        const url      = `/media?id=${encodeURIComponent(id)}`;
        const typeLabel = TYPE_LABELS[meta?.type ?? ''] ?? (meta?.type ?? '');

        return `
          <div class="list-item-card">
            <a class="list-item-cover-link" href="${url}">
              ${cover
                ? `<img class="list-item-cover" src="${esc(cover)}" alt="${escAttr(title)}" loading="lazy">`
                : `<div class="list-item-cover list-item-cover--fallback" style="background:${fallback}"><span>${esc(title.slice(0, 2).toUpperCase())}</span></div>`}
            </a>
            <div class="list-item-info">
              <a class="list-item-title" href="${url}">${esc(title)}</a>
              ${typeLabel ? `<span class="list-item-type">${esc(typeLabel)}</span>` : ''}
              ${entry?.rating ? `<span class="list-item-rating">★ ${dbRatingToStars5(entry.rating).toFixed(1)}</span>` : ''}
            </div>
            <button class="list-item-remove" data-remove-id="${id}" title="Quitar">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
        `;
      }).join('');

      // Add-from-library panel
      const addPanelHtml = (() => {
        if (!showAddPanel) return '';
        const q = searchQuery.toLowerCase();
        const available = items
          .filter(i => !list.item_ids.includes(i.external_id))
          .filter(i => {
            if (!q) return true;
            const meta  = catalogMap.get(i.external_id);
            return (meta?.title_main ?? i.external_id).toLowerCase().includes(q);
          })
          .slice(0, 30);

        const resultsHtml = available.map(item => {
          const meta    = catalogMap.get(item.external_id);
          const title   = meta?.title_main ?? item.external_id;
          const cover   = meta?.cover_url  ?? '';
          const fallback = HOF_GRADIENTS[item.type] ?? 'linear-gradient(160deg,#374151,#1f2937)';
          return `
            <div class="list-add-item">
              ${cover
                ? `<img class="list-add-cover" src="${esc(cover)}" alt="" loading="lazy">`
                : `<div class="list-add-cover list-add-cover--fallback" style="background:${fallback}"></div>`}
              <span class="list-add-title">${esc(title)}</span>
              <button class="list-add-btn" data-add-id="${item.external_id}">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              </button>
            </div>
          `;
        }).join('');

        return `
          <div class="list-add-panel">
            <div class="list-add-search-row">
              <input type="text" class="list-add-search" placeholder="${escAttr(p.lists_search_library)}" value="${escAttr(searchQuery)}" autofocus>
              <button class="list-btn list-btn--ghost" id="list-add-close">✕</button>
            </div>
            <div class="list-add-results">
              ${available.length > 0
                ? resultsHtml
                : `<p style="color:var(--text-dim);font-size:0.8rem;text-align:center;padding:1rem 0">Sin resultados</p>`}
            </div>
          </div>
        `;
      })();

      // Meta header: editable or display
      const metaHtml = isEditingMeta ? `
        <div class="list-detail-meta-edit">
          <input type="text" class="list-input list-meta-name-input" value="${escAttr(list.name)}" maxlength="60" placeholder="${escAttr(p.lists_name_ph)}">
          <input type="text" class="list-input list-meta-desc-input" value="${escAttr(list.description ?? '')}" maxlength="200" placeholder="${escAttr(p.lists_desc_ph)}">
          <div class="list-create-actions">
            <button class="list-btn list-btn--primary" id="list-meta-save">Guardar</button>
            <button class="list-btn list-btn--ghost" id="list-meta-cancel">${p.lists_cancel}</button>
          </div>
        </div>
      ` : `
        <div class="list-detail-meta">
          <h2 class="list-detail-title">${esc(list.name)}</h2>
          ${list.description ? `<p class="list-detail-desc">${esc(list.description)}</p>` : ''}
        </div>
      `;

      el.innerHTML = `
        <div class="list-detail-layout">
          <div class="list-detail-nav">
            <button class="list-back-btn" id="list-back">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5"/><polyline points="12 19 5 12 12 5"/></svg>
              ${p.lists_back}
            </button>
            <div class="list-detail-actions">
              <button class="list-btn list-btn--ghost" id="list-meta-edit">${p.lists_edit}</button>
              <button class="list-btn list-btn--danger" id="list-delete">${p.lists_delete}</button>
            </div>
          </div>
          ${metaHtml}
          ${addPanelHtml}
          <div class="list-detail-content">
            <div class="list-detail-header-row">
              <span class="list-detail-count">${list.item_ids.length} ${p.lists_items}</span>
              <button class="list-btn list-btn--primary" id="list-add-toggle">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                ${p.lists_add_items}
              </button>
            </div>
            ${list.item_ids.length > 0
              ? `<div class="list-items-grid">${listItemsHtml}</div>`
              : `<div class="lists-empty-state" style="padding:2rem 0"><p>${p.lists_empty_items}</p></div>`}
          </div>
        </div>
      `;

      // Back
      el.querySelector('#list-back')?.addEventListener('click', () => {
        activeListId = null;
        renderGrid();
      });

      // Edit meta
      el.querySelector('#list-meta-edit')?.addEventListener('click', () => {
        isEditingMeta = true;
        renderDetailContent();
      });
      el.querySelector('#list-meta-cancel')?.addEventListener('click', () => {
        isEditingMeta = false;
        renderDetailContent();
      });
      el.querySelector('#list-meta-save')?.addEventListener('click', async () => {
        const nameEl = el.querySelector('.list-meta-name-input') as HTMLInputElement | null;
        const descEl = el.querySelector('.list-meta-desc-input') as HTMLInputElement | null;
        const name = nameEl?.value.trim();
        if (!name) { nameEl?.focus(); return; }
        list.name        = name;
        list.description = descEl?.value.trim() ?? '';
        await save();
        isEditingMeta = false;
        renderDetailContent();
      });

      // Delete list
      el.querySelector('#list-delete')?.addEventListener('click', async () => {
        if (!confirm(`¿Eliminar la lista "${list.name}"?`)) return;
        userLists = userLists.filter(l => l.id !== list.id);
        await save();
        activeListId = null;
        renderGrid();
      });

      // Add panel toggle
      el.querySelector('#list-add-toggle')?.addEventListener('click', () => {
        showAddPanel = !showAddPanel;
        searchQuery  = '';
        renderDetailContent();
      });
      el.querySelector('#list-add-close')?.addEventListener('click', () => {
        showAddPanel = false;
        searchQuery  = '';
        renderDetailContent();
      });

      // Live search inside add panel
      (el.querySelector('.list-add-search') as HTMLInputElement | null)
        ?.addEventListener('input', e => {
          searchQuery = (e.target as HTMLInputElement).value;
          renderDetailContent();
        });

      // Add item to list
      el.querySelectorAll<HTMLElement>('.list-add-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          const id = btn.dataset.addId ?? '';
          if (!id || list.item_ids.includes(id)) return;
          list.item_ids.push(id);
          await save();
          renderDetailContent();
        });
      });

      // Remove item from list
      el.querySelectorAll<HTMLElement>('.list-item-remove').forEach(btn => {
        btn.addEventListener('click', async () => {
          const id = btn.dataset.removeId ?? '';
          list.item_ids = list.item_ids.filter(x => x !== id);
          await save();
          renderDetailContent();
        });
      });
    };

    renderDetailContent();
  };

  renderGrid();
}
