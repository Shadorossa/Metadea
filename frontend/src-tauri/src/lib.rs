mod auth;
mod db;
mod folders;
mod github;
mod anilist;
mod igdb;
mod media_catalog;
mod platform_scanning;
mod steam;
mod user_library;
mod user_lists;
mod user_metadata;
mod utils;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_log::Builder::new().build())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let data_dir = app.path().app_data_dir().expect("no app data dir");
            std::fs::create_dir_all(&data_dir).ok();

            let library_db = db::LibraryDb::open(&data_dir.join("user_library.db"))
                .expect("failed to open user_library.db");
            db::migrate_library_from_json(&library_db, &data_dir);
            app.manage(library_db);

            let catalog_db = db::CatalogDb::open(&data_dir.join("media_catalog.db"))
                .expect("failed to open media_catalog.db");
            db::migrate_catalog_from_json(&catalog_db, &data_dir);
            app.manage(catalog_db);

            let session_db = db::SessionDb::open(&data_dir.join("user_session.db"))
                .expect("failed to open user_session.db");
            db::migrate_sessions_from_json(&session_db, &data_dir);
            app.manage(session_db);

            let env_db = db::EnvDb::open(&data_dir.join("env.db"))
                .expect("failed to open env.db");
            db::migrate_env_from_json(&env_db, &data_dir);
            app.manage(env_db);

            let profile_db = db::ProfileDb::open(&data_dir.join("user_profile.db"))
                .expect("failed to open user_profile.db");
            db::migrate_profile_from_json(&profile_db, &data_dir);
            app.manage(profile_db);

            let local_db = db::LocalDataDb::open(&data_dir.join("local_data.db"))
                .expect("failed to open local_data.db");
            db::migrate_local_data_from_json(&local_db, &data_dir);
            app.manage(local_db);

            #[cfg(debug_assertions)]
            {
                let window = app.get_webview_window("main").unwrap();
                window.open_devtools();
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
            igdb::read_env_config,
            igdb::write_env_config,
            igdb::igdb_search,
            igdb::igdb_get_game_detail,
            igdb::igdb_get_cover_by_steam_id,
            igdb::igdb_search_candidates,
            igdb::igdb_force_by_igdb_id,
            igdb::read_metadata_index,
            igdb::read_game_info,
            igdb::file_to_data_url,
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
