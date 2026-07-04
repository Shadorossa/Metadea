import { saveUserInfo, getUserInfo } from '../tauri';

export async function initDisplayName(showToast: (msg?: string) => void) {
  const input = document.getElementById('display-name-input') as HTMLInputElement | null;
  if (!input) return;

  const info = await getUserInfo().catch(() => ({} as Record<string, unknown>));
  input.value = (info.display_name as string) || '';

  let saveTimer: ReturnType<typeof setTimeout>;
  async function saveDisplayName() {
    const newName = input!.value.trim();
    await saveUserInfo({ display_name: newName }).catch(() => {});
    showToast('Nombre guardado');
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
