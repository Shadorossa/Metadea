import { saveUserInfo, getUserInfo, getAuthToken } from '../tauri';
import { byId } from '../shared/dom';
import { debouncedSave } from './autosave';

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

  const save = async () => {
    const newName = input.value.trim();
    await saveUserInfo({ display_name: newName });
    // Same cache profile.astro's banner reads on its fast pre-render path
    // — without this, the banner keeps showing the old name until a full
    // reload re-fetches getUserInfo() from the backend.
    if (newName) localStorage.setItem('profile_username_cache', newName);
  };

  const { trigger, flushNow } = debouncedSave(1500, save, showToast, 'Failed to save display name:');
  input.addEventListener('input', trigger);
  input.addEventListener('blur', flushNow);
  input.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Enter') { e.preventDefault(); flushNow(); }
  });
}
