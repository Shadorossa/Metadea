import { saveUserInfo, getUserInfo } from '../tauri';

export async function initDisplayName(showToast: (msg?: string) => void) {
  const input = document.getElementById('display-name-input') as HTMLInputElement | null;
  if (!input) return;

  const info = await getUserInfo().catch(() => ({} as Record<string, unknown>));
  input.value = (info.display_name as string) || '';

  let saveTimer: ReturnType<typeof setTimeout>;
  async function saveDisplayName() {
    const newName = input!.value.trim();
    try {
      await saveUserInfo({ display_name: newName });
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
