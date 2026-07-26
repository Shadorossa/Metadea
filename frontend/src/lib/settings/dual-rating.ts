import { byId } from '../shared/dom';
import {
  isDualRatingEnabled, setDualRatingEnabled,
  getRatingName1, setRatingName1, getRatingName2, setRatingName2,
  getRating2System, setRating2System,
  getRating2Min, setRating2Min, getRating2Max, setRating2Max,
} from './preferences';
import type { RatingSystem } from '../media/rating-utils';
import { getT } from '../../i18n/client';

// Only these two systems are a numeric range with a customizable min/max —
// 5-star/3-emoji have no such range to configure.
const RANGE_CUSTOMIZABLE_SYSTEMS = new Set<RatingSystem>(['10-dec', '10']);

// Settings > Preferencias' opt-in "doble calificación" — hidden entirely
// (see LibrarySection.tsx) unless enabled here. rating (the default one)
// always uses the app-wide rating system already configured elsewhere on
// this page; only rating_2 gets its own independent picker, since there's
// no reason the two need to look alike.
export function initDualRating(showToast: (msg?: string) => void) {
  const enabledCheckbox = byId<HTMLInputElement>('dual-rating-enabled');
  const configBox = byId<HTMLElement>('dual-rating-config');
  // The system-2 picker sits inline next to the checkbox (not inside
  // configBox) so it visually reads as "the box you activate this with",
  // but it's gated behind the same enabled state, so it needs its own
  // visibility toggle alongside configBox's.
  const systemRow = byId<HTMLElement>('dual-rating-system-row');
  const name1Input = byId<HTMLInputElement>('rating-name-1');
  const name2Input = byId<HTMLInputElement>('rating-name-2');
  const system2Btns = document.querySelectorAll<HTMLButtonElement>('.rating-system-btn-2');
  const rangeRow = byId<HTMLElement>('dual-rating-range-row');
  const minInput = byId<HTMLInputElement>('rating-2-min');
  const maxInput = byId<HTMLInputElement>('rating-2-max');
  if (!enabledCheckbox || !configBox) return;

  const t = getT().settings;

  function refreshVisibility() {
    configBox!.classList.toggle('hidden', !enabledCheckbox!.checked);
    systemRow?.classList.toggle('hidden', !enabledCheckbox!.checked);
  }

  // The min/max row only makes sense for '10-dec'/'10' — shown alongside
  // (not instead of) the enabled/disabled state above, so it's hidden
  // whenever dual rating itself is off too.
  function refreshRangeVisibility() {
    const activeBtn = document.querySelector<HTMLButtonElement>('.rating-system-btn-2.active');
    const system = (activeBtn?.dataset.value as RatingSystem) || '5-star';
    const show = enabledCheckbox!.checked && RANGE_CUSTOMIZABLE_SYSTEMS.has(system);
    rangeRow?.classList.toggle('hidden', !show);
  }

  enabledCheckbox.checked = isDualRatingEnabled();
  // Empty until the user actually names it — the field's own placeholder
  // (set in the markup to this field's label text) shows in the meantime.
  if (name1Input) name1Input.value = getRatingName1('');
  if (name2Input) name2Input.value = getRatingName2('');
  const activeSystem2 = getRating2System();
  system2Btns.forEach(btn => btn.classList.toggle('active', btn.dataset.value === activeSystem2));
  if (minInput) minInput.value = String(getRating2Min());
  if (maxInput) maxInput.value = String(getRating2Max());
  refreshVisibility();
  refreshRangeVisibility();

  enabledCheckbox.addEventListener('change', () => {
    setDualRatingEnabled(enabledCheckbox.checked);
    refreshVisibility();
    refreshRangeVisibility();
    showToast();
  });

  name1Input?.addEventListener('change', () => {
    setRatingName1(name1Input.value.trim() || t.dual_rating_default_name1);
    showToast();
  });
  name2Input?.addEventListener('change', () => {
    setRatingName2(name2Input.value.trim() || t.dual_rating_default_name2);
    showToast();
  });

  system2Btns.forEach(btn => {
    btn.addEventListener('click', () => {
      system2Btns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      setRating2System((btn.dataset.value as RatingSystem) || '5-star');
      refreshRangeVisibility();
      showToast();
    });
  });

  // No min > max guard needed beyond swapping on save — a custom range is
  // explicitly meant to allow e.g. -10..10, and existing saved ratings are
  // never rescaled when this changes (see preferences.ts's own comment), so
  // there's nothing here that could silently corrupt past data either way.
  minInput?.addEventListener('change', () => {
    const v = parseFloat(minInput.value);
    setRating2Min(Number.isFinite(v) ? v : 0);
    showToast();
  });
  maxInput?.addEventListener('change', () => {
    const v = parseFloat(maxInput.value);
    setRating2Max(Number.isFinite(v) ? v : 10);
    showToast();
  });
}
