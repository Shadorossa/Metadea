mod auth;
mod folders;
mod igdb;
mod platform_scanning;
mod steam;
mod user_metadata;
mod utils;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_log::Builder::new().build())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
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
            igdb::read_env_config,
            igdb::write_env_config,
            igdb::igdb_search,
            igdb::igdb_get_game_detail,
            igdb::igdb_get_cover_by_steam_id,
            igdb::read_metadata_index,
            igdb::read_game_info,
            igdb::file_to_data_url,
            user_metadata::save_user_image,
            user_metadata::get_user_image,
            user_metadata::remove_user_image,
            user_metadata::save_user_info,
            user_metadata::get_user_info,
            steam::steam_achievements_download,
            steam::steam_achievement_icon,
            steam::steam_get_owned_games,
            steam::steam_get_player_achievements,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
