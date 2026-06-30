import { typeLabel } from './utils';
import { getT } from '../../i18n/client';
import type { getAllLibraryEntries } from '../tauri';
import { buildStarHtml } from '../media/rating-utils';

type Items = Awaited<ReturnType<typeof getAllLibraryEntries>>;
type P     = ReturnType<typeof getT>['profile'];

export const HOF_GRADIENTS: Record<string, string> = {
  anime:  'linear-gradient(160deg, #4f46e5 0%, #7c3aed 100%)',
  manga:  'linear-gradient(160deg, #be185d 0%, #7c3aed 100%)',
  game:   'linear-gradient(160deg, #047857 0%, #1d4ed8 100%)',
  movie:  'linear-gradient(160deg, #b45309 0%, #dc2626 100%)',
  series: 'linear-gradient(160deg, #1d4ed8 0%, #0891b2 100%)',
  book:   'linear-gradient(160deg, #4d7c0f 0%, #0f766e 100%)',
  novel:  'linear-gradient(160deg, #c2410c 0%, #ca8a04 100%)',
  vnovel: 'linear-gradient(160deg, #a21caf 0%, #e11d48 100%)',
};

const ICON_CROWN = `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
  <path d="M2 19.5 4.5 8 9 13l3-7 3 7 4.5-5L22 19.5H2zm0 2h20v1.5H2v-1.5z"/>
</svg>`;

const ICON_PERSON = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/>
</svg>`;

function getRatingHtml(rating: number | null | undefined): string {
  return buildStarHtml(rating ?? 0, 'hof-card-rating', 'display:flex;gap:2px;align-items:center;color:currentColor;');
}

export function buildHofHtml(items: Items, catalogMap: Map<string, any>, p: P): string {
  const top10 = [...items].slice(0, 10);

  while (top10.length < 10) top10.push(null as any);

  const workCards = top10.map((item, i) => {
    if (!item) return `<div class="hof-card hof-card--empty"><span class="hof-card-rank">#${i + 1}</span></div>`;
    const meta  = catalogMap.get(item.external_id);
    const title = meta?.title_main ?? item.external_id;
    const cover = meta?.cover_url ?? '';
    const label = typeLabel(item.type);

    const bg    = HOF_GRADIENTS[item.type] ?? 'linear-gradient(160deg, #374151, #1f2937)';
    const style = cover 
      ? `background-image: url('${cover}'); background-size: cover; background-position: center;`
      : `background: ${bg};`;

    return `<div class="hof-card" style="${style}">
      <div class="hof-card-overlay"></div>
      <span class="hof-card-rank">#${i + 1}</span>
      <div class="hof-card-label">${title}</div>
      <div class="hof-card-content">
        <span class="hof-card-type">${label}</span>
        <span class="hof-card-id">${title}</span>
        ${item.rating != null ? getRatingHtml(item.rating) : ''}
      </div>
    </div>`;
  }).join('');

  const charCards = Array.from({ length: 10 }, (_, i) =>
    `<div class="hof-card hof-card--empty"><span class="hof-card-rank">#${i + 1}</span></div>`
  ).join('');

  return `
    <div class="hof-wrapper">
      <div class="hof-row">
        <div class="hof-container" id="hof-view-works">${workCards}</div>
        <div class="hof-container hof-view-hidden" id="hof-view-chars">${charCards}</div>
        <div class="hof-sidebar">
          <button class="hof-btn hof-btn--active" id="hof-btn-works" title="${p.stat_total}">${ICON_CROWN}</button>
          <div class="hof-sidebar-divider"></div>
          <button class="hof-btn" id="hof-btn-chars" title="${p.stat_total}">${ICON_PERSON}</button>
        </div>
      </div>
    </div>`;
}

export function initHofListeners(el: HTMLElement): void {
  const viewWorks = el.querySelector('#hof-view-works') as HTMLElement | null;
  const viewChars = el.querySelector('#hof-view-chars') as HTMLElement | null;
  const btnWorks  = el.querySelector('#hof-btn-works')  as HTMLButtonElement | null;
  const btnChars  = el.querySelector('#hof-btn-chars')  as HTMLButtonElement | null;
  if (!viewWorks || !viewChars || !btnWorks || !btnChars) return;

  function switchView(type: 'works' | 'chars') {
    const isWorks = type === 'works';
    viewWorks!.classList.toggle('hof-view-hidden', !isWorks);
    viewChars!.classList.toggle('hof-view-hidden',  isWorks);
    btnWorks!.classList.toggle('hof-btn--active',  isWorks);
    btnChars!.classList.toggle('hof-btn--active', !isWorks);
  }

  btnWorks.addEventListener('click', () => switchView('works'));
  btnChars.addEventListener('click', () => switchView('chars'));
}
