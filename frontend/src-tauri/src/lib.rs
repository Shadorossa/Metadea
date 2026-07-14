mod auth;
mod characters;
mod db;
mod favorite_images;
mod folders;
mod github;
mod anilist;
mod igdb;
mod media_catalog;
mod platform_scanning;
mod steam;
mod tier_lists;
mod user_library;
mod user_lists;
mod user_metadata;
mod utils;
mod discord;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let data_dir = app.path().app_data_dir().expect("no app data dir");
            std::fs::create_dir_all(&data_dir).ok();

            let metadea_db = db::MetadeaDb::open(&data_dir.join("metadea.db"))
                .expect("failed to open metadea.db");
            db::seed_fav_lists(&metadea_db);

            // Dev-only: imports database/*.json proposal files sitting next to
            // the repo checkout, so a developer's own local db reflects them
            // without waiting for scripts/build-database.js + sync_community_catalog.
            // A real installed build never has a database/ folder next to its
            // exe, so this would be a same-cost, always-false directory check
            // on every launch for actual users — gated out of release builds entirely.
            #[cfg(debug_assertions)]
            if let Err(e) = media_catalog::sync_local_proposals(&metadea_db) {
                eprintln!("Failed to sync local proposals: {}", e);
            }

            app.manage(metadea_db);
            let discord = discord::DiscordState::new();
            discord.start_background();
            app.manage(discord);

            #[cfg(debug_assertions)]
            {
                if let Some(window) = app.get_webview_window("main") {
                    window.open_devtools();
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            auth::init_database,
            auth::store_auth_token,
            auth::get_auth_token,
            auth::clear_auth_token,
            auth::save_library_item,
            auth::get_library_items,
            auth::get_library_stats,
            platform_scanning::scan_all_games,
            platform_scanning::debug_scan_info,
            folders::pick_folder,
            folders::scan_folder_contents,
            folders::get_local_folders,
            folders::save_local_folders,
            folders::read_routes,
            folders::write_routes,
            folders::open_env_folder,
            folders::save_game_link,
            folders::delete_game_link,
            folders::launch_game,
            folders::open_local_file,
            folders::scan_anime_folder,
            folders::play_file_with_vlc,
            folders::get_vlc_playback_status,
            folders::save_anime_folder,
            folders::get_anime_folder,
            igdb::read_env_config,
            igdb::write_env_config,
            igdb::igdb_search,
            igdb::igdb_upcoming_releases,
            igdb::igdb_get_game_detail,
            igdb::igdb_get_base_games,
            igdb::igdb_get_relation_graph,
            igdb::igdb_get_cover_by_steam_id,
            igdb::igdb_search_candidates,
            igdb::igdb_force_by_igdb_id,
            igdb::read_metadata_index,
            igdb::read_game_info,
            user_library::save_library_entry,
            user_library::get_library_entry,
            user_library::delete_library_entry,
            user_library::get_all_library_entries,
            user_library::read_monthly_history,
            user_library::write_monthly_history,
            user_library::read_user_journey,
            user_library::write_user_journey,
            user_lists::read_user_favorites,
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
            media_catalog::save_catalog_entry,
            media_catalog::get_catalog_entry,
            media_catalog::delete_catalog_entry,
            media_catalog::get_all_catalog_entries,
            media_catalog::search_catalog,
            media_catalog::get_cached_saga,
            media_catalog::save_cached_saga,
            media_catalog::get_transitive_relation_ids,
            media_catalog::get_saga_name,
            media_catalog::save_media_saga_groups,
            media_catalog::get_media_saga_groups,
            media_catalog::save_media_relations,
            media_catalog::get_media_relations,
            media_catalog::get_all_media_relations,
            media_catalog::save_media_authors,
            media_catalog::get_media_authors,
            media_catalog::save_author_profile_and_relations,
            media_catalog::sync_community_catalog,
            characters::save_character,
            characters::get_character,
            characters::get_all_characters,
            characters::set_character_reaction,
            characters::save_character_appearances,
            characters::get_character_appearances,
            characters::save_characters_skeleton,
            characters::get_media_characters,
            favorite_images::save_favorite_custom_image,
            favorite_images::get_favorite_custom_image,
            favorite_images::get_all_favorite_custom_images,
            favorite_images::delete_favorite_custom_image,
            user_metadata::save_user_image,
            user_metadata::get_user_image,
            user_metadata::remove_user_image,
            user_metadata::save_user_info,
            user_metadata::get_user_info,
            steam::steam_achievements_download,
            steam::steam_achievement_icon,
            steam::steam_get_owned_games,
            steam::steam_get_player_achievements,
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
            tier_lists::create_tier_list,
            tier_lists::get_all_tier_lists,
            tier_lists::get_tier_list,
            tier_lists::delete_tier_list,
            tier_lists::update_tier_list_tiers,
            tier_lists::add_item_to_tier_list,
            tier_lists::remove_item_from_tier_list,
            tier_lists::set_tier_list_placements,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
