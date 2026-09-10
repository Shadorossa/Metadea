import { tauriTry, tauriRun, invoke } from './core';

export interface ListInfo {
  key:         string;
  name:        string;
  description: string;
  is_fav:      boolean;
  is_private:  boolean;
  is_ranked?:  boolean;
  list_type?:  string;
  item_count:  number;
  preview_ids: string[];
}

export interface ListItemFull {
  external_id: string;
  position:    number;
  library_id:  string | null;
  status:      string | null;
  rating:      number | null;
  progress:    number;
  progress_2:  number;
  is_favorite: boolean;
  is_platinum: boolean;
  title_main:  string | null;
  cover_url:   string | null;
  media_type:  string | null;
  format:      string | null;
}

// getAllUserLists() is refetched by every profile Lists-tab mount — cache
// it at module level, invalidated by this file's own mutators, the same
// pattern used for the library (library-data-cache.ts) and character
// (characters.ts) caches.
let cachedLists: ListInfo[] | null = null;
let listsCachePromise: Promise<ListInfo[]> | null = null;

function invalidateUserListsCache() {
  cachedLists = null;
  listsCachePromise = null;
}

export async function getAllUserLists(forceRefresh = false): Promise<ListInfo[]> {
  if (cachedLists && !forceRefresh) return cachedLists;
  if (listsCachePromise && !forceRefresh) return listsCachePromise;

  listsCachePromise = tauriTry<ListInfo[]>('get_all_user_lists', []).then(list => {
    cachedLists = list;
    listsCachePromise = null;
    return list;
  }).catch(() => {
    listsCachePromise = null;
    return cachedLists ?? [];
  });

  return listsCachePromise;
}

export async function getListItems(listKey: string): Promise<string[]> {
  return tauriTry<string[]>('get_list_items', [], { listKey });
}

export async function getListItemsFull(listKey: string): Promise<ListItemFull[]> {
  return tauriTry<ListItemFull[]>('get_list_items_full', [], { listKey });
}

export async function createUserList(username: string, name: string, description: string, listType?: string): Promise<string> {
  const key = await invoke<string>('create_user_list', { username, name, description, listType });
  invalidateUserListsCache();
  return key;
}

export async function updateUserList(key: string, name: string, description: string, isPrivate: boolean, listType?: string, isRanked?: boolean): Promise<void> {
  await tauriRun('update_user_list', { key, name, description, isPrivate, listType, isRanked });
  invalidateUserListsCache();
}

export async function deleteUserList(key: string): Promise<void> {
  await tauriRun('delete_user_list', { key });
  invalidateUserListsCache();
}

export async function addItemToList(listKey: string, externalId: string): Promise<void> {
  await tauriRun('add_item_to_list', { listKey, externalId });
  invalidateUserListsCache();
}

export async function removeItemFromList(listKey: string, externalId: string): Promise<void> {
  await tauriRun('remove_item_from_list', { listKey, externalId });
  invalidateUserListsCache();
}

export async function reorderListItems(listKey: string, externalIds: string[]): Promise<void> {
  await tauriRun('reorder_list_items', { listKey, externalIds });
  invalidateUserListsCache();
}
