import { getAllLibraryEntries, getAllCatalogEntries } from '../tauri';
import type { MediaCatalogEntry } from '../tauri';
import { getT } from '../../i18n/client';
import { getActiveRatingSystem, syncActiveRatingSystem, formatRatingHtml, dbRatingToStars5 } from '../media/rating-utils';
import { typeIconMap } from '../shared/icon-strings';
import { HOF_GRADIENTS } from './hof';

import { TYPE_LABELS } from '../constants/media';

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escAttr(s: string): string {
  return s.replace(/"/g, '&quot;');
}

export async function renderReviews(el: HTMLElement): Promise<void> {
  const t = getT();
  const p = t.profile;
  const TYPE_ICON = typeIconMap(14);

  el.innerHTML = `<div class="profile-empty"><p>${p.stats_loading}</p></div>`;

  const [items, catalogEntries] = await Promise.all([
    getAllLibraryEntries().catch(() => []),
    getAllCatalogEntries().catch(() => [] as MediaCatalogEntry[]),
  ]);
  // Refreshes the localStorage cache read by render()'s getActiveRatingSystem()
  // below — see syncActiveRatingSystem's own doc.
  await syncActiveRatingSystem();

  const catalogMap = new Map<string, MediaCatalogEntry>(
    catalogEntries.map(e => [e.external_id, e])
  );

  const reviewed = items.filter(item => item.notes && item.notes.trim().length > 0);

  if (reviewed.length === 0) {
    el.innerHTML = `
      <div class="profile-empty">
        <span class="profile-empty-icon">✍️</span>
        <p>${p.reviews_empty}</p>
      </div>`;
    return;
  }

  let sortMode: 'date' | 'rating' = 'date';
  let filterType = '';
  let searchQuery = '';

  const getFiltered = () => {
    let res = reviewed;
    if (filterType) res = res.filter(i => i.type === filterType);
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      res = res.filter(i => {
        const meta = catalogMap.get(i.external_id);
        const title = meta?.title_main ?? i.external_id;
        return title.toLowerCase().includes(q) || (i.notes ?? '').toLowerCase().includes(q);
      });
    }
    if (sortMode === 'date') {
      return res.slice().sort((a, b) =>
        (b.updated_at ?? b.added_at ?? '').localeCompare(a.updated_at ?? a.added_at ?? '')
      );
    }
    return res.slice().sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));
  };

  const render = () => {
    const filtered = getFiltered();
    const system = getActiveRatingSystem();

    const types = [...new Set(reviewed.map(i => i.type))];
    const typeFilterHtml = [
      `<button class="reviews-type-btn ${!filterType ? 'active' : ''}" data-type=""><span>${t.profile.section_all}</span></button>`,
      ...types.map(tp => `
        <button class="reviews-type-btn ${filterType === tp ? 'active' : ''}" data-type="${tp}">
          ${TYPE_ICON[tp] ?? TYPE_ICON['book']}
          <span>${TYPE_LABELS[tp] ?? tp}</span>
        </button>
      `),
    ].join('');

    const cardsHtml = filtered.map(item => {
      const meta  = catalogMap.get(item.external_id);
      const title = meta?.title_main ?? item.external_id;
      const cover = meta?.cover_url ?? '';
      const fallback = HOF_GRADIENTS[item.type] ?? 'linear-gradient(160deg,#374151,#1f2937)';
      const date  = (item.updated_at ?? item.added_at ?? '').slice(0, 10);
      const ratingHtml = item.rating
        ? formatRatingHtml(item.rating, system)
        : `<span style="color:var(--text-dim)">—</span>`;
      const url = `/media?id=${encodeURIComponent(item.external_id)}`;

      return `
        <article class="review-card">
          <a class="review-card-cover-link" href="${url}">
            ${cover
              ? `<img class="review-card-cover" src="${esc(cover)}" alt="${escAttr(title)}" loading="lazy">`
              : `<div class="review-card-cover review-card-cover--fallback" style="background:${fallback}"><span>${esc(title.slice(0, 2).toUpperCase())}</span></div>`}
          </a>
          <div class="review-card-body">
            <div class="review-card-header">
              <a href="${url}" class="review-card-title">${esc(title)}</a>
              <div class="review-card-meta">
                <span class="review-card-type">${TYPE_ICON[item.type] ?? ''} ${TYPE_LABELS[item.type] ?? item.type}</span>
                <span class="review-card-rating">${ratingHtml}</span>
                ${date ? `<time class="review-card-date">${esc(date)}</time>` : ''}
              </div>
            </div>
            <p class="review-card-note">${esc(item.notes ?? '')}</p>
          </div>
        </article>
      `;
    }).join('');

    el.innerHTML = `
      <div class="reviews-layout">
        <div class="reviews-toolbar">
          <input type="text" class="reviews-search" placeholder="${escAttr(p.reviews_search)}" value="${escAttr(searchQuery)}">
          <div class="reviews-type-filters">${typeFilterHtml}</div>
          <div class="reviews-sort">
            <button class="reviews-sort-btn ${sortMode === 'date'   ? 'active' : ''}" data-sort="date">${p.reviews_sort_date}</button>
            <button class="reviews-sort-btn ${sortMode === 'rating' ? 'active' : ''}" data-sort="rating">${p.reviews_sort_rating}</button>
          </div>
        </div>
        <p class="reviews-count">${filtered.length} ${filtered.length === 1 ? 'reseña' : 'reseñas'}</p>
        ${filtered.length > 0
          ? `<div class="reviews-list">${cardsHtml}</div>`
          : `<div class="profile-empty" style="padding:2rem 0"><p>Sin resultados.</p></div>`}
      </div>
    `;

    (el.querySelector<HTMLInputElement>('.reviews-search'))
      ?.addEventListener('input', e => {
        searchQuery = (e.target as HTMLInputElement).value;
        render();
      });

    el.querySelectorAll<HTMLElement>('.reviews-type-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        filterType = btn.dataset.type ?? '';
        render();
      });
    });

    el.querySelectorAll<HTMLElement>('.reviews-sort-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        sortMode = (btn.dataset.sort ?? 'date') as 'date' | 'rating';
        render();
      });
    });
  };

  render();
}
