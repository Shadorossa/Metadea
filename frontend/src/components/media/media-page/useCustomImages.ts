import { useEffect, useState } from 'react';
import { getCustomImagesMap, type FavoriteCustomImage } from '../../../lib/tauri';

// User-chosen replacement images for characters/staff, re-read on every
// navigation. Kept as a plain effect rather than useAsyncResource: a late
// result still applies, and a failed read keeps the previous map instead of
// clearing it — both of which the shared hook does the other way round.
export function useCustomImages(currentId: string, previewMode: boolean) {
  const [customImagesMap,    setCustomImagesMap]    = useState<Map<string, FavoriteCustomImage>>(new Map());

  useEffect(() => {
    if (previewMode) return;
    if (!currentId) return;
    getCustomImagesMap().then(setCustomImagesMap).catch(() => {});
  }, [currentId, previewMode]);

  return customImagesMap;
}
