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

interface CoverStyle { style: string; attrs: string; }

// Generates the HTML shell for a HOF card slot (empty or filled)
function hofCardHtml(rank: number, coverHtml: string, label: string, innerContent: string): string {
  if (!coverHtml) return `<div class="hof-card hof-card--empty"><span class="hof-card-rank">#${rank}</span></div>`;
  return `<div class="hof-card">
      ${coverHtml}
      <div class="hof-card-overlay"></div>
      <span class="hof-card-rank">#${rank}</span>
      <div class="hof-card-label">${label}</div>
      <div class="hof-card-content">${innerContent}</div>
    </div>`;
}

// Builds CSS background layers for crops/covers, fallback to gradient if empty
function coverStyle(rawCover: string, customImg: FavoriteCustomImage | undefined, fallbackBg: string): string {
  if (customImg) {
    return `<div class="hof-card-bg-wrap">
      <img class="hof-card-bg-img hof-card-bg-img--custom" src="${customImg.image_url}" alt="" style="width: ${customImg.bg_size}%; object-position: ${customImg.pos_x}% ${customImg.pos_y}%;" />
    </div>`;
  }
  if (rawCover) {
    return `<div class="hof-card-bg-wrap">
      <img class="hof-card-bg-img" src="${rawCover}" alt="" />
    </div>`;
  }
  return `<div class="hof-card-bg-wrap" style="background: ${fallbackBg};"></div>`;
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
    if (!item) return hofCardHtml(i + 1, '', '', '');
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
    if (!char) return hofCardHtml(i + 1, '', '', '');
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

const HOVER_WIDTH_FACTOR = 1.35;
const SIZE_SAFETY_MARGIN = 1.08;

interface NaturalSize { w: number; h: number; }

const naturalSizeCache = new Map<string, NaturalSize | null>();

// Resolves and caches the natural dimensions of card cover images
function getNaturalSize(url: string): Promise<NaturalSize | null> {
  const cached = naturalSizeCache.get(url);
  if (cached !== undefined) return Promise.resolve(cached);
  return new Promise(resolve => {
    const probe = new Image();
    probe.onload = () => {
      const size = probe.naturalWidth && probe.naturalHeight
        ? { w: probe.naturalWidth, h: probe.naturalHeight }
        : null;
      naturalSizeCache.set(url, size);
      resolve(size);
    };
    probe.onerror = () => { naturalSizeCache.set(url, null); resolve(null); };
    probe.src = url;
  });
}

// Adjusts background sizes to pixel units to prevent weird scaling/distortion on card hover
function fixHofCardHoverZoom(el: HTMLElement): void {
  const cards = el.querySelectorAll<HTMLElement>('.hof-card[data-cover-img]');
  cards.forEach(card => {
    const url    = card.dataset.coverImg!;
    const bgSize = Number(card.dataset.bgSize);
    const posX   = card.dataset.posX ?? '50';
    const posY   = card.dataset.posY ?? '50';
    if (!url || !Number.isFinite(bgSize)) return;

    getNaturalSize(url).then(natural => {
      if (!natural) return;

      const rect = card.getBoundingClientRect();
      if (!rect.width || !rect.height) return;

      const imgAspect = natural.w / natural.h;
      const pxForHoverWidth = rect.width * HOVER_WIDTH_FACTOR;
      const pxForHeight     = rect.height * imgAspect;
      const pxForSavedSize  = (bgSize / 100) * rect.width;
      const pxWidth = Math.max(pxForHoverWidth, pxForHeight, pxForSavedSize) * SIZE_SAFETY_MARGIN;

      card.style.backgroundSize     = `${pxWidth}px auto, cover`;
      card.style.backgroundPosition = `${posX}% ${posY}%, center`;
    });
  });
}

// Setup click handlers for tab toggles and runs initial hover fix sizing
export function initHofListeners(el: HTMLElement): void {
  const viewWorks = el.querySelector<HTMLElement>('#hof-view-works');
  const viewChars = el.querySelector<HTMLElement>('#hof-view-chars');
  const btnWorks  = el.querySelector<HTMLButtonElement>('#hof-btn-works');
  const btnChars  = el.querySelector<HTMLButtonElement>('#hof-btn-chars');
  if (!viewWorks || !viewChars || !btnWorks || !btnChars) return;

  fixHofCardHoverZoom(el);

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

