// ─── Hall of Fame (HOF) Card Renderers & Event Listeners ─────────────────────
// Handles layout and hover calculations for the profile's top 10 works/characters.

import { typeLabel } from './utils';
import { getT } from '../../i18n/client';
import type { getAllLibraryEntries, MediaCatalogEntry, CharacterEntry, FavoriteCustomImage } from '../tauri';
import { ICON_CROWN, ICON_PERSON } from '../shared/icon-strings';

type Items = Awaited<ReturnType<typeof getAllLibraryEntries>>;
type P     = ReturnType<typeof getT>['profile'];

// Gradients used for fallback backgrounds by media type
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

const DEFAULT_GRADIENT = 'linear-gradient(160deg, #374151, #1f2937)';

// Pads the ranked items array with nulls to always render exactly 10 slots
function padTo10<T>(items: T[]): (T | null)[] {
  const padded: (T | null)[] = items.slice(0, 10);
  while (padded.length < 10) padded.push(null);
  return padded;
}

// Generates the HTML shell for a HOF card slot (empty or filled). The cover
// is a CSS background-image on the card itself rather than a separate
// wrapper + <img>.
function hofCardHtml(rank: number, coverStyleStr: string | null, label: string, innerContent: string): string {
  if (!coverStyleStr) return `<div class="hof-card hof-card--empty"><span class="hof-card-rank">#${rank}</span></div>`;
  return `<div class="hof-card" style="${coverStyleStr}">
      <div class="hof-card-overlay"></div>
      <span class="hof-card-rank">#${rank}</span>
      <div class="hof-card-label">${label}</div>
      <div class="hof-card-content">${innerContent}</div>
    </div>`;
}

// bg_size/pos_x/pos_y (from the shared pan/zoom crop editor) are CSS
// background-size/background-position percentages calibrated for a 3:4 box
// — see image-crop-modal.ts's own coverPercent formula, which factors in
// the editor's own aspectRatio (defaulted to 3/4 by favorite-image-editor.ts,
// matching .fav-card). .hof-card is now also fixed at a 3:4 aspect ratio
// (profile.css) specifically so this reuses the exact same crop as
// Favoritos instead of landing on an arbitrary region of the image — it
// used to fall back to a plain centered cover here because HOF cards were a
// completely different, much taller/narrower shape.
function coverStyle(rawCover: string, customImg: FavoriteCustomImage | undefined, fallbackBg: string): string {
  if (customImg) {
    return `background-image: url('${customImg.image_url}'); background-size: ${customImg.bg_size}% auto; background-position: ${customImg.pos_x}% ${customImg.pos_y}%;`;
  }
  if (rawCover) {
    return `background-image: url('${rawCover}'); background-size: cover; background-position: center;`;
  }
  return `background: ${fallbackBg};`;
}

// Assembles the final HTML row containing works and character cards
export function buildHofHtml(
  items: Items,
  catalogMap: Map<string, MediaCatalogEntry>,
  p: P,
  charFavIds: string[] = [],
  characterMap: Map<string, CharacterEntry> = new Map(),
  customImageMap: Map<string, FavoriteCustomImage> = new Map(),
): string {
  const workCards = padTo10(items).map((item, i) => {
    if (!item) return hofCardHtml(i + 1, null, '', '');
    const meta  = catalogMap.get(item.external_id);
    const title = meta?.title_main ?? item.external_id;
    const bg    = HOF_GRADIENTS[item.type] ?? DEFAULT_GRADIENT;
    const cover = coverStyle(meta?.cover_url ?? '', customImageMap.get(item.external_id), bg);

    const inner = `
        <span class="hof-card-type">${typeLabel(item.type)}</span>
        <span class="hof-card-id">${title}</span>`;
    return hofCardHtml(i + 1, cover, title, inner);
  }).join('');

  const charCards = padTo10(charFavIds.map(id => characterMap.get(id) ?? null)).map((char, i) => {
    if (!char) return hofCardHtml(i + 1, null, '', '');
    const cover = coverStyle(char.image_url ?? '', customImageMap.get(char.external_id), DEFAULT_GRADIENT);
    return hofCardHtml(i + 1, cover, char.name, `<span class="hof-card-id">${char.name}</span>`);
  }).join('');

  return `
    <div class="hof-wrapper">
      <div class="hof-row">
        <div class="hof-view-stack">
          <div class="hof-container" id="hof-view-works">${workCards}</div>
          <div class="hof-container hof-view-hidden" id="hof-view-chars">${charCards}</div>
        </div>
        <div class="hof-sidebar">
          <button class="hof-btn hof-btn--active" id="hof-btn-works" title="${p.stat_total}">${ICON_CROWN}</button>
          <div class="hof-sidebar-divider"></div>
          <button class="hof-btn" id="hof-btn-chars" title="${p.stat_total}">${ICON_PERSON}</button>
        </div>
      </div>
    </div>`;
}

// Setup click handlers for tab toggles
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

