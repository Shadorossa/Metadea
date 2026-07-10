import { HOF_GRADIENTS } from './hof';
import { formatMonthLabel } from './utils';
import type { getAllLibraryEntries } from '../tauri';

type Items = Awaited<ReturnType<typeof getAllLibraryEntries>>;

export function buildMonthlyHistoryHtml(
  history: Record<string, string[]>,
  libraryEntries: Items,
  catalogMap: Map<string, any>
): string {
  const sortedKeys = Object.keys(history).sort((a, b) => b.localeCompare(a));

  if (sortedKeys.length === 0) {
    return `<div class="act-empty"><span>No hay historial mensual disponible</span></div>`;
  }

  const libMap = new Map(libraryEntries.map(item => [item.external_id, item]));

  const topRow: string[] = [];
  const bottomRow: string[] = [];

  sortedKeys.forEach((key, idx) => {
    let monthLabel = '?', yearLabel = '';
    const parts = key.split('-');
    if (parts.length === 2) {
      const [y, m] = parts;
      yearLabel  = y;
      monthLabel = formatMonthLabel(Number(y), Number(m));
    }

    const itemIds = history[key] || [];
    const mainItem = itemIds[0];
    const item  = mainItem ? libMap.get(mainItem) : null;
    const meta  = mainItem ? catalogMap.get(mainItem) : null;
    const cover = meta?.cover_url ?? '';
    const bg    = cover ? `url('${cover}')` : (HOF_GRADIENTS[item?.type ?? 'game'] ?? 'linear-gradient(160deg, #374151, #1f2937)');

    const card = `<div class="mh-card" style="background-image:${bg.startsWith('url') ? bg : 'none'};background:${bg.startsWith('url') ? '' : bg}" title="${monthLabel}">
      <div class="mh-card-overlay"></div>
      <div class="mh-card-content">
        <span class="mh-card-month">${monthLabel}</span>
        <span class="mh-card-year">${yearLabel}</span>
      </div>
    </div>`;

    if (idx % 2 === 0) {
      topRow.push(card);
    } else {
      bottomRow.push(card);
    }
  });

  return `<div class="monthly-history">
    <button type="button" class="mh-arrow mh-arrow-left" aria-label="Anterior" disabled>‹</button>
    <div class="mh-scroll">
      <div class="mh-zigzag">
        <div class="mh-row-top">
          ${topRow.join('')}
        </div>
        <div class="mh-row-bottom">
          ${bottomRow.join('')}
        </div>
      </div>
    </div>
    <button type="button" class="mh-arrow mh-arrow-right" aria-label="Siguiente">›</button>
  </div>`;
}

// Left/right arrows scroll .mh-scroll instead of the row overflowing its
// column and visually bleeding into the Recent Activity sidebar next to it
// (the row has no wrap and used to just grow as wide as the month count
// needed). Disables whichever arrow is at its end of the scroll range, and
// toggles the matching edge fade (see .at-start/.at-end in profile.css) so
// the fade never implies there's more to scroll on a side where there isn't.
export function initMonthlyHistoryListeners(container: HTMLElement): void {
  const scrollEl = container.querySelector<HTMLElement>('.mh-scroll');
  const leftBtn = container.querySelector<HTMLButtonElement>('.mh-arrow-left');
  const rightBtn = container.querySelector<HTMLButtonElement>('.mh-arrow-right');
  if (!scrollEl || !leftBtn || !rightBtn) return;

  const SCROLL_STEP = 300;

  function updateArrows() {
    if (!scrollEl) return;
    const atStart = scrollEl.scrollLeft <= 0;
    const atEnd = scrollEl.scrollLeft >= scrollEl.scrollWidth - scrollEl.clientWidth - 1;
    leftBtn!.disabled = atStart;
    rightBtn!.disabled = atEnd;
    scrollEl.classList.toggle('at-start', atStart);
    scrollEl.classList.toggle('at-end', atEnd);
  }

  leftBtn.addEventListener('click', () => scrollEl.scrollBy({ left: -SCROLL_STEP, behavior: 'smooth' }));
  rightBtn.addEventListener('click', () => scrollEl.scrollBy({ left: SCROLL_STEP, behavior: 'smooth' }));
  scrollEl.addEventListener('scroll', updateArrows);
  updateArrows();
}
