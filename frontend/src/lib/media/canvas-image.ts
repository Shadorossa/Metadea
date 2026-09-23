// Loads an image for drawing onto a <canvas> that will be exported
// (lib/media/editor/share-image.ts). A remote https:// image loaded
// straight into an <img> and exported via canvas comes back blank unless its
// server sends CORS headers explicitly allowing it — AniList/TMDB/IGDB
// covers generally don't. Routing it through the Rust side
// (fetch_image_data_url: a plain server-side fetch, no browser CORS policy
// involved) and getting a data: URL back sidesteps that; a data: URL never
// taints a canvas. Already-local sources (data:, asset://) load as-is.
import { fetchImageDataUrl } from '../tauri/share-image';

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = src;
  });
}

/** The image, or null when it could not be fetched or decoded. */
export async function resolveCanvasImage(src: string): Promise<HTMLImageElement | null> {
  try {
    // Some AniList fields come back protocol-relative ("//s4.anilist.co/...").
    const normalized = src.startsWith('//') ? `https:${src}` : src;
    if (normalized.startsWith('http://') || normalized.startsWith('https://')) {
      const dataUrl = await fetchImageDataUrl(normalized);
      return await loadImage(dataUrl ?? normalized);
    }
    return await loadImage(normalized);
  } catch {
    return null;
  }
}
