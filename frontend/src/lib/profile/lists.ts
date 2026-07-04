import {
  getAllLibraryEntries, getAllCatalogEntries, getUserInfo,
  getAllUserLists, getListItemsFull, createUserList, updateUserList,
  deleteUserList, addItemToList, removeItemFromList, reorderListItems,
} from '../tauri';
import type { MediaCatalogEntry, ListInfo, ListItemFull } from '../tauri';
import { getT } from '../../i18n/client';
import { HOF_GRADIENTS } from './hof';
import { dbRatingToStars5 } from '../media/rating-utils';

import { TYPE_LABELS, FAV_LABELS } from '../constants/media';

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escAttr(s: string): string {
  return s.replace(/"/g, '&quot;');
}

export async function renderLists(el: HTMLElement): Promise<void> {
  const t  = getT();
  const p  = t.profile;

  el.innerHTML = `<div class="profile-empty"><p>${p.stats_loading}</p></div>`;

  const [items, catalogEntries, allLists, profile] = await Promise.all([
    getAllLibraryEntries().catch(() => []),
    getAllCatalogEntries().catch(() => [] as MediaCatalogEntry[]),
    getAllUserLists().catch(() => [] as ListInfo[]),
    getUserInfo().catch(() => ({} as Record<string, unknown>)),
  ]);

  const catalogMap = new Map<string, MediaCatalogEntry>(
    catalogEntries.map(e => [e.external_id, e])
  );

  const username = (profile.display_name as string | undefined)?.toLowerCase().replace(/\s+/g, '_') || 'user';

  let customLists: ListInfo[] = allLists.filter(l => !l.is_fav);
  let favLists: ListInfo[]    = allLists.filter(l => l.is_fav && l.item_count > 0);
  let activeListKey: string | null = null;
  let isCreating = false;

  // ── Grid view ─────────────────────────────────────────────────────────────

  const renderGrid = () => {
    isCreating = false;

    const buildCard = (list: ListInfo, isFavCard: boolean) => {
      const previewMetas = list.preview_ids.map(id => catalogMap.get(id));
      const collageHtml = previewMetas.map(meta => {
        const cover    = meta?.cover_url ?? '';
        const fallback = HOF_GRADIENTS[meta?.type ?? 'anime'] ?? 'linear-gradient(160deg,#374151,#1f2937)';
        return cover
          ? `<img class="list-card-collage-img" src="${esc(cover)}" alt="" loading="lazy">`
          : `<div class="list-card-collage-img list-card-collage-fallback" style="background:${fallback}"></div>`;
      }).join('');

      const displayName = isFavCard ? (FAV_LABELS[list.key] ?? list.name) : list.name;

      return `
        <div class="list-card${isFavCard ? ' list-card--fav' : ''}" data-list-key="${list.key}">
          <div class="list-card-collage${previewMetas.length === 0 ? ' list-card-collage--empty' : ''}">
            ${collageHtml || `<span class="list-card-empty-icon">${isFavCard ? '★' : '📋'}</span>`}
          </div>
          <div class="list-card-info">
            <span class="list-card-title">${esc(displayName)}</span>
            <span class="list-card-count">${list.item_count} ${p.lists_items}</span>
          </div>
        </div>
      `;
    };

    const favGridHtml  = favLists.map(l  => buildCard(l, true)).join('');
    const customGridHtml = customLists.map(l => buildCard(l, false)).join('');

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
        ${favLists.length > 0 ? `
          <div class="lists-section">
            <h3 class="lists-section-title">Favoritos</h3>
            <div class="lists-grid">${favGridHtml}</div>
          </div>
        ` : ''}
        ${customLists.length > 0
          ? `<div class="lists-grid">${customGridHtml}</div>`
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

      const key = await createUserList(username, name, descEl?.value.trim() ?? '').catch(() => null);
      if (!key) return;
      customLists.push({ key, name, description: descEl?.value.trim() ?? '', is_fav: false, item_count: 0, preview_ids: [] });
      isCreating = false;
      renderGrid();
    });

    el.querySelectorAll<HTMLElement>('.list-card').forEach(card => {
      card.addEventListener('click', () => {
        activeListKey = card.dataset.listKey ?? null;
        if (activeListKey) renderDetail(activeListKey);
      });
    });
  };

  // ── Detail view ───────────────────────────────────────────────────────────

  const renderDetail = async (listKey: string) => {
    const allDisplayLists = [...customLists, ...favLists];
    const list = allDisplayLists.find(l => l.key === listKey);
    if (!list) { renderGrid(); return; }
    const isFav = list.is_fav;

    // Use SQL JOIN from backend — no manual catalog/library lookups
    let listItems: ListItemFull[] = await getListItemsFull(listKey).catch(() => []);

    let searchQuery  = '';
    let showAddPanel = false;
    let isEditingMeta = false;

    const renderDetailContent = () => {
      const currentIds = new Set(listItems.map(i => i.external_id));

      const listItemsHtml = listItems.map(item => {
        const title    = item.title_main ?? item.external_id;
        const cover    = item.cover_url  ?? '';
        const fallback = HOF_GRADIENTS[item.media_type ?? 'anime'] ?? 'linear-gradient(160deg,#374151,#1f2937)';
        const url      = `/media?id=${encodeURIComponent(item.external_id)}`;
        const typeLabel = TYPE_LABELS[item.media_type ?? ''] ?? (item.media_type ?? '');
        const ratingDisplay = item.rating ? `★ ${dbRatingToStars5(item.rating).toFixed(1)}` : null;

        return `
          <div class="list-item-card" data-id="${escAttr(item.external_id)}">
            <span class="list-item-drag-handle" title="Arrastrar para reordenar">⠿</span>
            <a class="list-item-cover-link" href="${url}">
              ${cover
                ? `<img class="list-item-cover" src="${esc(cover)}" alt="${escAttr(title)}" loading="lazy">`
                : `<div class="list-item-cover list-item-cover--fallback" style="background:${fallback}"><span>${esc(title.slice(0, 2).toUpperCase())}</span></div>`}
            </a>
            <div class="list-item-info">
              <a class="list-item-title" href="${url}">${esc(title)}</a>
              ${typeLabel ? `<span class="list-item-type">${esc(typeLabel)}</span>` : ''}
              ${ratingDisplay ? `<span class="list-item-rating">${ratingDisplay}</span>` : ''}
            </div>
            ${!isFav ? `<button class="list-item-remove" data-remove-id="${item.external_id}" title="Quitar">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>` : ''}
          </div>
        `;
      }).join('');

      // Add-from-library panel (custom lists only)
      const addPanelHtml = (() => {
        if (!showAddPanel || isFav) return '';
        const q = searchQuery.toLowerCase();
        const available = items
          .filter(i => !currentIds.has(i.external_id))
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

      // Meta header
      const metaHtml = (!isFav && isEditingMeta) ? `
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
          <h2 class="list-detail-title">${esc(isFav ? (FAV_LABELS[list.key] ?? list.name) : list.name)}</h2>
          ${(!isFav && list.description) ? `<p class="list-detail-desc">${esc(list.description)}</p>` : ''}
        </div>
      `;

      el.innerHTML = `
        <div class="list-detail-layout">
          <div class="list-detail-nav">
            <button class="list-back-btn" id="list-back">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5"/><polyline points="12 19 5 12 12 5"/></svg>
              ${p.lists_back}
            </button>
            ${!isFav ? `
            <div class="list-detail-actions">
              <button class="list-btn list-btn--ghost" id="list-meta-edit">${p.lists_edit}</button>
              <button class="list-btn list-btn--danger" id="list-delete">${p.lists_delete}</button>
            </div>` : ''}
          </div>
          ${metaHtml}
          ${addPanelHtml}
          <div class="list-detail-content">
            <div class="list-detail-header-row">
              <span class="list-detail-count">${listItems.length} ${p.lists_items}</span>
              ${!isFav ? `
              <button class="list-btn list-btn--primary" id="list-add-toggle">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                ${p.lists_add_items}
              </button>` : ''}
            </div>
            ${listItems.length > 0
              ? `<div class="list-items-grid">${listItemsHtml}</div>`
              : `<div class="lists-empty-state" style="padding:2rem 0"><p>${p.lists_empty_items}</p></div>`}
          </div>
        </div>
      `;

      // ── Pointer-based reordering (no floating ghost — card reorders in place) ─

      {
        const grid = el.querySelector('.list-items-grid') as HTMLElement | null;
        if (grid) {
          let dragCard: HTMLElement | null = null;
          let dragActive = false;

          // Cache of {el, cy, top, height} for non-dragged cards, only
          // refreshed right after an actual reorder swap — not on every
          // mousemove/rAF tick — to avoid forcing a reflow every frame.
          type CardRect = { el: HTMLElement; cy: number; top: number; height: number };
          let rectCache: CardRect[] = [];

          const refreshRectCache = () => {
            rectCache = Array.from(grid.querySelectorAll('.list-item-card:not(.drag-source)')).map(cardEl => {
              const r = (cardEl as HTMLElement).getBoundingClientRect();
              return { el: cardEl as HTMLElement, cy: r.top + r.height / 2, top: r.top, height: r.height };
            });
          };

          const getClosestCard = (clientY: number): CardRect | null => {
            let closest: CardRect | null = null;
            let closestDist = Infinity;
            for (const entry of rectCache) {
              const dist = Math.abs(clientY - entry.cy);
              if (dist < closestDist) { closestDist = dist; closest = entry; }
            }
            return closest;
          };

          let rafId = 0;
          let lastMoveY = 0;
          let prevMoveY = 0;

          // Which side of the target the dragged card lands on is decided
          // by the direction of travel, not a static 50/50 split — see
          // profile/render.ts for why (self-stabilizing, avoids the
          // oscillation flicker a fixed midpoint check causes).
          const reorderTick = () => {
            rafId = 0;
            if (!dragCard) return;
            const target = getClosestCard(lastMoveY);
            if (target && target.el !== dragCard) {
              const movingDown = lastMoveY >= prevMoveY;
              const midpoint = target.top + target.height / 2;
              const passedMidpoint = movingDown ? lastMoveY > midpoint : lastMoveY < midpoint;
              if (passedMidpoint) {
                if (movingDown) {
                  grid.insertBefore(dragCard, target.el.nextSibling);
                } else {
                  grid.insertBefore(dragCard, target.el);
                }
                refreshRectCache();
              }
            }
            prevMoveY = lastMoveY;
          };

          const onMouseMove = (e: MouseEvent) => {
            if (!dragActive || !dragCard) return;
            e.preventDefault();

            lastMoveY = e.clientY;
            if (!rafId) rafId = requestAnimationFrame(reorderTick);
          };

          const onMouseUp = async () => {
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
            if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }

            dragActive = false;
            if (dragCard) {
              dragCard.classList.remove('drag-source');

              const newIds = Array.from(grid.querySelectorAll('.list-item-card'))
                .map(c => (c as HTMLElement).dataset.id)
                .filter(Boolean) as string[];
              listItems.sort((a, b) => newIds.indexOf(a.external_id) - newIds.indexOf(b.external_id));

              reorderListItems(listKey, newIds).catch(() => {});

              dragCard = null;
              renderDetailContent();
            }
          };

          grid.querySelectorAll<HTMLElement>('.list-item-drag-handle').forEach(handle => {
            handle.addEventListener('mousedown', (e: MouseEvent) => {
              const card = handle.closest('.list-item-card') as HTMLElement | null;
              if (!card) return;
              e.preventDefault();
              window.getSelection()?.removeAllRanges();

              dragCard = card;
              dragActive = true;
              prevMoveY = e.clientY;
              card.classList.add('drag-source');
              refreshRectCache();

              document.addEventListener('mousemove', onMouseMove);
              document.addEventListener('mouseup', onMouseUp);
            });
          });
        }
      }

      // ── Event listeners ───────────────────────────────────────────────────

      el.querySelector('#list-back')?.addEventListener('click', () => {
        activeListKey = null;
        renderGrid();
      });

      if (!isFav) {
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
          await updateUserList(list.key, name, descEl?.value.trim() ?? '').catch(() => {});
          list.name        = name;
          list.description = descEl?.value.trim() ?? '';
          isEditingMeta = false;
          renderDetailContent();
        });

        el.querySelector('#list-delete')?.addEventListener('click', async () => {
          if (!confirm(`¿Eliminar la lista "${list.name}"?`)) return;
          await deleteUserList(list.key).catch(() => {});
          customLists = customLists.filter(l => l.key !== list.key);
          activeListKey = null;
          renderGrid();
        });

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

        (el.querySelector('.list-add-search') as HTMLInputElement | null)
          ?.addEventListener('input', e => {
            searchQuery = (e.target as HTMLInputElement).value;
            renderDetailContent();
          });

        el.querySelectorAll<HTMLElement>('.list-add-btn').forEach(btn => {
          btn.addEventListener('click', async () => {
            const id = btn.dataset.addId ?? '';
            if (!id || currentIds.has(id)) return;
            await addItemToList(list.key, id).catch(() => {});
            // Construct a partial ListItemFull from the pre-fetched data
            const libEntry = items.find(i => i.external_id === id);
            const meta     = catalogMap.get(id);
            listItems.push({
              external_id: id,
              position:    listItems.length,
              library_id:  libEntry?.id ?? null,
              status:      libEntry?.status ?? null,
              rating:      libEntry?.rating ?? null,
              progress:    libEntry?.progress ?? 0,
              progress_2:  libEntry?.progress_2 ?? 0,
              is_favorite: (libEntry?.is_favorite ?? 0) !== 0,
              is_platinum: (libEntry?.is_platinum ?? 0) !== 0,
              title_main:  meta?.title_main ?? null,
              cover_url:   meta?.cover_url  ?? null,
              media_type:  meta?.type       ?? null,
              format:      meta?.format     ?? null,
            });
            list.item_count++;
            renderDetailContent();
          });
        });

        el.querySelectorAll<HTMLElement>('.list-item-remove').forEach(btn => {
          btn.addEventListener('click', async () => {
            const id = btn.dataset.removeId ?? '';
            if (!id) return;
            await removeItemFromList(list.key, id).catch(() => {});
            listItems = listItems.filter(x => x.external_id !== id);
            list.item_count = Math.max(0, list.item_count - 1);
            renderDetailContent();
          });
        });
      }
    };

    renderDetailContent();
  };

  renderGrid();
}
