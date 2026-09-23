import { saveUserInfo, getUserInfo } from '../../../lib/tauri';
import { STORAGE_KEYS } from '../../../lib/storage/storage-keys';
import { byId } from '../../../lib/dom/dom';
import { debouncedSave, runSave } from './autosave';

const DEFAULT_COLOR = '#c084fc';

const ACCENT_PROPS = ['--accent', '--accent-soft', '--accent-border', '--accent-glow'] as const;

// The default is Nebula's accent: writing it inline would repaint every other
// theme's buttons, checkboxes and active pills purple, so it clears instead.
function applyCustomColor(color: string) {
  const style = document.documentElement.style;
  if (color.toLowerCase() === DEFAULT_COLOR) {
    ACCENT_PROPS.forEach((prop) => style.removeProperty(prop));
    return;
  }
  style.setProperty('--accent', color);
  style.setProperty('--accent-soft', `${color}19`);
  style.setProperty('--accent-border', `${color}40`);
  style.setProperty('--accent-glow', `${color}4d`);
}

// DB is the source of truth; localStorage is kept as a fast read cache.
export async function initCustomColor(showToast: (msg?: string) => void) {
  const colorInput = byId<HTMLInputElement>('custom-color-input');
  const colorResetBtn = document.getElementById('color-reset-btn');
  if (!colorInput) return;

  const info = await getUserInfo().catch(() => ({} as Record<string, unknown>));
  const savedColor = (info.custom_color as string)
    || localStorage.getItem(STORAGE_KEYS.customColor)
    || DEFAULT_COLOR;
  colorInput.value = savedColor;
  localStorage.setItem(STORAGE_KEYS.customColor, savedColor);
  applyCustomColor(savedColor);

  const { trigger } = debouncedSave(
    800,
    () => saveUserInfo({ custom_color: colorInput.value }),
    showToast,
    'Failed to save custom color:',
  );
  colorInput.addEventListener('input', (e) => {
    const color = (e.target as HTMLInputElement).value;
    localStorage.setItem(STORAGE_KEYS.customColor, color);
    applyCustomColor(color);
    trigger();
  });

  colorResetBtn?.addEventListener('click', async () => {
    colorInput.value = DEFAULT_COLOR;
    localStorage.setItem(STORAGE_KEYS.customColor, DEFAULT_COLOR);
    applyCustomColor(DEFAULT_COLOR);
    await runSave(() => saveUserInfo({ custom_color: DEFAULT_COLOR }), showToast, 'Failed to save custom color:');
  });
}
