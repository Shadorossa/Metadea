import { tauriTry, tauriRun, invoke } from './bridge';

// Tier lists — see src-tauri/src/tier_lists.rs. The editor autosaves the
// whole board with saveTierList (one transaction on the Rust side).

export interface TierDef {
  id:    string;
  label: string;
  color: string;
}

export interface TierPreviewItem {
  external_id: string;
  tier_key:    string;
  cover_url:   string | null;
}

export interface TierListInfo {
  id:          string;
  name:        string;
  description: string;
  list_type:   string;
  is_public:   boolean;
  item_count:  number;
  updated_at:  string;
  tiers:       TierDef[];
  /** First thumbnails of each ranked row, for index/profile previews. */
  preview:     TierPreviewItem[];
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
  id:          string;
  name:        string;
  description: string;
  list_type:   string;
  is_public:   boolean;
  /** Opaque display preferences — parsed by lib/tier/tier-settings.ts. */
  settings:    unknown;
  updated_at:  string;
  tiers:       TierDef[];
  items:       TierListItemFull[];
}

export interface TierItemSave {
  external_id: string;
  tier_key:    string;
  position:    number;
  title:       string | null;
  cover_url:   string | null;
  media_type:  string | null;
}

export interface TierListSave {
  id:          string;
  name:        string;
  description: string;
  is_public:   boolean;
  settings:    unknown;
  tiers:       TierDef[];
  items:       TierItemSave[];
}

export async function createTierList(name: string, listType: string): Promise<string> {
  return invoke<string>('create_tier_list', { name, listType });
}

export async function getAllTierLists(): Promise<TierListInfo[]> {
  return tauriTry<TierListInfo[]>('get_all_tier_lists', []);
}

/** Propagates errors (E_TIER_LIST_NOT_FOUND included) — the editor tells
 *  "missing" apart from "failed to load". */
export async function getTierList(id: string): Promise<TierListDetail> {
  return invoke<TierListDetail>('get_tier_list', { id });
}

export async function deleteTierList(id: string): Promise<void> {
  return tauriRun('delete_tier_list', { id });
}

/** Replaces header + every placement; resolves to the new updated_at. */
export async function saveTierList(payload: TierListSave): Promise<string> {
  return invoke<string>('save_tier_list', { payload });
}

export async function duplicateTierList(id: string, name: string): Promise<string> {
  return invoke<string>('duplicate_tier_list', { id, name });
}
