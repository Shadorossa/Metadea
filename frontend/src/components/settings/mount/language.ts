import { STORAGE_KEYS } from '../../../lib/storage/storage-keys';
import { getLangCode } from '../../../i18n/runtime';

// The choice lives in localStorage (the static Tauri build has no per-locale
// routes); getLangCode() reads it. Server-rendered text follows it through the
// `data-i18n*` markers (lib/i18n-dom/), but React islands and the settings
// mounts read getT() once when they render, so a reload is still what switches
// every string at once.
export function initLanguageSwitcher() {
  const btns = document.querySelectorAll<HTMLButtonElement>('.language-btn');
  if (!btns.length) return;

  const current = getLangCode();

  btns.forEach(btn => {
    if (btn.dataset.value === current) btn.classList.add('active');
    btn.addEventListener('click', () => {
      const value = btn.dataset.value;
      if (!value) return;
      localStorage.setItem(STORAGE_KEYS.locale, value);
      window.location.reload();
    });
  });
}
