import { initImageUploadField } from './image-upload-field';
import { STORAGE_KEYS } from '../shared/storage-keys';
import { saveImage, getImage, removeImage } from '../storage/images';
import { openImageCropModal } from '../../components/shared/ImageCropModal';

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

// A separate, deliberately-square photo just for the Instagram-style share
// image (see share-image.ts) — the main avatar above can be any crop/aspect
// ratio (most Google avatars and custom uploads are circular-cropped from a
// non-square source), which looked stretched/off-center once drawn onto the
// share card's own square avatar slot. No Google fallback here (unlike
// initAvatar) — there's no square-photo equivalent from Google to fall back
// to, so an empty preview just means share-image.ts falls back to the
// regular avatar itself instead.
//
// Uses the same pan/zoom crop modal Favorites and the character/story-arc
// photo editors already share (ImageCropModal.tsx), locked to aspectRatio:
// 1 — the modal exports the crop at its own native resolution (however many
// real pixels the square viewport spans), so this is genuinely square
// output, not just a square *preview* of a rectangular source.
export function initShareAvatar(showToast: (msg?: string) => void) {
  const preview = document.getElementById('share-avatar-preview');
  const uploadBtn = document.getElementById('share-avatar-upload-btn');
  const removeBtn = document.getElementById('share-avatar-remove-btn');
  if (!preview) return;

  let hasPhoto = false;

  function render(src: string | null) {
    hasPhoto = !!src;
    preview!.classList.toggle('avatar-preview-wrap--empty', !hasPhoto);
    preview!.innerHTML = src
      ? `<img src="${src}" alt="">`
      : '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-5-5L5 21"/></svg>';
  }

  async function openEditor(initialUrl: string) {
    const result = await openImageCropModal({
      title: 'Foto específica',
      initialUrl,
      aspectRatio: 1,
      saveLabel: 'Usar esta imagen',
    });
    if (result.action !== 'saved') return;
    const ok = await saveImage(STORAGE_KEYS.shareAvatarCustom, result.imageUrl);
    if (!ok) { showToast('Error: no se pudo guardar'); return; }
    render(result.imageUrl);
    showToast();
  }

  getImage(STORAGE_KEYS.shareAvatarCustom).then(render);

  uploadBtn?.addEventListener('click', async () => {
    const existing = await getImage(STORAGE_KEYS.shareAvatarCustom);
    openEditor(existing ?? '');
  });

  // Clicking the empty preview itself is a shortcut straight to the OS
  // file picker, then into the same crop editor above — pasting/dragging a
  // URL onto the modal isn't the obvious first move when there's nothing
  // to preview yet and the box is just sitting there empty.
  preview.addEventListener('click', () => {
    if (hasPhoto) return;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === 'string') openEditor(reader.result);
      };
      reader.readAsDataURL(file);
    });
    input.click();
  });

  removeBtn?.addEventListener('click', async () => {
    await removeImage(STORAGE_KEYS.shareAvatarCustom);
    render(null);
    showToast();
  });
}
