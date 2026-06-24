import { HOF_GRADIENTS } from './hof';
import { typeLabel, statusLabel, formatShortDate } from './utils';
import { getT } from '../../i18n/client';
import type { getLibraryItems } from '../tauri';

type Items = Awaited<ReturnType<typeof getLibraryItems>>;
type P     = ReturnType<typeof getT>['profile'];

export function buildActivityHtml(items: Items, p: P): string {
  const recent = [...items]
    .sort((a, b) => {
      const ta = a.updated_at ?? a.created_at ?? '';
      const tb = b.updated_at ?? b.created_at ?? '';
      if (ta && tb) return tb.localeCompare(ta);
      return (b.id ?? 0) - (a.id ?? 0);
    })
    .slice(0, 10);

  if (recent.length === 0) {
    return `<div class="act-empty"><span>${p.no_activity}</span></div>`;
  }

  const rows = recent.map(item => {
    const bg     = HOF_GRADIENTS[item.item_type] ?? 'linear-gradient(160deg, #374151, #1f2937)';
    const type   = typeLabel(item.item_type);
    const status = statusLabel(item.status ?? 'planning');
    const raw    = item.updated_at ?? item.created_at;
    const date   = raw ? formatShortDate(raw) : '';

    return `<div class="act-card">
      <div class="act-cover" style="background:${bg}"></div>
      <div class="act-info">
        <span class="act-title">${item.external_id}</span>
        <span class="act-meta">${type} · ${status}</span>
      </div>
      ${date ? `<span class="act-date">${date}</span>` : ''}
    </div>`;
  }).join('');

  return `<div class="activity-feed">${rows}</div>`;
}
