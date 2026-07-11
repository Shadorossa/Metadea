import { typeLabel } from './utils';
import { getT } from '../../i18n/client';
import type { getAllLibraryEntries, MediaCatalogEntry, CharacterEntry } from '../tauri';
import { buildStarHtml } from '../media/rating-utils';
import { ICON_CROWN, ICON_PERSON } from '../shared/icon-strings';

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

function getRatingHtml(rating: number | null | undefined): string {
  return buildStarHtml(rating ?? 0, 'hof-card-rating', 'display:flex;gap:2px;align-items:center;color:currentColor;');
}

export function buildHofHtml(
  items: Items,
  catalogMap: Map<string, MediaCatalogEntry>,
  p: P,
  charFavIds: string[] = [],
  characterMap: Map<string, CharacterEntry> = new Map(),
): string {
  const top10: (Items[number] | null)[] = [...items].slice(0, 10);

  while (top10.length < 10) top10.push(null);

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

  // Top 10 favorite characters — sourced from the Favorites tab's
  // "character" bucket (already user-ordered via drag reorder there), not a
  // separate ranking of its own.
  const top10Chars: (CharacterEntry | null)[] = charFavIds
    .slice(0, 10)
    .map(id => characterMap.get(id) ?? null);
  while (top10Chars.length < 10) top10Chars.push(null);

  const charCards = top10Chars.map((char, i) => {
    if (!char) return `<div class="hof-card hof-card--empty"><span class="hof-card-rank">#${i + 1}</span></div>`;

    const style = char.image_url
      ? `background-image: url('${char.image_url}'); background-size: cover; background-position: center;`
      : `background: linear-gradient(160deg, #374151, #1f2937);`;

    return `<div class="hof-card" style="${style}">
      <div class="hof-card-overlay"></div>
      <span class="hof-card-rank">#${i + 1}</span>
      <div class="hof-card-label">${char.name}</div>
      <div class="hof-card-content">
        <span class="hof-card-id">${char.name}</span>
      </div>
    </div>`;
  }).join('');

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
  const viewWorks = el.querySelector<HTMLElement>('#hof-view-works');
  const viewChars = el.querySelector<HTMLElement>('#hof-view-chars');
  const btnWorks  = el.querySelector<HTMLButtonElement>('#hof-btn-works');
  const btnChars  = el.querySelector<HTMLButtonElement>('#hof-btn-chars');
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
