// Prevents additional console window on Windows in release builds
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod db;
mod commands;

use tauri::Manager;
use commands::*;
use db::Database;

fn main() {
  tauri::Builder::default()
    .manage(Database::new())
    .setup(|app| {
      #[cfg(debug_assertions)]
      {
        let window = app.get_webview_window("main");
        if let Some(window) = window {
          let _ = window.open_devtools();
        }
      }
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
      init_database,
      save_library_item,
      get_library_items,
      get_library_stats,
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
