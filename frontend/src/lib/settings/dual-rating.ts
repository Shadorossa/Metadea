import { byId } from '../shared/dom';
import {
  isDualRatingEnabled, setDualRatingEnabled,
  getRatingName1, setRatingName1, getRatingName2, setRatingName2,
  getRating2System, setRating2System,
} from './preferences';
import type { RatingSystem } from '../media/rating-utils';
import { getT } from '../../i18n/client';

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
  if (!enabledCheckbox || !configBox) return;

  const t = getT().settings;

  function refreshVisibility() {
    configBox!.classList.toggle('hidden', !enabledCheckbox!.checked);
    systemRow?.classList.toggle('hidden', !enabledCheckbox!.checked);
  }

  enabledCheckbox.checked = isDualRatingEnabled();
  // Empty until the user actually names it — the field's own placeholder
  // (set in the markup to this field's label text) shows in the meantime.
  if (name1Input) name1Input.value = getRatingName1('');
  if (name2Input) name2Input.value = getRatingName2('');
  const activeSystem2 = getRating2System();
  system2Btns.forEach(btn => btn.classList.toggle('active', btn.dataset.value === activeSystem2));
  refreshVisibility();

  enabledCheckbox.addEventListener('change', () => {
    setDualRatingEnabled(enabledCheckbox.checked);
    refreshVisibility();
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
      showToast();
    });
  });
}
