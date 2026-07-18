import { initImageUploadField } from './image-upload-field';
import { STORAGE_KEYS } from '../shared/storage-keys';

export function initAvatar(
  googleAvatar: string | null,
  username: string,
  showToast: (msg?: string) => void,
) {
  const preview = document.getElementById('avatar-preview');
  if (!preview) return;

  initImageUploadField({
    storageKey: STORAGE_KEYS.profileAvatarCustom,
    maxSizeMb: 8,
    compressTo: { width: 1000, quality: 0.95 },
    ids: { input: 'avatar-input', uploadBtn: 'avatar-upload-btn', removeBtn: 'avatar-remove-btn' },
    tooLargeMessage: 'La imagen supera los 8 MB',
    saveErrorMessage: 'Error: no se pudo guardar',
    showToast,
    renderPreview: (custom) => {
      const src = custom || googleAvatar;
      if (src) {
        preview.innerHTML = `<img src="${src}" alt="${username}" referrerpolicy="no-referrer">`;
      } else {
        preview.textContent = (username[0] ?? '?').toUpperCase();
      }
    },
  });
}
