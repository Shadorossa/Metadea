import { typeLabel } from './utils';
import { getT } from '../../i18n/client';
import type { getAllLibraryEntries, MediaCatalogEntry, CharacterEntry, FavoriteCustomImage } from '../tauri';
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

// Same precedence as the Favorites tab: a user-set custom crop/position
// wins over the raw cover, which wins over a plain gradient placeholder.
//
// `bg_size` is a percentage calibrated against the Favorites card's own
// aspect ratio (see image-crop-modal.ts's recomputeZoomBounds), which is a
// different shape than the HOF card. Most custom crops still happen to
// cover the HOF box fine as-is; only ones where that stored size under-
// covers this differently-shaped box need bumping up. That correction needs
// the image's natural size and the HOF card's real rendered size, so it
// can't be computed at HTML-build time — this only emits the data
// attributes; adjustHofCustomImages() does the actual (conditional) fix
// once the cards are in the DOM.
function coverStyle(rawCover: string, customImg: FavoriteCustomImage | undefined, fallbackBg: string): { style: string; attrs: string } {
  if (customImg) {
    return {
      style: `background-image:url('${customImg.image_url}'); background-size:${customImg.bg_size}%; background-position:${customImg.pos_x}% ${customImg.pos_y}%;`,
      attrs: `data-custom-img="${customImg.image_url}" data-bg-size="${customImg.bg_size}" data-pos-x="${customImg.pos_x}" data-pos-y="${customImg.pos_y}"`,
    };
  }
  if (rawCover) {
    return { style: `background-image: url('${rawCover}'); background-size: cover; background-position: center;`, attrs: '' };
  }
  return { style: `background: ${fallbackBg};`, attrs: '' };
}

export function buildHofHtml(
  items: Items,
  catalogMap: Map<string, MediaCatalogEntry>,
  p: P,
  charFavIds: string[] = [],
  characterMap: Map<string, CharacterEntry> = new Map(),
  customImageMap: Map<string, FavoriteCustomImage> = new Map(),
): string {
  const top10: (Items[number] | null)[] = [...items].slice(0, 10);

  while (top10.length < 10) top10.push(null);

  const workCards = top10.map((item, i) => {
    if (!item) return `<div class="hof-card hof-card--empty"><span class="hof-card-rank">#${i + 1}</span></div>`;
    const meta  = catalogMap.get(item.external_id);
    const title = meta?.title_main ?? item.external_id;
    const cover = meta?.cover_url ?? '';
    const label = typeLabel(item.type);

    const bg = HOF_GRADIENTS[item.type] ?? 'linear-gradient(160deg, #374151, #1f2937)';
    const { style, attrs } = coverStyle(cover, customImageMap.get(item.external_id), bg);

    return `<div class="hof-card" style="${style}" ${attrs}>
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

    const { style, attrs } = coverStyle(char.image_url ?? '', customImageMap.get(char.external_id), 'linear-gradient(160deg, #374151, #1f2937)');

    return `<div class="hof-card" style="${style}" ${attrs}>
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

// A percentage-based background-size (whether the stored bg_size or a
// computed coverPercent) is still relative to the box, so it scales right
// along with it — and .hof-card:hover changes the box's width (flex 1 →
// 1.3) without changing its height. That reads as the photo itself zooming
// in on every hover, not just the card opening up. Freezing the image at a
// fixed *pixel* width instead means hovering can only ever do what
// .hof-card:hover alone says: grow the box around a same-size photo.
//
// HOVER_WIDTH_FACTOR is a generous stand-in for how much wider the box gets
// on hover (exact amount depends on flex distribution across however many
// siblings are in the row) — the fixed size is computed against this
// assumed wider box so hovering never uncovers a gap at the edges either.
const HOVER_WIDTH_FACTOR = 1.35;

function adjustHofCustomImages(el: HTMLElement): void {
  const cards = el.querySelectorAll<HTMLElement>('.hof-card[data-custom-img]');
  cards.forEach(card => {
    const url    = card.dataset.customImg!;
    const bgSize = Number(card.dataset.bgSize);
    const posX   = card.dataset.posX ?? '50';
    const posY   = card.dataset.posY ?? '50';
    if (!url || !Number.isFinite(bgSize)) return;

    const probe = new Image();
    probe.onload = () => {
      const naturalW = probe.naturalWidth;
      const naturalH = probe.naturalHeight;
      if (!naturalW || !naturalH) return;

      const rect = card.getBoundingClientRect();
      if (!rect.width || !rect.height) return;

      const imgAspect = naturalW / naturalH;
      // Width needed to cover the box even once hovered-and-widened, and
      // width needed for the (hover-invariant) height to be covered — the
      // larger of the two, plus whichever the user's own saved size implies.
      // The focal point itself (pos_x/pos_y) is untouched — only the size
      // grows if it has to, never the framing the user actually picked in
      // the Favorites editor.
      const pxForHoverWidth = rect.width * HOVER_WIDTH_FACTOR;
      const pxForHeight     = rect.height * imgAspect;
      const pxForSavedSize  = (bgSize / 100) * rect.width;
      const pxWidth = Math.max(pxForHoverWidth, pxForHeight, pxForSavedSize) * 1.02;

      card.style.backgroundSize     = `${pxWidth}px auto`;
      card.style.backgroundPosition = `${posX}% ${posY}%`;
    };
    probe.src = url;
  });
}

export function initHofListeners(el: HTMLElement): void {
  const viewWorks = el.querySelector<HTMLElement>('#hof-view-works');
  const viewChars = el.querySelector<HTMLElement>('#hof-view-chars');
  const btnWorks  = el.querySelector<HTMLButtonElement>('#hof-btn-works');
  const btnChars  = el.querySelector<HTMLButtonElement>('#hof-btn-chars');
  if (!viewWorks || !viewChars || !btnWorks || !btnChars) return;

  adjustHofCustomImages(el);

  function switchView(type: 'works' | 'chars') {
    const isWorks = type === 'works';
    viewWorks!.classList.toggle('hof-view-hidden', !isWorks);
    viewChars!.classList.toggle('hof-view-hidden',  isWorks);
    btnWorks!.classList.toggle('hof-btn--active',  isWorks);
    btnChars!.classList.toggle('hof-btn--active', !isWorks);
    // The chars view starts hidden (display:none), so its cards report a
    // zero-size rect on the initial adjustHofCustomImages() pass — redo it
    // now that whichever view was just revealed has real dimensions.
    adjustHofCustomImages(el);
  }

  btnWorks.addEventListener('click', () => switchView('works'));
  btnChars.addEventListener('click', () => switchView('chars'));
}
