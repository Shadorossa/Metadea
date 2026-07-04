// Central registry of localStorage keys shared across settings, profile,
// media and AniList modules — keeps the string literal in one place so a
// typo can't silently create a second, disconnected copy of a preference.

export const STORAGE_KEYS = {
  customColor: 'metadea_custom_color',
  userBio: 'metadea_user_bio',
  ratingSystem: 'metadea_rating_system',
  activityBatchEpisodes: 'metadea_activity_batch_episodes',
  anilistToken: 'metadea_anilist_token',
  showAdultContent: 'metadea_show_adult_content',
} as const;
