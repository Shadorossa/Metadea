import { HOF_GRADIENTS } from './hof';
import { typeLabel, statusLabel, formatShortDate } from './utils';
import { getT } from '../../i18n/client';
import type { getAllLibraryEntries } from '../tauri';

type Items = Awaited<ReturnType<typeof getAllLibraryEntries>>;
type P     = ReturnType<typeof getT>['profile'];

export function buildActivityHtml(items: Items, catalogMap: Map<string, any>, p: P): string {
  const recent = [...items]
    .sort((a, b) => {
      const ta = a.updated_at ?? a.added_at ?? '';
      const tb = b.updated_at ?? b.added_at ?? '';
      return tb.localeCompare(ta);
    })
    .slice(0, 10);

  if (recent.length === 0) {
    return `<div class="act-empty"><span>${p.no_activity}</span></div>`;
  }

  const rows = recent.map(item => {
    const meta   = catalogMap.get(item.external_id);
    const title  = meta?.title_main ?? item.external_id;
    const cover  = meta?.cover_url ?? '';
    const bg     = HOF_GRADIENTS[item.type] ?? 'linear-gradient(160deg, #374151, #1f2937)';
    const type   = typeLabel(item.type);
    const status = statusLabel(item.status ?? 'planning');
    const raw    = item.updated_at ?? item.added_at;
    const date   = raw ? formatShortDate(raw) : '';

    const style  = cover
      ? `background-image: url('${cover}'); background-size: cover; background-position: center;`
      : `background: ${bg};`;

    return `<div class="act-card">
      <div class="act-cover" style="${style}"></div>
      <div class="act-info">
        <span class="act-title">${title}</span>
        <span class="act-meta">${type} · ${status}</span>
      </div>
      ${date ? `<span class="act-date">${date}</span>` : ''}
    </div>`;
  }).join('');

  return `<div class="activity-feed">${rows}</div>`;
}
