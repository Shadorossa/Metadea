// Profile avatar/banner images stored by user_metadata.rs. The legacy
// get_user_image call (an inlined base64 data URL) is issued directly from
// lib/storage/images.ts; this module only adds the path-returning flavour.
import { tauriTry } from './bridge';

export type UserImageKey = 'avatar' | 'banner' | 'share_avatar';

/** The stored avatar/banner's absolute file path — callers MUST pass it
 *  through wrapAssetUrl() before using it as an <img src> or CSS url().
 *  A legacy inline data URL still stored in the column comes back as-is
 *  (wrapAssetUrl leaves data: URLs untouched). null when nothing is set. */
export async function getUserImagePath(key: UserImageKey): Promise<string | null> {
  return tauriTry<string | null>('get_user_image_path', null, { key });
}
