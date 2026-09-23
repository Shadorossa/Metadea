mod acl_coverage;
mod actors;
mod auth;
mod backup;
mod characters;
mod companies;
mod staff;
mod comicvine;
mod comic_reader;
mod db;
mod deep_link;
mod emulators;
mod episode_history;
mod favorite_images;
mod folders;
mod game_links;
mod github;
mod http;
mod anilist;
mod igdb;
mod image_storage;
mod igdb_env;
mod igdb_matching;
mod community_sync;
mod media_authors;
mod media_catalog;
mod media_episodes;
mod media_events;
mod media_relations;
mod media_themes;
mod migrations;
mod platform_scanning;
mod player;
mod proposal_bundle;
mod reading_progress;
mod resume_position;
mod sagas;
mod share_image;
mod story_arcs;
mod social_profile;
mod steam;
mod sync_state;
mod tier_lists;
mod user_library;
mod user_lists;
mod user_metadata;
mod utils;
mod discord;
mod vestigial_cleanup;
#[cfg(test)]
mod ipc_size_probe;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let result = tauri::Builder::default()
        // single-instance must be the first plugin: a second launch (e.g. the
        // OS opening a metadea:// link) hands its argv to this process, and
        // its `deep-link` feature replays that URL through the deep-link
        // plugin (src/deep_link.rs) before the closure focuses the window.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| deep_link::focus_main_window(app)))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            let data_dir = match app.path().app_data_dir() {
                Ok(dir) => dir,
                Err(e) => fatal_startup_error(app.handle(), &format!("Could not resolve the app data directory: {e}")),
            };
            std::fs::create_dir_all(&data_dir).ok();
            // A restore that cannot be applied must not brick the app: keep
            // starting on the existing data and forget the marker so it is
            // not retried forever.
            if let Err(e) = backup::apply_pending_restore(&data_dir) {
                eprintln!("Pending restore could not be applied, continuing with the current data: {e}");
                backup::discard_pending_restore(&data_dir);
            }

            let db_path = data_dir.join("metadea.db");
            let metadea_db = match db::MetadeaDb::open(&db_path) {
                Ok(db) => db,
                Err(e) => fatal_startup_error(
                    app.handle(),
                    &format!("Could not open the database at {}:\n\n{e}", db_path.display()),
                ),
            };
            db::seed_fav_lists(&metadea_db);

            // Dev-only: imports catalog/**.json proposal files sitting next to
            // the repo checkout, so a developer's own local db reflects them
            // without waiting for scripts/build-database.js + sync_community_catalog.
            // A real installed build never has a catalog/ folder next to its
            // exe, so this would be a same-cost, always-false directory check
            // on every launch for actual users — gated out of release builds entirely.
            #[cfg(debug_assertions)]
            if let Err(e) = proposal_bundle::sync_local_proposals(&metadea_db) {
                eprintln!("Failed to sync local proposals: {}", e);
            }

            match metadea_db.conn.lock() {
                Ok(conn) => match image_storage::migrate_inline_images(&data_dir, &conn) {
                    Ok(count) if count > 0 => log::info!("Moved {count} inline image(s) to Metadea's image storage"),
                    Ok(_) => {}
                    Err(error) => log::warn!("Could not migrate all inline images; remaining database values were kept: {error}"),
                },
                Err(_) => log::warn!("Could not lock the database to migrate inline images"),
            }

            app.manage(metadea_db);
            app.manage(folders::ScreenshotToastState::default());
            app.manage(player::PlayerEngineState::default());
            let discord = discord::DiscordState::new();
            discord.start_background();
            app.manage(discord);
            deep_link::install(app.handle());

            if let Some(window) = app.get_webview_window("main") {
                if let Some(icon) = app.default_window_icon() {
                    let _ = window.set_icon(icon.clone());
                }
                #[cfg(debug_assertions)]
                window.open_devtools();
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            auth::init_database,
            auth::store_auth_token,
            auth::get_auth_token,
            auth::clear_auth_token,
            platform_scanning::scan_all_games,
            platform_scanning::debug_scan_info,
            folders::pick_folder,
            folders::pick_file,
            folders::pick_backup_file,
            folders::pick_save_file,
            folders::scan_folder_contents,
            folders::rename_path,
            folders::read_routes,
            folders::write_routes,
            folders::open_env_folder,
            game_links::save_game_link,
            game_links::remove_local_game,
            game_links::get_hidden_local_games,
            folders::launch_game,
            folders::start_playtime_session,
            folders::stop_game_process,
            folders::open_external_url,
            folders::play_file_with_vlc,
            folders::screenshot_toast_ready,
            folders::show_episode_watched_toast,
            folders::episode_toast_action,
            folders::get_local_screenshots,
            backup::export_backup,
            backup::prepare_restore,
            folders::get_vlc_playback_status,
            folders::send_vlc_command,
            share_image::fetch_image_data_url,
            share_image::save_image_file,
            igdb_env::read_env_config,
            igdb_env::write_env_config,
            igdb::igdb_search,
            igdb::igdb_search_unfiltered,
            igdb::igdb_upcoming_releases,
            igdb::igdb_get_game_detail,
            igdb::igdb_get_localized_covers,
            igdb::igdb_get_base_games,
            igdb::igdb_get_relation_graph,
            igdb::igdb_get_cover_by_steam_id,
            igdb::igdb_search_candidates,
            igdb::igdb_force_by_igdb_id,
            igdb::read_metadata_index,
            igdb::read_game_info,
            comicvine::comicvine_search,
            comicvine::comicvine_search_characters,
            comicvine::comicvine_get_volume,
            comicvine::comicvine_get_issues,
            comicvine::comicvine_get_issue,
            comicvine::comicvine_get_issues_cast,
            episode_history::save_episode_history_entry,
            episode_history::get_episode_history,
            episode_history::delete_episode_history_entry,
            resume_position::get_resume_position,
            resume_position::save_resume_position,
            resume_position::clear_resume_position,
            reading_progress::get_reading_progress,
            reading_progress::save_reading_progress,
            reading_progress::clear_reading_progress,
            reading_progress::get_comic_bookmarks,
            reading_progress::toggle_comic_bookmark,
            comic_reader::extract_comic_archive,
            comic_reader::read_comic_binary_file,
            comic_reader::save_comic_page_as_png,
            user_library::save_library_entry,
            user_library::get_library_entry,
            user_library::delete_library_entry,
            user_library::get_all_library_entries,
            user_library::clear_all_ratings,
            user_library::read_monthly_history,
            user_library::write_monthly_history,
            user_library::read_user_journey,
            user_library::write_user_journey,
            user_library::read_monthly_history_typed,
            user_library::read_user_journey_typed,
            user_lists::read_user_favorites,
            user_lists::read_user_favorites_typed,
            user_lists::get_list_items_full_light,
            user_lists::write_user_favorites,
            user_lists::get_all_user_lists,
            user_lists::get_list_items,
            user_lists::get_list_items_full,
            user_lists::create_user_list,
            user_lists::update_user_list,
            user_lists::delete_user_list,
            user_lists::add_item_to_list,
            user_lists::remove_item_from_list,
            user_lists::reorder_list_items,
            media_episodes::get_media_episodes,
            media_episodes::get_all_media_episodes_grouped,
            media_episodes::save_media_episodes,
            media_episodes::delete_all_media_episodes,
            media_episodes::delete_media_episode,
            media_events::get_api_sports_event_seasons,
            media_events::save_api_sports_event_seasons,
            media_events::get_api_sports_event_matches,
            media_events::save_api_sports_event_matches,
            media_themes::get_media_themes,
            media_themes::save_media_themes,
            media_themes::save_theme_preview_frame,
            media_themes::get_theme_preview_frame,
            media_themes::cache_theme_video,
            media_themes::get_cached_theme_video,
            media_themes::delete_cached_theme_video,
            media_catalog::save_catalog_entry,
            media_catalog::get_catalog_entry,
            media_catalog::get_catalog_entry_for_editor,
            media_catalog::get_blocked_external_ids,
            media_catalog::get_reclassified_external_ids,
            media_catalog::update_catalog_genres,
            media_catalog::update_catalog_total_count,
            media_catalog::delete_catalog_entry,
            media_catalog::get_all_catalog_entries,
            media_catalog::get_all_catalog_entries_for_editor,
            media_catalog::get_catalog_entries_for_library,
            media_catalog::get_catalog_entries_by_ids,
            media_catalog::search_catalog,
            media_catalog::get_cached_cover,
            media_catalog::get_cached_covers_batch,
            sagas::get_cached_saga,
            sagas::save_cached_saga,
            sagas::remove_saga_member,
            sagas::get_transitive_relation_ids,
            sagas::get_saga_name,
            sagas::get_saga_names,
            sagas::get_all_sagas,
            sagas::get_community_sagas,
            sagas::delete_saga,
            story_arcs::get_story_arcs_for_media,
            story_arcs::get_story_arcs_for_media_batch,
            story_arcs::get_story_arcs_for_media_light,
            story_arcs::get_story_arcs_for_media_batch_light,
            story_arcs::save_story_arc,
            story_arcs::reorder_story_arcs,
            story_arcs::delete_story_arc,
            media_relations::save_media_relations,
            media_relations::replace_issue_relations,
            media_relations::get_media_relations,
            media_relations::get_media_relations_for_editor,
            media_relations::get_base_edition_candidates_for_redirect,
            media_relations::get_deleted_relations,
            media_relations::get_all_media_relations,
            media_relations::get_media_relations_for_ids,
            media_relations::get_anilist_pre_sequel_checked,
            media_relations::mark_anilist_pre_sequel_checked,
            media_authors::save_media_authors,
            media_authors::get_media_authors,
            media_authors::save_author_profile_and_relations,
            media_authors::get_author,
            media_authors::get_author_works,
            community_sync::sync_community_catalog,
            community_sync::get_community_characters,
            vestigial_cleanup::fix_character_ids_command,
            characters::save_character,
            characters::get_character,
            characters::get_all_characters,
            characters::get_all_characters_light,
            characters::search_characters_db,
            characters::delete_character,
            characters::set_character_reaction,
            characters::get_character_merges,
            characters::get_character_merge_target,
            characters::save_character_merges,
            characters::save_character_appearances,
            characters::get_character_appearances,
            characters::save_characters_skeleton,
            characters::get_media_characters,
            characters::get_legacy_tmdb_character_appearances,
            characters::remap_tmdb_character_ids,
            staff::save_staff_skeleton,
            staff::get_media_staff,
            actors::get_character_actors,
            actors::save_character_actors,
            actors::find_actor_by_exact_name,
            companies::get_media_companies,
            companies::save_media_companies,
            favorite_images::save_favorite_custom_image,
            favorite_images::get_all_favorite_custom_images,
            favorite_images::get_favorite_custom_image,
            favorite_images::delete_favorite_custom_image,
            user_metadata::save_user_image,
            user_metadata::get_user_image,
            user_metadata::get_user_image_path,
            user_metadata::remove_user_image,
            user_metadata::save_user_info,
            user_metadata::get_user_info,
            social_profile::hydrate_social_profile,
            social_profile::get_social_library,
            social_profile::get_social_activity,
            social_profile::get_social_monthly_history,
            social_profile::get_social_lists,
            social_profile::get_social_list_items,
            social_profile::get_social_library_light,
            social_profile::get_social_activity_light,
            social_profile::get_social_monthly_history_light,
            social_profile::get_social_list_items_light,
            steam::steam_achievements_download,
            steam::steam_achievement_icon,
            steam::steam_get_owned_games,
            steam::steam_get_player_achievements,
            steam::steam_get_screenshots,
            github::request_github_device_code,
            github::request_github_device_token,
            github::get_github_user_profile,
            github::save_github_token,
            github::get_github_token,
            github::delete_github_token,
            anilist::save_anilist_token,
            anilist::get_anilist_token,
            anilist::delete_anilist_token,
            anilist::get_anilist_user_profile,
            discord::update_presence,
            discord::reset_presence,
            deep_link::get_pending_deep_link,
            tier_lists::create_tier_list,
            tier_lists::get_all_tier_lists,
            tier_lists::get_tier_list,
            tier_lists::delete_tier_list,
            tier_lists::update_tier_list_tiers,
            tier_lists::add_item_to_tier_list,
            tier_lists::remove_item_from_tier_list,
            tier_lists::set_tier_list_placements,
            sync_state::get_sync_state,
            sync_state::get_sync_states,
            sync_state::mark_synced,
            sync_state::mark_sync_failed,
            sync_state::set_sync_state,
            emulators::read_emulators_config,
            emulators::write_emulators_config,
            player::player_engine_available,
            player::player_open,
            player::player_toggle_pause,
            player::player_set_pause,
            player::player_seek,
            player::player_next,
            player::player_prev,
            player::player_play_index,
            player::player_set_track,
            player::player_set_volume,
            player::player_set_mute,
            player::player_set_speed,
            player::player_set_sub_delay,
            player::player_screenshot,
            player::player_get_status,
            player::player_get_session,
            player::player_stop_close,
            player::player_set_video_bounds,
            player::player_set_fullscreen,
            player::player_is_fullscreen,
            player::player_focus_overlay,
        ])
        .run(tauri::generate_context!());
    if let Err(e) = result {
        eprintln!("Metadea could not start: {e}");
        std::process::exit(1);
    }
}

// Startup failures the app cannot recover from (no data dir, unreadable
// database): tell the user in a native dialog instead of a bare panic, then
// exit cleanly. The dialog plugin is registered before `setup` runs, so it
// is available here.
fn fatal_startup_error(app: &tauri::AppHandle, message: &str) -> ! {
    use tauri_plugin_dialog::{DialogExt, MessageDialogKind};
    eprintln!("{message}");
    app.dialog()
        .message(message)
        .title("Metadea could not start")
        .kind(MessageDialogKind::Error)
        .blocking_show();
    std::process::exit(1)
}
