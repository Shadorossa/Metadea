import { STORAGE_KEYS } from '../shared/storage-keys';
import { getLangCode } from '../../i18n/client';

// Astro's own i18n URL-prefix routing never produces real per-locale static
// pages for this app's static Tauri build (no /en/, /de/, ... route exists to
// navigate to), so language selection lives entirely in localStorage instead
// — see getLangCode() in i18n/client.ts for the read side. Only React islands
// (getT()) pick this up; server-rendered Astro chrome (Navbar, page titles)
// stays in Spanish for now, same limitation the app already had before this
// selector existed (en.ts was never actually reachable either).
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
