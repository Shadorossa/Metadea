// Native file/folder pickers and "open this in the OS" helpers.

use crate::db::ToStringErr;

#[tauri::command]
pub async fn pick_folder(app_handle: tauri::AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let folder = app_handle.dialog().file().blocking_pick_folder();
    Ok(folder.map(|p| p.to_string()))
}

// "Localizar → elegir un archivo suelto" (LocalMediaDetailPanel) — for a
// folder that holds several distinct catalog entries at once (e.g. a movie
// collection with one file per film), where picking the whole *folder*
// would wrongly rename every sibling as if they were episodes of the same
// work.
#[tauri::command]
pub async fn pick_file(app_handle: tauri::AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let file = app_handle.dialog().file().blocking_pick_file();
    Ok(file.map(|p| p.to_string()))
}

#[tauri::command]
pub async fn pick_backup_file(app_handle: tauri::AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let file = app_handle
        .dialog()
        .file()
        .add_filter("Metadea backup", &["zip"])
        .blocking_pick_file();
    Ok(file.map(|p| p.to_string()))
}

#[tauri::command]
pub async fn pick_save_file(app_handle: tauri::AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let file = app_handle
        .dialog()
        .file()
        .add_filter("ZIP backup", &["zip"])
        .set_file_name("metadea-backup.zip")
        .blocking_save_file();
    Ok(file.map(|p| p.to_string()))
}

#[tauri::command]
pub async fn open_env_folder(app_handle: tauri::AppHandle) -> Result<(), String> {
    use tauri::Manager;
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .str_err()?;
    std::fs::create_dir_all(&app_data_dir).str_err()?;
    let path_str = app_data_dir.to_string_lossy().to_string();
    #[cfg(target_os = "windows")]
    {
        use std::process::Command;
        Command::new("explorer")
            .arg(&path_str)
            .spawn()
            .str_err()?;
    }
    #[cfg(target_os = "macos")]
    {
        use std::process::Command;
        Command::new("open")
            .arg(&path_str)
            .spawn()
            .str_err()?;
    }
    #[cfg(target_os = "linux")]
    {
        use std::process::Command;
        Command::new("xdg-open")
            .arg(&path_str)
            .spawn()
            .str_err()?;
    }
    Ok(())
}

// Opens any URL (custom scheme like "steam://" included) via the OS's own
// handler — same opener plugin launch_game already uses below, needed
// separately since a plain <a target="_blank">/window.open from the
// frontend doesn't reliably hand a non-http(s) scheme off to the OS from
// inside the webview.
#[tauri::command]
pub async fn open_external_url(app_handle: tauri::AppHandle, url: String) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    app_handle.opener().open_url(url, None::<String>).str_err()
}
