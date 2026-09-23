// Settings › Appearance › Big Picture style (ProfileTab.astro): card picker
// styled like the dynamic-background one (theme.ts). The previews are small
// CSS drawings of each layout, not screenshots (settings.css, .bp-skin-*).
// Storage: lib/big-picture/big-picture-skin.ts. Idempotent.
import { BIG_PICTURE_SKINS, readBigPictureSkin, writeBigPictureSkin, type BigPictureSkin } from '../../../lib/big-picture/big-picture-skin';
import { getT } from '../../../i18n/runtime';
import type { Translations } from '../../../i18n/index';

const CHECK_SVG = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;

const NAME_KEY: Record<BigPictureSkin, keyof Translations['big_picture']> = {
  default: 'style_default',
  ps5: 'style_ps5',
};

// Static markup only (no user data): a miniature of each layout.
const PREVIEW: Record<BigPictureSkin, string> = {
  // Tabs, the details column on the left, the cover grid on the right.
  default: `
    <span class="bp-skin-mini bp-skin-mini--default" aria-hidden="true">
      <span class="bp-skin-mini-tabs"><i class="is-on"></i><i></i><i></i></span>
      <span class="bp-skin-mini-info"><i class="is-title"></i><i></i><i class="is-button"></i></span>
      <span class="bp-skin-mini-grid"><i></i><i class="is-focus"></i><i></i><i></i><i></i><i></i><i></i><i></i></span>
    </span>`,
  // Key art, the tile row with the focused tile outlined, title + Play.
  ps5: `
    <span class="bp-skin-mini bp-skin-mini--ps5" aria-hidden="true">
      <span class="bp-skin-mini-bar"><i class="is-on"></i><i></i><b></b></span>
      <span class="bp-skin-mini-row"><i class="is-focus"></i><em></em><i></i><i></i><i></i><i></i></span>
      <span class="bp-skin-mini-hero"><i class="is-title"></i><i class="is-button"></i></span>
    </span>`,
};

export function initBigPictureSkinPicker(showToast: (msg?: string) => void): void {
  const grid = document.getElementById('big-picture-skin-grid');
  if (!grid || grid.dataset.bound === 'true') return;
  grid.dataset.bound = 'true';
  const t = getT().big_picture;

  const render = (active: BigPictureSkin) => {
    grid.innerHTML = BIG_PICTURE_SKINS.map(skin => `
      <button type="button" class="theme-card bp-skin-card${skin === active ? ' active' : ''}" data-bp-skin-id="${skin}" aria-pressed="${skin === active}">
        <span class="theme-card-preview bp-skin-preview">
          ${PREVIEW[skin]}
          <span class="theme-card-check">${CHECK_SVG}</span>
        </span>
        <span class="theme-card-name" data-i18n="big_picture.${NAME_KEY[skin]}">${t[NAME_KEY[skin]]}</span>
      </button>
    `).join('');
  };
  render(readBigPictureSkin());

  grid.addEventListener('click', event => {
    const card = (event.target as Element | null)?.closest<HTMLButtonElement>('[data-bp-skin-id]');
    if (!card) return;
    const skin = writeBigPictureSkin(card.dataset.bpSkinId as BigPictureSkin);
    grid.querySelectorAll<HTMLButtonElement>('[data-bp-skin-id]').forEach(other => {
      const on = other.dataset.bpSkinId === skin;
      other.classList.toggle('active', on);
      other.setAttribute('aria-pressed', String(on));
    });
    showToast();
  });
}
