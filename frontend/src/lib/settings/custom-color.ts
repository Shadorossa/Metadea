import { saveUserInfo, getUserInfo } from '../tauri';
import { STORAGE_KEYS } from '../shared/storage-keys';
import { byId } from '../shared/dom';

const DEFAULT_COLOR = '#c084fc';

function applyCustomColor(color: string) {
  document.documentElement.style.setProperty('--accent', color);
  document.documentElement.style.setProperty('--accent-soft', `${color}19`);
  document.documentElement.style.setProperty('--accent-border', `${color}40`);
  document.documentElement.style.setProperty('--accent-glow', `${color}4d`);
}

// DB is the source of truth; localStorage is kept as a fast read cache.
export async function initCustomColor(showToast: (msg?: string) => void) {
  const colorInput = byId<HTMLInputElement>('custom-color-input');
  const colorHexDisplay = document.getElementById('color-hex-display');
  const colorResetBtn = document.getElementById('color-reset-btn');
  if (!colorInput || !colorHexDisplay) return;

  const info = await getUserInfo().catch(() => ({} as Record<string, unknown>));
  const savedColor = (info.custom_color as string)
    || localStorage.getItem(STORAGE_KEYS.customColor)
    || DEFAULT_COLOR;
  colorInput.value = savedColor;
  colorHexDisplay.textContent = `Actual: ${savedColor}`;
  localStorage.setItem(STORAGE_KEYS.customColor, savedColor);
  applyCustomColor(savedColor);

  let colorTimer: ReturnType<typeof setTimeout>;
  colorInput.addEventListener('input', (e) => {
    const color = (e.target as HTMLInputElement).value;
    colorHexDisplay.textContent = `Actual: ${color}`;
    localStorage.setItem(STORAGE_KEYS.customColor, color);
    applyCustomColor(color);
    clearTimeout(colorTimer);
    colorTimer = setTimeout(() => {
      // No toast here (this is a debounced autosave, not a user action), but
      // still log — the DB write silently failing would otherwise be
      // indistinguishable from it succeeding.
      saveUserInfo({ custom_color: color }).catch(err => console.error('Failed to save custom color:', err));
    }, 800);
  });

  colorResetBtn?.addEventListener('click', async () => {
    colorInput.value = DEFAULT_COLOR;
    colorHexDisplay.textContent = `Actual: ${DEFAULT_COLOR}`;
    localStorage.setItem(STORAGE_KEYS.customColor, DEFAULT_COLOR);
    applyCustomColor(DEFAULT_COLOR);
    try {
      await saveUserInfo({ custom_color: DEFAULT_COLOR });
      showToast('Color restaurado');
    } catch (err) {
      console.error('Failed to save custom color:', err);
      showToast('Error al guardar el color');
    }
  });
}
