import { saveUserInfo, getUserInfo } from '../tauri';
import { STORAGE_KEYS } from '../shared/storage-keys';

// DB is the source of truth; localStorage is kept as a fast read cache for
// other pages that need the active rating system without an IPC round-trip.
export async function initRatingSystem(showToast: (msg?: string) => void) {
  const btns = document.querySelectorAll<HTMLButtonElement>('.rating-system-btn');
  if (!btns.length) return;

  const info = await getUserInfo().catch(() => ({} as Record<string, unknown>));
  const activeSystem = (info.rating_system as string)
    || localStorage.getItem(STORAGE_KEYS.ratingSystem)
    || '5-star';
  localStorage.setItem(STORAGE_KEYS.ratingSystem, activeSystem);

  btns.forEach(btn => {
    if (btn.dataset.value === activeSystem) btn.classList.add('active');
    btn.addEventListener('click', async () => {
      btns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const value = btn.dataset.value || '5-star';
      localStorage.setItem(STORAGE_KEYS.ratingSystem, value);
      try {
        await saveUserInfo({ rating_system: value });
        showToast('Sistema de calificación guardado');
      } catch (err) {
        console.error('Failed to save rating system:', err);
        showToast('Error al guardar el sistema de calificación');
      }
    });
  });
}
