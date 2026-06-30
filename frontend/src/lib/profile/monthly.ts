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

  const content = sortedKeys.map(key => {
    let monthLabel = '?', yearLabel = '';
    const parts = key.split('-');
    if (parts.length === 2) {
      const [y, m] = parts;
      yearLabel  = y;
      monthLabel = formatMonthLabel(Number(y), Number(m));
    }

    const itemIds = history[key] || [];
    const itemCount = itemIds.length;

    const items = itemIds.map(extId => {
      const item  = libMap.get(extId);
      const meta  = catalogMap.get(extId);
      const type  = item?.type ?? 'game';
      const title = meta?.title_main ?? extId;
      const cover = meta?.cover_url ?? '';
      const bg    = HOF_GRADIENTS[type] ?? 'linear-gradient(160deg, #374151, #1f2937)';
      return `<div class="mh-card-item" style="background:${bg}" title="${title}">
        ${cover ? `<img src="${cover}" alt="${title}" loading="lazy" />` : ''}
        <span class="mh-card-item-label">${title}</span>
      </div>`;
    }).join('');

    return `<div class="mh-month-card">
      <div class="mh-month-header">
        <div class="mh-month-label">
          <span class="mh-month-name">${monthLabel}</span>
          <span class="mh-month-year">${yearLabel}</span>
        </div>
        <span class="mh-month-count">${itemCount} ${itemCount === 1 ? 'obra' : 'obras'}</span>
      </div>
      <div class="mh-items-grid">
        ${items}
      </div>
    </div>`;
  }).join('');

  return `<div class="monthly-history">
    ${content}
  </div>`;
}
