import { tauriCmd } from './core';

// Downloads a remote image server-side and hands it back as a data: URL —
// see fetch_image_data_url's own Rust-side comment for why share-image.ts
// needs this instead of just loading the URL into an <img> directly.
export async function fetchImageDataUrl(url: string): Promise<string | null> {
  return tauriCmd<string | null>('fetch_image_data_url', null, { url });
}

// dataUrl is a "data:image/png;base64,...." string (see share-image.ts,
// which renders it on a canvas) — puts up a native save dialog and writes
// it there. Returns the saved path, or null if the user cancelled.
export async function saveImageFile(dataUrl: string, defaultName: string): Promise<string | null> {
  return tauriCmd<string | null>('save_image_file', null, { dataUrl, defaultName });
}
