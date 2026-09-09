import { isTauri, invoke, tauriCmd, tauriRun } from './core';

// Local-only cover override for the profile Favorites tab. bg_size/pos_x/
// pos_y map directly to CSS background-size/background-position percentages
// so the editor's live preview and the final card render use the exact same
// formula — see components/profile/FavoriteImageEditor.ts.
export interface FavoriteCustomImage {
  external_id: string;
  list_name:   string;
  file_name:   string;
  /** Ready-to-use `data:` URL — the image bytes live on disk, this is filled in by the backend at read time. */
  image_url:   string;
  bg_size:     number;
  pos_x:       number;
  pos_y:       number;
  updated_at:  string;
}

let cachedImagesMap: Map<string, FavoriteCustomImage> | null = null;
let cachePromise: Promise<Map<string, FavoriteCustomImage>> | null = null;

export function invalidateCustomImagesCache() {
  cachedImagesMap = null;
  cachePromise = null;
}

export async function saveFavoriteCustomImage(
  externalId: string,
  imageUrl: string,
  bgSize: number,
  posX: number,
  posY: number,
): Promise<FavoriteCustomImage> {
  if (!isTauri()) throw new Error('Tauri not available');
  const res = await invoke<FavoriteCustomImage>('save_favorite_custom_image', { externalId, imageUrl, bgSize, posX, posY });
  invalidateCustomImagesCache();
  return res;
}

export async function getFavoriteCustomImage(externalId: string): Promise<FavoriteCustomImage | null> {
  return tauriCmd<FavoriteCustomImage | null>('get_favorite_custom_image', null, { externalId });
}

export async function getAllFavoriteCustomImages(): Promise<FavoriteCustomImage[]> {
  return tauriCmd<FavoriteCustomImage[]>('get_all_favorite_custom_images', []);
}

export async function getCustomImagesMap(forceRefresh = false): Promise<Map<string, FavoriteCustomImage>> {
  if (cachedImagesMap && !forceRefresh) return cachedImagesMap;
  if (cachePromise && !forceRefresh) return cachePromise;

  cachePromise = getAllFavoriteCustomImages().then(list => {
    const map = new Map<string, FavoriteCustomImage>();
    for (const img of list) {
      map.set(img.external_id, img);
    }
    cachedImagesMap = map;
    cachePromise = null;
    return map;
  }).catch(() => {
    cachePromise = null;
    return cachedImagesMap ?? new Map();
  });

  return cachePromise;
}

export async function deleteFavoriteCustomImage(externalId: string): Promise<void> {
  await tauriRun('delete_favorite_custom_image', { externalId });
  invalidateCustomImagesCache();
}
