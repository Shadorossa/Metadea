import { tauriTry, tauriRun, invoke } from './core';

export interface ListInfo {
  key:         string;
  name:        string;
  description: string;
  is_fav:      boolean;
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

export async function getAllUserLists(): Promise<ListInfo[]> {
  return tauriTry<ListInfo[]>('get_all_user_lists', []);
}

export async function getListItems(listKey: string): Promise<string[]> {
  return tauriTry<string[]>('get_list_items', [], { listKey });
}

export async function getListItemsFull(listKey: string): Promise<ListItemFull[]> {
  return tauriTry<ListItemFull[]>('get_list_items_full', [], { listKey });
}

export async function createUserList(username: string, name: string, description: string): Promise<string> {
  return invoke<string>('create_user_list', { username, name, description });
}

export async function updateUserList(key: string, name: string, description: string): Promise<void> {
  return tauriRun('update_user_list', { key, name, description });
}

export async function deleteUserList(key: string): Promise<void> {
  return tauriRun('delete_user_list', { key });
}

export async function addItemToList(listKey: string, externalId: string): Promise<void> {
  return tauriRun('add_item_to_list', { listKey, externalId });
}

export async function removeItemFromList(listKey: string, externalId: string): Promise<void> {
  return tauriRun('remove_item_from_list', { listKey, externalId });
}

export async function reorderListItems(listKey: string, externalIds: string[]): Promise<void> {
  return tauriRun('reorder_list_items', { listKey, externalIds });
}
