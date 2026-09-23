// The owner block of a share image: the signed-in user's name and avatar,
// read from the same localStorage caches the navbar paints from (written by
// profile.astro and Settings → Profile), so no network call is needed.
import { STORAGE_KEYS } from '../storage/storage-keys';
import type { ShareOwner } from './share-image-types';

const PROFILE_AVATAR_CACHE = 'profile_avatar_cache';
// Settings → "Foto específica": a square photo meant for share images.
const SHARE_AVATAR_CACHE = 'share_avatar_cache';
const PROFILE_USERNAME_CACHE = 'profile_username_cache';

function read(key: string): string {
  try {
    return localStorage.getItem(key)?.trim() ?? '';
  } catch {
    return '';
  }
}

export function readShareOwner(): ShareOwner {
  const displayName = read(PROFILE_USERNAME_CACHE) || read(STORAGE_KEYS.authUsername) || 'Metadea';
  const avatarUrl = read(SHARE_AVATAR_CACHE) || read(PROFILE_AVATAR_CACHE) || null;
  return { displayName, avatarUrl };
}
