import { saveUserInfo } from '../tauri';
import { STORAGE_KEYS } from '../shared/storage-keys';
import { syncActiveRatingSystem } from '../media/rating-utils';
import { runSave } from './autosave';

// DB is the source of truth; localStorage is kept as a fast read cache for
// other pages that need the active rating system without an IPC round-trip.
export async function initRatingSystem(showToast: (msg?: string) => void) {
  const btns = document.querySelectorAll<HTMLButtonElement>('.rating-system-btn');
  if (!btns.length) return;

  const activeSystem = await syncActiveRatingSystem();

  btns.forEach(btn => {
    if (btn.dataset.value === activeSystem) btn.classList.add('active');
    btn.addEventListener('click', async () => {
      btns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const value = btn.dataset.value || '5-star';
      localStorage.setItem(STORAGE_KEYS.ratingSystem, value);
      await runSave(() => saveUserInfo({ rating_system: value }), showToast, 'Failed to save rating system:');
    });
  });
}
