import { HOF_GRADIENTS } from './hof';
import { formatMonthLabel } from './utils';
import type { getLibraryItems } from '../tauri';

type Items = Awaited<ReturnType<typeof getLibraryItems>>;

export function buildMonthlyHistoryHtml(items: Items): string {
  const sorted = [...items].sort((a, b) => {
    if (a.created_at && b.created_at) return b.created_at.localeCompare(a.created_at);
    return (b.id ?? 0) - (a.id ?? 0);
  });

  const map = new Map<string, typeof sorted>();
  for (const item of sorted) {
    const d   = item.created_at ? new Date(item.created_at) : null;
    const key = d
      ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      : '__';
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(item);
  }

  const content = [...map.entries()].map(([key, its]) => {
    let monthLabel = '?', yearLabel = '';
    if (key !== '__') {
      const [y, m] = key.split('-');
      yearLabel  = y;
      monthLabel = formatMonthLabel(Number(y), Number(m));
    }

    const row1 = its.filter((_, i) => i % 2 === 0);
    const row2 = its.filter((_, i) => i % 2 === 1);

    const card = (item: typeof its[0]) => {
      const bg = HOF_GRADIENTS[item.item_type] ?? 'linear-gradient(160deg, #374151, #1f2937)';
      return `<div class="mh-card" style="background:${bg}" title="${item.external_id}">
        <span class="mh-card-label">${item.external_id}</span>
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
