// Local cache of OTHER users' downloaded profile data — see
// src-tauri/src/social_profile.rs for the full rationale. Never touches your
// own library/activity/lists tables.
import { tauriTry, tauriRun } from './core';

export interface SocialLibraryItem {
  external_id: string;
  rating: number | null;
  started_at: string | null;
  finished_at: string | null;
  notes: string | null;
  tags: string | null;
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
  tags?: string | null;
}

export interface SocialActivityInput {
  externalId: string;
  type: string;
  mediaType?: string | null;
  date?: string | null;
  timestamp: string;
  progressStart?: number | null;
  progressEnd?: number | null;
}

export interface SocialListInput {
  key: string;
  name: string;
  description: string;
  is_fav: boolean;
  items: string[];
}

export async function hydrateSocialProfile(
  socialUserId: string,
  library: SocialLibraryInput[],
  activity: SocialActivityInput[],
  monthlyHistory: Record<string, string[]>,
  lists: SocialListInput[],
): Promise<void> {
  return tauriRun('hydrate_social_profile', {
    socialUserId, library, activity, monthlyHistory, lists,
  });
}

export async function getSocialLibrary(socialUserId: string): Promise<SocialLibraryItem[]> {
  return tauriTry<SocialLibraryItem[]>('get_social_library', [], { socialUserId });
}

export async function getSocialActivity(socialUserId: string): Promise<SocialActivityItem[]> {
  return tauriTry<SocialActivityItem[]>('get_social_activity', [], { socialUserId });
}

export async function getSocialMonthlyHistory(socialUserId: string): Promise<SocialMonthGroup[]> {
  return tauriTry<SocialMonthGroup[]>('get_social_monthly_history', [], { socialUserId });
}

export async function getSocialLists(socialUserId: string): Promise<SocialListInfo[]> {
  return tauriTry<SocialListInfo[]>('get_social_lists', [], { socialUserId });
}

export async function getSocialListItems(socialUserId: string, listKey: string): Promise<SocialMediaRef[]> {
  return tauriTry<SocialMediaRef[]>('get_social_list_items', [], { socialUserId, listKey });
}
