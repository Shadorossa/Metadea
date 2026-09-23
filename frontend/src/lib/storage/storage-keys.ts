// Central registry of localStorage keys shared across settings, profile,
// media and AniList modules — keeps the string literal in one place so a
// typo can't silently create a second, disconnected copy of a preference.

export const STORAGE_KEYS = {
  customColor: 'metadea_custom_color',
  userBio: 'metadea_user_bio',
  ratingSystem: 'metadea_rating_system',
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
  shareAvatarCustom: 'share_avatar_custom',
  communityCatalogLastSync: 'community_catalog_last_sync',
  communityCatalogSyncedThisSession: 'metadea_community_catalog_synced_this_session',
  lastVisitedPath: 'metadea_last_visited_path',
  onboardingCompleted: 'metadea_onboarding_completed',
  onboardingStep: 'metadea_onboarding_step',
  homeCalendarGeneralCache: 'metadea_home_calendar_general_cache',
  libraryGroupByBundle: 'metadea_library_group_by_bundle',
  searchState: 'metadea_search_state',
  updaterCheckedThisSession: 'metadea_updater_checked_this_session',
  // Last app version whose "What's new" modal was acknowledged
  // (components/changelog/ChangelogLauncher.tsx).
  lastSeenChangelogVersion: 'metadea_last_seen_changelog_version',
  locale: 'metadea_locale',
  // Set once by the <head> locale bootstrap (lib/i18n-dom/locale-bootstrap.ts):
  // pre-0.7 installs without a chosen language keep Spanish, the old default.
  localeMigrated: 'metadea_locale_migrated',
  profileSyncLastSync: 'metadea_profile_sync_last_sync',
  profileSyncLastAttempt: 'metadea_profile_sync_last_attempt',
  activityFeedLastFetch: 'metadea_activity_feed_last_fetch',
  activityFeedCache: 'metadea_activity_feed_cache',
  generalActivityFeedLastFetch: 'metadea_general_activity_feed_last_fetch',
  generalActivityFeedCache: 'metadea_general_activity_feed_cache',
  pendingLibraryType: 'metadea_pending_library_type',
  dualRatingEnabled: 'metadea_dual_rating_enabled',
  // Settings > Perfil > "Public web profile" (opt-in; lib/storage/preferences.ts).
  webProfilePublic: 'metadea_web_profile_public',
  ratingName1: 'metadea_rating_name_1',
  ratingName2: 'metadea_rating_name_2',
  rating2System: 'metadea_rating_2_system',
  rating2Min: 'metadea_rating_2_min',
  rating2Max: 'metadea_rating_2_max',
  libraryActiveRatingSlot: 'metadea_library_active_rating_slot',
  emulatorsConfig: 'emulators_config',
  romAutoRename: 'metadea_local_roms_auto_rename',
  unifySeasonsEnabled: 'metadea_unify_seasons_enabled',
  unifySeasonsHighestRatedCover: 'metadea_unify_seasons_highest_rated_cover',
  completedMangaIssueCover: 'metadea_completed_manga_issue_cover',
  // Settings > Preferences > Library: show textless covers where one exists
  // (lib/media/textless-covers.ts). Display-only.
  preferTextlessCovers: 'metadea_prefer_textless_covers',
  // Which works that setting applies to: 'all' | 'screen' (films + series) |
  // 'games' (games + visual novels). Missing = 'all'.
  textlessCoverScope: 'metadea_textless_cover_scope',
  mediaCoverPreferences: 'metadea_media_cover_preferences',
  libraryReleaseNotifications: 'metadea_library_release_notifications',
  jukeboxPreferences: 'metadea_jukebox_preferences',
  // "Watch for changes" dev toggle of the user UI themes (lib/ui-themes).
  uiThemeWatch: 'metadea_ui_theme_watch',
  // Local > Videojuegos: IGDB's launcher verdict per pending game, 7-day TTL
  // (lib/local/pending-launcher-memo.ts).
  pendingLauncherMemo: 'metadea_local_pending_launcher_memo',
  // Home's last rendered view-model, for an instant first paint
  // (lib/home/home-snapshot.ts), and the tiny layout hint derived from it
  // that home.astro's inline pre-paint script reads (it mirrors this
  // literal — see home-snapshot.test.ts).
  homeSnapshot: 'metadea_home_snapshot',
  homeLayoutHint: 'metadea_home_layout',
  // Big Picture mode: start-with-the-app and navigation-sound toggles
  // (lib/big-picture/big-picture-preferences.ts).
  bigPicturePreferences: 'metadea_big_picture_preferences',
  // Multi-disc games: the disc last picked to boot, per app_id
  // (lib/local/disc-choice.ts).
  romDiscChoice: 'metadea_rom_disc_choice',
  // Ambient TV mode (screensaver while idle in fullscreen / Big Picture):
  // on/off, idle delay in minutes and "play the Jukebox" (lib/storage/preferences.ts,
  // lib/ambient/). Missing = on / 2 min / on.
  ambientMode: 'metadea_ambient_mode',
  ambientIdleMinutes: 'metadea_ambient_idle_minutes',
  ambientJukebox: 'metadea_ambient_jukebox',
  // Grid | Timeline on the company and author pages, one per page type
  // (lib/storage/creator-works-view.ts appends `:company` / `:author`).
  creatorWorksView: 'metadea_creator_works_view',
  // Readers' E-Ink / paper mode (on/off, warmth, paper brightness, refresh
  // flash), one blob per reader type (lib/storage/reader-eink.ts appends
  // `:comic` / `:epub`).
  readerEink: 'metadea_reader_eink',
  // Spoiler shield (lib/spoilers/): the Settings > Preferences toggles
  // (missing = on / normal / covers off), the franchises the user revealed
  // for good (member ids, localStorage) and the single items revealed for
  // this session only (sessionStorage).
  spoilerShieldEnabled: 'metadea_spoiler_shield_enabled',
  spoilerShieldLevel: 'metadea_spoiler_shield_level',
  spoilerShieldHideCovers: 'metadea_spoiler_shield_hide_covers',
  spoilerFranchiseReveals: 'metadea_spoiler_franchise_reveals',
  spoilerSessionReveals: 'metadea_spoiler_session_reveals',
  // Built-in player (lib/player/player-settings.ts): seek-bar hover thumbnails
  // on/off, the smart track selection preferences (one JSON blob) and the
  // per-series manual track choices (lib/player/track-memory.ts).
  playerSeekThumbnails: 'metadea_player_seek_thumbnails',
  playerTrackPreferences: 'metadea_player_track_preferences',
  playerTrackMemory: 'metadea_player_track_memory',
  // Clip chooser's last answer, the next export's default (lib/player/clip-choice.ts).
  playerClipLastChoice: 'metadea_player_clip_last_choice',
  // Interface scale (lib/ui-scale/): the Settings › Preferences choice
  // ('auto' when missing), the zoom applied to the main window (the player
  // overlay copies it) and, in sessionStorage, the zoom of this webview.
  uiScale: 'metadea_ui_scale',
  uiScaleMainZoom: 'metadea_ui_scale_main_zoom',
  uiScaleWebviewZoom: 'metadea_ui_scale_webview_zoom',
} as const;
