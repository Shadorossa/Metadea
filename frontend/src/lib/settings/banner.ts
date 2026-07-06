import { saveImage, getImage, removeImage } from '../storage/images';
import { readFileAsDataURL, fileTooLarge, compressImage } from './image-utils';
import { byId } from '../shared/dom';
import { getT } from '../../i18n/client';

export function initBanner(showToast: (msg?: string) => void) {
  const t = getT().settings;
  const dropZone  = document.getElementById('banner-drop-zone')!;
  const input     = byId<HTMLInputElement>('banner-input')!;
  const uploadBtn = document.getElementById('banner-upload-btn')!;
  const removeBtn = document.getElementById('banner-remove-btn')!;

  async function renderBannerPreview() {
    const src = await getImage('profile_banner_custom');
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
  }

  renderBannerPreview();

  async function handleFile(file: File) {
    if (!file.type.startsWith('image/')) { showToast(t.banner_only_images); return; }
    if (fileTooLarge(file, 20)) { showToast(t.banner_too_large); return; }
    let dataUrl = await readFileAsDataURL(file);
    dataUrl = await compressImage(dataUrl, 2560, 0.80);
    if (!await saveImage('profile_banner_custom', dataUrl)) {
      showToast(t.banner_save_error); return;
    }
    renderBannerPreview();
    showToast(t.banner_updated);
  }

  uploadBtn.addEventListener('click', () => input.click());
  dropZone.addEventListener('click',  () => input.click());

  input.addEventListener('change', async () => {
    if (input.files?.[0]) await handleFile(input.files[0]);
    input.value = '';
  });

  removeBtn.addEventListener('click', async () => {
    await removeImage('profile_banner_custom');
    renderBannerPreview();
    showToast(t.banner_removed);
  });

  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('drag-over');
  });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
  dropZone.addEventListener('drop', async (e) => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    const file = e.dataTransfer?.files[0];
    if (file) await handleFile(file);
  });
}
