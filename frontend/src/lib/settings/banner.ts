import { initImageUploadField } from './image-upload-field';
import { getT } from '../../i18n/client';
import { STORAGE_KEYS } from '../shared/storage-keys';

export function initBanner(showToast: (msg?: string) => void) {
  const t = getT().settings;
  const dropZone = document.getElementById('banner-drop-zone');
  if (!dropZone) return;

  initImageUploadField({
    storageKey: STORAGE_KEYS.profileBannerCustom,
    maxSizeMb: 20,
    compressTo: { width: 2560, quality: 0.80 },
    ids: { input: 'banner-input', uploadBtn: 'banner-upload-btn', removeBtn: 'banner-remove-btn', dropZone: 'banner-drop-zone' },
    onlyImagesMessage: t.banner_only_images,
    tooLargeMessage: t.banner_too_large,
    saveErrorMessage: t.banner_save_error,
    showToast,
    renderPreview: (src) => {
      dropZone.querySelector('img')?.remove();
      if (src) {
        const img = document.createElement('img');
        img.src = src;
        img.alt = 'Banner';
        dropZone.prepend(img);
        dropZone.classList.add('has-image');
      } else {
        dropZone.classList.remove('has-image');
      }
    },
  });
}
