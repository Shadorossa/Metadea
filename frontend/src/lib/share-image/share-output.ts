// What happens to a rendered share image: PNG encoding, file names, saving
// through the native dialog (save_image_file) and the clipboard.
import { saveImageFile } from '../tauri/share-image';

/** Lowercase ASCII slug for file names: accents folded, anything else
 *  becomes a dash. '' when nothing usable is left. */
export function slugifyFileName(text: string, maxLength = 60): string {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLength)
    .replace(/-+$/g, '');
}

export function tierListImageFileName(title: string): string {
  const slug = slugifyFileName(title);
  return `metadea-tierlist${slug ? `-${slug}` : ''}.png`;
}

export function bingoImageFileName(year: number): string {
  return `metadea-bingo-${year}.png`;
}

export function exportCanvasToPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob(blob => (blob ? resolve(blob) : reject(new Error('PNG encoding failed'))), 'image/png');
    } catch (error) {
      // SecurityError from a tainted canvas.
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read image'));
    reader.readAsDataURL(blob);
  });
}

/** Native save dialog, opened in Pictures/Metadea. Resolves to the saved
 *  path, or null when the user cancelled. Errors propagate. */
export async function saveSharePng(blob: Blob, fileName: string): Promise<string | null> {
  const dataUrl = await blobToDataUrl(blob);
  return saveImageFile(dataUrl, fileName, { inPicturesFolder: true });
}

/** Copies the PNG to the clipboard. False when the WebView has no image
 *  clipboard support or refuses the write (the caller shows a toast).
 *  Pass the render as a promise straight from the click handler: the write
 *  then starts inside the user gesture, which some WebViews require, while
 *  the image is still being drawn. */
export async function copySharePng(blob: Blob | Promise<Blob>): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.clipboard?.write || typeof ClipboardItem === 'undefined') return false;
  try {
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    return true;
  } catch {
    return false;
  }
}
