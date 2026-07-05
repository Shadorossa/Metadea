import { STORAGE_KEYS } from '../shared/storage-keys';
import { byId } from '../shared/dom';

export function initBio() {
  const bioTextarea = byId<HTMLTextAreaElement>('bio-textarea');
  const bioCharCount = document.getElementById('bio-char-count');
  if (!bioTextarea || !bioCharCount) return;

  const savedBio = localStorage.getItem(STORAGE_KEYS.userBio) || '';
  bioTextarea.value = savedBio;
  bioCharCount.textContent = savedBio.length.toString();

  bioTextarea.addEventListener('input', () => {
    bioCharCount.textContent = bioTextarea.value.length.toString();
    localStorage.setItem(STORAGE_KEYS.userBio, bioTextarea.value);
  });
}
