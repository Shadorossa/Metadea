// ─── Hall of Fame (HOF) Card Renderers & Event Listeners ─────────────────────
// Handles layout and hover calculations for the profile's top 10 works/characters.

import { typeLabel } from './utils';
import { getT } from '../../i18n/client';
import type { getAllLibraryEntries, MediaCatalogEntry, CharacterEntry, FavoriteCustomImage } from '../tauri';
import { wrapAssetUrl } from '../tauri';
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

// Generates the HTML shell for a HOF card slot (empty or filled)
function hofCardHtml(rank: number, cardBg: CardBg | null, label: string, innerContent: string): string {
  if (!cardBg) return `<div class="hof-card hof-card--empty"><span class="hof-card-rank">#${rank}</span></div>`;
  // Only set the fallback gradient as the card's own background when there's
  // no image to draw on top of it — themes with a double/dashed border style
  // (e.g. newspaper-dark) paint the element's own background in the gaps of
  // that border, so leaving the gradient set underneath a fully-covering
  // image bleeds through as a colored ring around every card.
  const bgStyle = cardBg.imgHtml ? '' : ` style="background: ${cardBg.fallbackBg};"`;
  return `<div class="hof-card"${bgStyle}>
      ${cardBg.imgHtml}
      <div class="hof-card-overlay"></div>
      <span class="hof-card-rank">#${rank}</span>
      <div class="hof-card-label">${label}</div>
      <div class="hof-card-content">${innerContent}</div>
    </div>`;
}

interface CardBg {
  imgHtml: string;
  fallbackBg: string;
}

// Same approach as render-favorites.ts's proven-working cards: a plain
// <img> for the real cover (custom crops use a background-image div
// instead, since bg_size/pos_x/pos_y are CSS background-position/size
// percentages) — NOT a background-image set on the card itself. Setting it
// on the card was silently invisible in the packaged production build even
// though it worked in dev; the <img>-based Favorites cards never had that
// problem, so cards here are built the same way.
function coverStyle(rawCover: string, customImg: FavoriteCustomImage | undefined, fallbackBg: string): CardBg {
  if (customImg) {
    return {
      imgHtml: `<div class="hof-card-bg hof-card-bg--custom" style="background-image:url('${wrapAssetUrl(customImg.image_url)}'); background-size:${customImg.bg_size}% auto; background-position:${customImg.pos_x}% ${customImg.pos_y}%;"></div>`,
      fallbackBg,
    };
  }
  if (rawCover) {
    return {
      imgHtml: `<img class="hof-card-bg" src="${wrapAssetUrl(rawCover)}" />`,
      fallbackBg,
    };
  }
  return { imgHtml: '', fallbackBg };
}

interface HofData {
  items: Items;
  catalogMap: Map<string, MediaCatalogEntry>;
  charFavIds: string[];
  characterMap: Map<string, CharacterEntry>;
  customImageMap: Map<string, FavoriteCustomImage>;
}

function buildWorkCardsHtml(data: HofData): string {
  return padTo10(data.items).map((item, i) => {
    if (!item) return hofCardHtml(i + 1, null, '', '');
    const meta  = data.catalogMap.get(item.external_id);
    const title = meta?.title_main ?? item.external_id;
    const bg    = HOF_GRADIENTS[item.type] ?? DEFAULT_GRADIENT;
    const cover = coverStyle(meta?.cover_url ?? '', data.customImageMap.get(item.external_id), bg);

    const inner = `
        <span class="hof-card-type">${typeLabel(item.type)}</span>
        <span class="hof-card-id">${title}</span>`;
    return hofCardHtml(i + 1, cover, title, inner);
  }).join('');
}

function buildCharCardsHtml(data: HofData): string {
  return padTo10(data.charFavIds.map(id => data.characterMap.get(id) ?? null)).map((char, i) => {
    if (!char) return hofCardHtml(i + 1, null, '', '');
    const cover = coverStyle(char.image_url ?? '', data.customImageMap.get(char.external_id), DEFAULT_GRADIENT);
    return hofCardHtml(i + 1, cover, char.name, `<span class="hof-card-id">${char.name}</span>`);
  }).join('');
}

// Assembles the final HTML row — only the active (works) view's cards are
// built and mounted up front; the character view is built on demand when
// the tab is switched (see initHofListeners) instead of both being built
// and kept permanently mounted with one hidden via CSS visibility. That
// used to leave a stale, still-"hoverable" character grid sitting under the
// visible one at all times, which is what caused the rank/label flicker on
// switch: the moment the previously-hidden view regained pointer-events, it
// could immediately pick up a stray hover from wherever the cursor already
// was, firing rank/label's hover-fade transition. A full innerHTML replace
// on switch can't carry over any such state since the old nodes are gone.
export function buildHofHtml(
  items: Items,
  catalogMap: Map<string, MediaCatalogEntry>,
  p: P,
  charFavIds: string[] = [],
  characterMap: Map<string, CharacterEntry> = new Map(),
  customImageMap: Map<string, FavoriteCustomImage> = new Map(),
): string {
  const data: HofData = { items, catalogMap, charFavIds, characterMap, customImageMap };
  return `
    <div class="hof-wrapper">
      <div class="hof-row">
        <div class="hof-view-stack">
          <div class="hof-container" id="hof-view">${buildWorkCardsHtml(data)}</div>
        </div>
        <div class="hof-sidebar">
          <button class="hof-btn hof-btn--active" id="hof-btn-works" title="${p.stat_total}">${ICON_CROWN}</button>
          <div class="hof-sidebar-divider"></div>
          <button class="hof-btn" id="hof-btn-chars" title="${p.stat_total}">${ICON_PERSON}</button>
        </div>
      </div>
    </div>`;
}

// Setup click handlers for tab toggles — takes the same data buildHofHtml
// used, so it can rebuild whichever view wasn't mounted initially.
export function initHofListeners(
  el: HTMLElement,
  items: Items,
  catalogMap: Map<string, MediaCatalogEntry>,
  charFavIds: string[] = [],
  characterMap: Map<string, CharacterEntry> = new Map(),
  customImageMap: Map<string, FavoriteCustomImage> = new Map(),
): void {
  const data: HofData = { items, catalogMap, charFavIds, characterMap, customImageMap };
  const viewEl   = el.querySelector<HTMLElement>('#hof-view');
  const btnWorks = el.querySelector<HTMLButtonElement>('#hof-btn-works');
  const btnChars = el.querySelector<HTMLButtonElement>('#hof-btn-chars');
  if (!viewEl || !btnWorks || !btnChars) return;

  function switchView(type: 'works' | 'chars') {
    const isWorks = type === 'works';
    viewEl!.innerHTML = isWorks ? buildWorkCardsHtml(data) : buildCharCardsHtml(data);
    btnWorks!.classList.toggle('hof-btn--active',  isWorks);
    btnChars!.classList.toggle('hof-btn--active', !isWorks);
  }

  btnWorks.addEventListener('click', () => switchView('works'));
  btnChars.addEventListener('click', () => switchView('chars'));
}

