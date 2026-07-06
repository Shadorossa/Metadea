import { tauriTry, tauriRun, invoke } from './core';

export interface TierDef {
  id:    string;
  label: string;
  color: string;
}

export interface TierListInfo {
  id:          string;
  name:        string;
  list_type:   string;
  item_count:  number;
  preview_ids: string[];
}

export interface TierListItemFull {
  external_id: string;
  tier_key:    string;
  position:    number;
  title_main:  string | null;
  cover_url:   string | null;
  media_type:  string | null;
}

export interface TierListDetail {
  id:        string;
  name:      string;
  list_type: string;
  tiers:     TierDef[];
  items:     TierListItemFull[];
}

export interface TierItemPlacement {
  external_id: string;
  tier_key:    string;
  position:    number;
}

export async function createTierList(name: string, listType: string): Promise<string> {
  return invoke<string>('create_tier_list', { name, listType });
}

export async function getAllTierLists(): Promise<TierListInfo[]> {
  return tauriTry<TierListInfo[]>('get_all_tier_lists', []);
}

export async function getTierList(id: string): Promise<TierListDetail | null> {
  return tauriTry<TierListDetail | null>('get_tier_list', null, { id });
}

export async function deleteTierList(id: string): Promise<void> {
  return tauriRun('delete_tier_list', { id });
}

export async function updateTierListTiers(id: string, tiers: TierDef[]): Promise<void> {
  return tauriRun('update_tier_list_tiers', { id, tiers });
}

export async function addItemToTierList(tierListId: string, externalId: string): Promise<void> {
  return tauriRun('add_item_to_tier_list', { tierListId, externalId });
}

export async function removeItemFromTierList(tierListId: string, externalId: string): Promise<void> {
  return tauriRun('remove_item_from_tier_list', { tierListId, externalId });
}

export async function setTierListPlacements(tierListId: string, placements: TierItemPlacement[]): Promise<void> {
  return tauriRun('set_tier_list_placements', { tierListId, placements });
}
