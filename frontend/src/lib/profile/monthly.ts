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
    <div class="mh-zigzag">
      <div class="mh-row-top">
        ${topRow.join('')}
      </div>
      <div class="mh-row-bottom">
        ${bottomRow.join('')}
      </div>
    </div>
  </div>`;
}
