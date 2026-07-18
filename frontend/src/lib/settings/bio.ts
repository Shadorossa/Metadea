import { saveUserInfo, getUserInfo } from '../tauri';
import { byId } from '../shared/dom';
import { debouncedSave } from './autosave';

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

  const save = () => saveUserInfo({ bio: bioTextarea.value });
  const { trigger } = debouncedSave(1500, save, showToast, 'Failed to save bio:');

  bioTextarea.addEventListener('input', () => {
    bioCharCount!.textContent = bioTextarea!.value.length.toString();
    trigger();
  });
}
