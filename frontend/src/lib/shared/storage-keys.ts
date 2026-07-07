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
  authToken: 'auth_token',
  authUsername: 'auth_username',
  appTheme: 'app_theme',
  userFavorite: 'user_favorite',
  localFolders: 'local_folders',
  envConfig: 'env_config',
  categoryRoutes: 'category_routes',
  monthlyHistory: 'monthly_history',
  userJourney: 'user_journey',
  profileAvatarCustom: 'profile_avatar_custom',
  profileBannerCustom: 'profile_banner_custom',
  communityCatalogLastSync: 'community_catalog_last_sync',
} as const;
