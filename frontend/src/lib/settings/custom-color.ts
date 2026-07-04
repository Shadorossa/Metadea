import { saveUserInfo, getUserInfo } from '../tauri';

const DEFAULT_COLOR = '#c084fc';

function applyCustomColor(color: string) {
  document.documentElement.style.setProperty('--accent', color);
  document.documentElement.style.setProperty('--accent-soft', `${color}19`);
  document.documentElement.style.setProperty('--accent-border', `${color}40`);
  document.documentElement.style.setProperty('--accent-glow', `${color}4d`);
}

// DB is the source of truth; localStorage is kept as a fast read cache.
export async function initCustomColor(showToast: (msg?: string) => void) {
  const colorInput = document.getElementById('custom-color-input') as HTMLInputElement | null;
  const colorHexDisplay = document.getElementById('color-hex-display');
  const colorResetBtn = document.getElementById('color-reset-btn');
  if (!colorInput || !colorHexDisplay) return;

  const info = await getUserInfo().catch(() => ({} as Record<string, unknown>));
  const savedColor = (info.custom_color as string)
    || localStorage.getItem('metadea_custom_color')
    || DEFAULT_COLOR;
  colorInput.value = savedColor;
  colorHexDisplay.textContent = `Actual: ${savedColor}`;
  localStorage.setItem('metadea_custom_color', savedColor);
  applyCustomColor(savedColor);

  let colorTimer: ReturnType<typeof setTimeout>;
  colorInput.addEventListener('input', (e) => {
    const color = (e.target as HTMLInputElement).value;
    colorHexDisplay.textContent = `Actual: ${color}`;
    localStorage.setItem('metadea_custom_color', color);
    applyCustomColor(color);
    clearTimeout(colorTimer);
    colorTimer = setTimeout(() => saveUserInfo({ custom_color: color }).catch(() => {}), 800);
  });

  colorResetBtn?.addEventListener('click', async () => {
    colorInput.value = DEFAULT_COLOR;
    colorHexDisplay.textContent = `Actual: ${DEFAULT_COLOR}`;
    localStorage.setItem('metadea_custom_color', DEFAULT_COLOR);
    applyCustomColor(DEFAULT_COLOR);
    await saveUserInfo({ custom_color: DEFAULT_COLOR }).catch(() => {});
    showToast('Color restaurado');
  });
}
