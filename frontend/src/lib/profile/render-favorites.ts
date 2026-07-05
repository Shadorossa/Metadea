import { getAllLibraryEntries, getAllCatalogEntries, readUserFavorites, writeUserFavorites } from '../tauri';
import type { MediaCatalogEntry } from '../tauri';
import { getT } from '../../i18n/client';
import { dbRatingToStars5 } from '../media/rating-utils';
import { typeIconMap } from '../shared/icon-strings';

type Items = Awaited<ReturnType<typeof getAllLibraryEntries>>;

const TYPE_ICON = typeIconMap(16);

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
    await writeUserFavorites(favData).catch(err => console.error('Failed to persist favorites reorder:', err));
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
