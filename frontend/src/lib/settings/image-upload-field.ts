import { saveImage, getImage, removeImage } from '../storage/images';
import { readFileAsDataURL, fileTooLarge, compressImage } from './image-utils';

export interface ImageUploadFieldOptions {
  storageKey: string;
  maxSizeMb: number;
  compressTo: { width: number; quality: number };
  ids: {
    input: string;
    uploadBtn?: string;
    removeBtn?: string;
    /** Also click-to-upload, plus drag&drop, when present. */
    dropZone?: string;
  };
  /** Only checked when set — avatar has never validated this, banner has. */
  onlyImagesMessage?: string;
  tooLargeMessage: string;
  saveErrorMessage: string;
  showToast: (msg?: string) => void;
  /** Called with the saved data URL, or null once removed/never set. */
  renderPreview: (src: string | null) => void;
}

// Shared upload/compress/save/remove flow behind the Avatar and Banner
// settings fields — same steps, same order, differing only in size limit,
// compression target, and how the preview itself is drawn (circular
// initial-letter fallback vs. a plain <img>, drag&drop or not).
export function initImageUploadField(opts: ImageUploadFieldOptions): void {
  const input     = document.getElementById(opts.ids.input) as HTMLInputElement | null;
  const uploadBtn = opts.ids.uploadBtn ? document.getElementById(opts.ids.uploadBtn) : null;
  const removeBtn = opts.ids.removeBtn ? document.getElementById(opts.ids.removeBtn) : null;
  const dropZone  = opts.ids.dropZone ? document.getElementById(opts.ids.dropZone) : null;
  if (!input) return;

  async function refreshPreview() {
    const src = await getImage(opts.storageKey);
    opts.renderPreview(src);
  }
  refreshPreview();

  async function handleFile(file: File) {
    if (opts.onlyImagesMessage && !file.type.startsWith('image/')) {
      opts.showToast(opts.onlyImagesMessage);
      return;
    }
    if (fileTooLarge(file, opts.maxSizeMb)) { opts.showToast(opts.tooLargeMessage); return; }
    let dataUrl = await readFileAsDataURL(file);
    dataUrl = await compressImage(dataUrl, opts.compressTo.width, opts.compressTo.quality);
    if (!await saveImage(opts.storageKey, dataUrl)) { opts.showToast(opts.saveErrorMessage); return; }
    await refreshPreview();
    // Generic "Cambios guardados" (showToast with no message — see
    // autosave.ts) — was a per-field "Avatar actualizado"/"Banner
    // actualizado" before, unified with every other settings field's
    // success toast. The error paths above stay specific/informative,
    // since those aren't "saved" confirmations, they're explaining why it
    // *didn't* save.
    opts.showToast();
  }

  uploadBtn?.addEventListener('click', () => input.click());
  dropZone?.addEventListener('click', () => input.click());

  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (file) await handleFile(file);
    input.value = '';
  });

  removeBtn?.addEventListener('click', async () => {
    await removeImage(opts.storageKey);
    await refreshPreview();
    opts.showToast();
  });

  if (dropZone) {
    dropZone.addEventListener('dragover', e => {
      e.preventDefault();
      dropZone.classList.add('drag-over');
    });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
    dropZone.addEventListener('drop', async e => {
      e.preventDefault();
      dropZone.classList.remove('drag-over');
      const file = (e as DragEvent).dataTransfer?.files[0];
      if (file) await handleFile(file);
    });
  }
}
