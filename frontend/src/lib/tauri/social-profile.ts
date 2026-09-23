// Local cache of OTHER users' downloaded profile data — see
// src-tauri/src/social_profile.rs for the full rationale. Never touches your
// own library/activity/lists tables.
import { tauriTry, tauriRun } from './bridge';
import { emptyCharacterReactionGroups, type CharacterReaction, type CharacterReactionGroups } from './character-reactions';

export interface SocialLibraryItem {
  external_id: string;
  rating: number | null;
  started_at: string | null;
  finished_at: string | null;
  notes: string | null;
  tags: string[] | null;
  status: string | null;
  progress: number | null;
  // Profile-parity fields — null when the owner's app synced before it
  // sent them (see src-tauri/src/social_profile.rs).
  rating_2?: number | null;
  progress_2?: number | null;
  minutes_spent?: number | null;
  reconsumption_count?: number | null;
  reconsuming?: number | null;
  /** The owner's chosen cover for this work, overriding the catalog's. */
  preferred_cover?: string | null;
  title_main: string | null;
  cover_url: string | null;
  media_type: string | null;
}

export interface SocialActivityItem {
  external_id: string;
  event_type: string;
  media_type: string | null;
  date: string | null;
  timestamp: string;
  progress_start: number | null;
  progress_end: number | null;
  occurrence?: number | null;
  title_main: string | null;
  cover_url: string | null;
}

export interface SocialMediaRef {
  external_id: string;
  title_main: string | null;
  cover_url: string | null;
  media_type: string | null;
}

export interface SocialMonthGroup {
  month: string;
  items: SocialMediaRef[];
}

export interface SocialListInfo {
  key: string;
  name: string;
  description: string;
  is_fav: boolean;
  item_count: number;
}

export interface SocialLibraryInput {
  external_id: string;
  rating?: number | null;
  started_at?: string | null;
  finished_at?: string | null;
  notes?: string | null;
  tags?: string[] | null;
  status?: string | null;
  progress?: number | null;
  rating_2?: number | null;
  progress_2?: number | null;
  minutes_spent?: number | null;
  reconsumption_count?: number | null;
  reconsuming?: number | null;
  preferred_cover?: string | null;
}

export interface SocialActivityInput {
  externalId: string;
  type: string;
  mediaType?: string | null;
  date?: string | null;
  timestamp: string;
  progressStart?: number | null;
  progressEnd?: number | null;
  occurrence?: number | null;
}

export interface SocialListInput {
  key: string;
  name: string;
  description: string;
  is_fav: boolean;
  items: string[];
}

export interface SocialCharacterReactionEntryInput {
  external_id: string;
  name: string | null;
  image_url: string | null;
}

export type SocialCharacterReactionsInput = Record<CharacterReaction, SocialCharacterReactionEntryInput[]>;

export async function hydrateSocialProfile(
  socialUserId: string,
  library: SocialLibraryInput[],
  activity: SocialActivityInput[],
  monthlyHistory: Record<string, string[]>,
  lists: SocialListInput[],
  /** null = the profile shares none. */
  characterReactions: SocialCharacterReactionsInput | null = null,
): Promise<void> {
  return tauriRun('hydrate_social_profile', {
    socialUserId, library, activity, monthlyHistory, lists, characterReactions,
  });
}

/** Their like / interest / dislike lists (image_url: wrapAssetUrl it). */
export async function getSocialCharacterReactions(socialUserId: string): Promise<CharacterReactionGroups> {
  return tauriTry<CharacterReactionGroups>('get_social_character_reactions', emptyCharacterReactionGroups(), { socialUserId });
}

export async function getSocialLists(socialUserId: string): Promise<SocialListInfo[]> {
  return tauriTry<SocialListInfo[]>('get_social_lists', [], { socialUserId });
}

// `_light` commands: a character item's cover_url is the portrait's file
// path instead of an inlined base64 data URL — callers MUST pass cover_url
// through wrapAssetUrl() before using it as an <img src>. Media covers are
// remote URLs and pass through unchanged.

export async function getSocialLibraryLight(socialUserId: string): Promise<SocialLibraryItem[]> {
  return tauriTry<SocialLibraryItem[]>('get_social_library_light', [], { socialUserId });
}

export async function getSocialActivityLight(socialUserId: string): Promise<SocialActivityItem[]> {
  return tauriTry<SocialActivityItem[]>('get_social_activity_light', [], { socialUserId });
}

export async function getSocialMonthlyHistoryLight(socialUserId: string): Promise<SocialMonthGroup[]> {
  return tauriTry<SocialMonthGroup[]>('get_social_monthly_history_light', [], { socialUserId });
}

export async function getSocialListItemsLight(socialUserId: string, listKey: string): Promise<SocialMediaRef[]> {
  return tauriTry<SocialMediaRef[]>('get_social_list_items_light', [], { socialUserId, listKey });
}

// Taste compatibility with a visited profile — see
// src-tauri/src/taste_compatibility.rs. Ratings are normalised to 0-1;
// scoring lives in lib/social/taste-compatibility.ts.
export interface TasteRatingPair {
  external_id: string;
  own: number;
  their: number;
}

export interface TasteCompatibilityData {
  own_engaged: number;
  their_engaged: number;
  shared_works: number;
  shared_completed: number;
  shared_engaged: number;
  both_rated: number;
  mean_abs_diff: number | null;
  rating_pairs: TasteRatingPair[];
  shared_favorites: string[];
  shared_favorites_total: number;
}

/** null outside Tauri or on error — the profile simply shows no badge. */
export async function getTasteCompatibility(
  socialUserId: string,
  theirFavoriteIds: string[],
): Promise<TasteCompatibilityData | null> {
  return tauriTry<TasteCompatibilityData | null>('get_taste_compatibility', null, { socialUserId, theirFavoriteIds });
}
