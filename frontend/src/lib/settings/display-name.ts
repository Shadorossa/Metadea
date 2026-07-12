import { saveUserInfo, getUserInfo, getAuthToken } from '../tauri';
import { byId } from '../shared/dom';

export async function initDisplayName(showToast: (msg?: string) => void) {
  const input = byId<HTMLInputElement>('display-name-input');
  if (!input) return;

  const info = await getUserInfo().catch(() => ({} as Record<string, unknown>));
  const customName = (info.display_name as string | undefined)?.trim();
  if (customName) {
    input.value = customName;
  } else {
    // No custom display name saved yet — show the actual username picked at
    // login instead of leaving the field blank (which read as "the app
    // doesn't know your name" rather than "you haven't overridden it yet").
    const session = await getAuthToken().catch(() => null);
    input.value = session?.username ?? '';
  }

  let saveTimer: ReturnType<typeof setTimeout>;
  async function saveDisplayName() {
    const newName = input!.value.trim();
    try {
      await saveUserInfo({ display_name: newName });
      // Same cache profile.astro's banner reads on its fast pre-render path
      // — without this, the banner keeps showing the old name until a full
      // reload re-fetches getUserInfo() from the backend.
      if (newName) localStorage.setItem('profile_username_cache', newName);
      showToast('Nombre guardado');
    } catch (err) {
      console.error('Failed to save display name:', err);
      showToast('Error al guardar el nombre');
    }
  }

  input.addEventListener('blur', saveDisplayName);
  input.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Enter') { e.preventDefault(); saveDisplayName(); }
  });
  input.addEventListener('input', () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveDisplayName, 1500);
  });
}
