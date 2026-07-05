import { saveImage, getImage, removeImage } from '../storage/images';
import { readFileAsDataURL, fileTooLarge, compressImage } from './image-utils';
import { byId } from '../shared/dom';

export function initAvatar(
  googleAvatar: string | null,
  username: string,
  showToast: (msg?: string) => void,
) {
  const preview   = document.getElementById('avatar-preview');
  const input     = byId<HTMLInputElement>('avatar-input');
  const uploadBtn = document.getElementById('avatar-upload-btn');
  const removeBtn = document.getElementById('avatar-remove-btn');

  if (!preview || !input || !uploadBtn || !removeBtn) return;

  async function renderAvatarPreview() {
    const custom = await getImage('profile_avatar_custom');
    const src    = custom || googleAvatar;
    if (src) {
      preview.innerHTML = `<img src="${src}" alt="${username}" referrerpolicy="no-referrer">`;
    } else {
      preview.textContent = (username[0] ?? '?').toUpperCase();
    }
  }

  renderAvatarPreview();

  uploadBtn.addEventListener('click', () => input.click());

  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (!file) return;
    if (fileTooLarge(file, 8)) { showToast('La imagen supera los 8 MB'); return; }
    let dataUrl = await readFileAsDataURL(file);
    dataUrl = await compressImage(dataUrl, 1000, 0.95);
    if (!await saveImage('profile_avatar_custom', dataUrl)) {
      showToast('Error: no se pudo guardar'); return;
    }
    renderAvatarPreview();
    showToast('Avatar actualizado');
    input.value = '';
  });

  removeBtn.addEventListener('click', async () => {
    await removeImage('profile_avatar_custom');
    renderAvatarPreview();
    showToast('Avatar eliminado');
  });
}
