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
// Both the custom and raw-cover cases render as two background layers —
// the actual image on top of an always-`cover`-sized copy of the fallback
// gradient — because AniList character art is often a cutout PNG with
// transparent regions (no fill around the character). Sizing the image
// alone lets those transparent pixels show through to whatever's behind
// the card, reading as "the image doesn't reach the edges" even though
// it's correctly sized and positioned; the gradient layer behind it means
// a transparent pixel just shows that color instead of a see-through gap.
//
// Both cases also get `data-cover-img`/`data-bg-size`/`data-pos-x/y` —
// fixHofCardHoverZoom() re-derives a fixed pixel size from these once the
// card is in the DOM (needs the image's natural size and the card's real
// rendered size, so it can't happen at HTML-build time here). Raw covers
// carry the same attributes as if bg_size were a plain, centered 100%, so
// they go through that exact same fix instead of being left on the live
// `cover` keyword, which re-fits (and so visibly re-zooms) on every hover
// the same way an under-sized custom crop used to.
function coverStyle(rawCover: string, customImg: FavoriteCustomImage | undefined, fallbackBg: string): { style: string; attrs: string } {
  // `cssSize` is whatever goes directly in the initial inline style (a
  // percentage for a real custom crop, the `cover` keyword for a plain
  // raw cover); `bgSize` is always the plain number fixHofCardHoverZoom()
  // needs later, so a raw cover's implicit "100%, centered" framing is
  // still comparable to a real bg_size instead of stashing the literal
  // string "cover" where a number is expected.
  const layered = (url: string, cssSize: string, bgSize: number, posX: number, posY: number) => ({
    style: `background-image:url('${url}'), ${fallbackBg}; background-size:${cssSize}, cover; background-position:${posX}% ${posY}%, center; background-repeat:no-repeat, no-repeat;`,
    attrs: `data-cover-img="${url}" data-bg-size="${bgSize}" data-pos-x="${posX}" data-pos-y="${posY}"`,
  });

  if (customImg) return layered(customImg.image_url, `${customImg.bg_size}%`, customImg.bg_size, customImg.pos_x, customImg.pos_y);
  if (rawCover)   return layered(rawCover, 'cover', 100, 50, 50);
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

// A percentage-based background-size — the live `cover` keyword included —
// is relative to the box, so it scales (or re-fits) right along with it,
// and .hof-card:hover changes the box's width (flex 1 → 1.3) without
// changing its height. That reads as the photo itself zooming in on every
// hover, not just the card opening up — true for plain covers and custom
// crops alike, which is why coverStyle() tags *both* with data-cover-img.
// Freezing the image at a fixed *pixel* width instead means hovering can
// only ever do what .hof-card:hover alone says: grow the box around a
// same-size photo.
//
// HOVER_WIDTH_FACTOR is a generous stand-in for how much wider the box gets
// on hover (exact amount depends on flex distribution across however many
// siblings are in the row) — the fixed size is computed against this
// assumed wider box so hovering never uncovers a gap at the edges either.
const HOVER_WIDTH_FACTOR = 1.35;

// Natural dimensions never change for a given URL — caching them means the
// chars view (permanently laid out at full size behind the works view via
// .hof-view-stack, just visibility:hidden — see profile.css) gets its
// correction computed during the initial pass same as the works view,
// instead of only once the user actually switches to it.
const naturalSizeCache = new Map<string, { w: number; h: number } | null>();

function getNaturalSize(url: string): Promise<{ w: number; h: number } | null> {
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
      // Width needed to cover the box even once hovered-and-widened, and
      // width needed for the (hover-invariant) height to be covered — the
      // larger of the two, plus whichever the user's own saved size implies.
      // The focal point itself (pos_x/pos_y) is untouched — only the size
      // grows if it has to, never the framing the user actually picked in
      // the Favorites editor.
      const pxForHoverWidth = rect.width * HOVER_WIDTH_FACTOR;
      const pxForHeight     = rect.height * imgAspect;
      const pxForSavedSize  = (bgSize / 100) * rect.width;
      // A generous margin, not just a rounding fudge — this is what actually
      // has to absorb HOVER_WIDTH_FACTOR being an estimate (real flex
      // distribution varies) and getBoundingClientRect's sub-pixel values,
      // so err on the side of a hair too zoomed rather than any visible gap.
      const pxWidth = Math.max(pxForHoverWidth, pxForHeight, pxForSavedSize) * 1.08;

      // Two layers, same as coverStyle's initial inline style — the real
      // image plus the always-cover gradient behind it for any transparent
      // pixels to fall back to.
      card.style.backgroundSize     = `${pxWidth}px auto, cover`;
      card.style.backgroundPosition = `${posX}% ${posY}%, center`;
    });
  });
}

export function initHofListeners(el: HTMLElement): void {
  const viewWorks = el.querySelector<HTMLElement>('#hof-view-works');
  const viewChars = el.querySelector<HTMLElement>('#hof-view-chars');
  const btnWorks  = el.querySelector<HTMLButtonElement>('#hof-btn-works');
  const btnChars  = el.querySelector<HTMLButtonElement>('#hof-btn-chars');
  if (!viewWorks || !viewChars || !btnWorks || !btnChars) return;

  // Both views are always full-size (see .hof-view-stack in profile.css —
  // the hidden one is visibility:hidden, not display:none), so this single
  // pass already corrects both; switching tabs is a pure visibility toggle.
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
