#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod db;
mod commands;

use commands::*;
use db::Database;

fn main() {
  tauri::Builder::default()
    .manage(Database::new())
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
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
