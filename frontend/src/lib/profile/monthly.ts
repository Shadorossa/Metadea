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

    const row1 = itemIds.filter((_, i) => i % 2 === 0);
    const row2 = itemIds.filter((_, i) => i % 2 === 1);

    const card = (extId: string) => {
      const item  = libMap.get(extId);
      const meta  = catalogMap.get(extId);
      const type  = item?.type ?? 'game';
      const title = meta?.title_main ?? extId;
      const cover = meta?.cover_url ?? '';
      const bg    = HOF_GRADIENTS[type] ?? 'linear-gradient(160deg, #374151, #1f2937)';
      return `<div class="mh-card" style="background:${bg}" title="${title}">
        ${cover ? `<img src="${cover}" alt="${title}" loading="lazy" />` : ''}
        <span class="mh-card-label">${title}</span>
      </div>`;
    };

    return `<div class="mh-group">
      <div class="mh-badge">
        <span class="mh-badge-month">${monthLabel}</span>
        ${yearLabel ? `<span class="mh-badge-year">${yearLabel}</span>` : ''}
      </div>
      <div class="mh-rows">
        <div class="mh-row">${row1.map(card).join('')}</div>
        ${row2.length > 0 ? `<div class="mh-row">${row2.map(card).join('')}</div>` : ''}
      </div>
    </div>`;
  }).join('');

  return `<div class="monthly-history">
    <div class="mh-track">${content}</div>
  </div>`;
}
