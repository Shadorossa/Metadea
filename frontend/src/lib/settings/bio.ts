import { saveUserInfo, getUserInfo } from '../tauri';
import { byId } from '../shared/dom';

// Previously only ever read/wrote localStorage — it never persisted to
// user_metadata (the 'bio' column getUserInfo/saveUserInfo already support,
// same as display_name/custom_color), so the value never survived a machine
// change and was never actually backed by the same store the rest of the
// profile fields use.
export async function initBio(showToast: (msg?: string) => void) {
  const bioTextarea = byId<HTMLTextAreaElement>('bio-textarea');
  const bioCharCount = document.getElementById('bio-char-count');
  if (!bioTextarea || !bioCharCount) return;

  const info = await getUserInfo().catch(() => ({} as Record<string, unknown>));
  const savedBio = (info.bio as string | undefined) ?? '';
  bioTextarea.value = savedBio;
  bioCharCount.textContent = savedBio.length.toString();

  let saveTimer: ReturnType<typeof setTimeout>;
  async function saveBio() {
    const newBio = bioTextarea!.value;
    try {
      await saveUserInfo({ bio: newBio });
      showToast('Bio guardada');
    } catch (err) {
      console.error('Failed to save bio:', err);
      showToast('Error al guardar la bio');
    }
  }

  bioTextarea.addEventListener('input', () => {
    bioCharCount!.textContent = bioTextarea!.value.length.toString();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveBio, 1500);
  });
}
