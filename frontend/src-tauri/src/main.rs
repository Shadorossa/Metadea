#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod db;
mod commands;
mod igdb;

use commands::*;
use db::Database;
use igdb::IgdbTokenCache;

fn main() {
  tauri::Builder::default()
    .manage(Database::new())
    .manage(IgdbTokenCache::default())
    .setup(|app| {
      #[cfg(debug_assertions)]
      {
        use tauri::Manager;
        if let Some(window) = app.get_webview_window("main") {
          let _ = window.open_devtools();
        }
      }
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
      init_database,
      store_auth_token,
      get_auth_token,
      clear_auth_token,
      save_library_item,
      get_library_items,
      get_library_stats,
      scan_all_games,
      pick_folder,
      scan_folder_contents,
      get_local_folders,
      save_local_folders,
      read_env_config,
      write_env_config,
      igdb_search,
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
