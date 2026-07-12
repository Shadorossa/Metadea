import { saveFavoriteCustomImage, deleteFavoriteCustomImage, type FavoriteCustomImage } from '../tauri';
import { openImageCropModal } from '../../components/shared/ImageCropModal';

// Local-only cover editor for the profile Favorites tab. Thin wrapper around
// the shared pan/zoom picker (components/shared/ImageCropModal.tsx) that persists
// the resulting crop — same aspect ratio (3:4) as the .fav-card grid so the
// live preview here and the final card render in render-favorites.ts always
// match.

export type EditorResult =
  | { action: 'saved'; image: FavoriteCustomImage }
  | { action: 'removed' }
  | { action: 'cancelled' };

export async function openFavoriteImageEditor(
  externalId: string,
  fallbackImageUrl: string,
  existing: FavoriteCustomImage | undefined,
): Promise<EditorResult> {
  const result = await openImageCropModal({
    title: 'Editar imagen',
    initialUrl: existing?.image_url || fallbackImageUrl,
    aspectRatio: 3 / 4,
    initialBgSize: existing?.bg_size,
    initialPosX: existing?.pos_x,
    initialPosY: existing?.pos_y,
    removeLabel: 'Quitar imagen personalizada',
  });

  if (result.action === 'cancelled') return { action: 'cancelled' };

  if (result.action === 'removed') {
    await deleteFavoriteCustomImage(externalId).catch(console.error);
    return { action: 'removed' };
  }

  const image = await saveFavoriteCustomImage(externalId, result.imageUrl, result.bgSize, result.posX, result.posY);
  return { action: 'saved', image };
}
