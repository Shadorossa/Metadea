use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tauri::Manager;
use crate::db::ToStringErr;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct EmulatorConfig {
    pub emulator_name: String,
    pub executable_path: String,
    pub launch_args: String,
    pub rom_folder: String,
    pub tracking_mode: String,
}

fn emulators_from_db(db: &crate::db::MetadeaDb) -> Result<HashMap<String, EmulatorConfig>, String> {
    let conn = db.conn.lock().str_err()?;
    let mut stmt = conn
        .prepare(
            "SELECT platform_id, emulator_name, executable_path, launch_args, rom_folder, tracking_mode
             FROM emulator_configs"
        )
        .str_err()?;
    let mut configs = HashMap::new();
    let rows = stmt
        .query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                EmulatorConfig {
                    emulator_name: r.get(1)?,
                    executable_path: r.get(2)?,
                    launch_args: r.get(3)?,
                    rom_folder: r.get(4)?,
                    tracking_mode: r.get(5)?,
                },
            ))
        })
        .str_err()?;

    for row in rows {
        if let Ok((platform_id, config)) = row {
            configs.insert(platform_id, config);
        }
    }
    Ok(configs)
}

#[tauri::command]
pub async fn read_emulators_config(
    app_handle: tauri::AppHandle,
) -> Result<HashMap<String, EmulatorConfig>, String> {
    let db = app_handle.state::<crate::db::MetadeaDb>();
    emulators_from_db(&db)
}

#[tauri::command]
pub async fn write_emulators_config(
    app_handle: tauri::AppHandle,
    configs: HashMap<String, EmulatorConfig>,
) -> Result<String, String> {
    let db = app_handle.state::<crate::db::MetadeaDb>();
    let conn = db.conn.lock().str_err()?;
    let now = chrono::Utc::now().to_rfc3339();

    for (platform_id, config) in configs {
        conn.execute(
            "INSERT INTO emulator_configs (platform_id, emulator_name, executable_path, launch_args, rom_folder, tracking_mode, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
             ON CONFLICT(platform_id) DO UPDATE SET
                emulator_name = excluded.emulator_name,
                executable_path = excluded.executable_path,
                launch_args = excluded.launch_args,
                rom_folder = excluded.rom_folder,
                tracking_mode = excluded.tracking_mode,
                updated_at = excluded.updated_at",
            rusqlite::params![
                platform_id,
                config.emulator_name,
                config.executable_path,
                config.launch_args,
                config.rom_folder,
                config.tracking_mode,
                now
            ],
        )
        .str_err()?;
    }
    Ok("ok".to_string())
}
