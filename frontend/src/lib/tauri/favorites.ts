import { isTauri, invoke, readStoredJson } from './core';
import { STORAGE_KEYS } from '../shared/storage-keys';

function typeToFavKey(type: string): string {
  return `${type}_fav`;
}

export async function readUserFavorites(): Promise<Record<string, string[]>> {
  return readStoredJson<Record<string, string[]>>('read_user_favorites', STORAGE_KEYS.userFavorite, {});
}

export async function writeUserFavorites(favorites: Record<string, string[]>): Promise<void> {
  if (!isTauri()) {
    localStorage.setItem(STORAGE_KEYS.userFavorite, JSON.stringify(favorites));
    return;
  }
  return invoke<void>('write_user_favorites', { content: JSON.stringify(favorites) });
}

export async function syncFavorites(
  type: string,
  externalId: string,
  isFavorite: boolean,
): Promise<void> {
  if (isTauri()) {
    const listKey = typeToFavKey(type || 'book');
    if (isFavorite) {
      await invoke<void>('add_item_to_list', { listKey, externalId });
    } else {
      await invoke<void>('remove_item_from_list', { listKey, externalId });
      await invoke<void>('remove_item_from_list', { listKey: 'multimedia_fav', externalId }).catch(() => {});
    }
    return;
  }
  // localStorage fallback
  const favs = await readUserFavorites().catch(() => ({} as Record<string, string[]>));
  const key = type || 'book';
  if (!favs[key]) favs[key] = [];
  if (isFavorite) {
    if (!favs[key].includes(externalId)) favs[key].push(externalId);
  } else {
    favs[key] = favs[key].filter(id => id !== externalId);
    if (favs.multimedia) favs.multimedia = favs.multimedia.filter(id => id !== externalId);
  }
  localStorage.setItem(STORAGE_KEYS.userFavorite, JSON.stringify(favs));
}
