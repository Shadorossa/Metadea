// The automatic ROM file clean-up behind Local's "N files renamed · Undo"
// toast. The frontend computes the plan (lib/local/rom-rename-plan.ts) from
// the typed scan; this side is the last line of defense (never inside the
// emulator's directory, never onto an existing file, never a different
// extension, only inside a configured ROM folder), performs the renames,
// journals them (rom_rename_journal) so they can be reverted, and moves
// every database row and metadata folder keyed by the ROM's path-derived
// app_id along with the file — a rename must never lose a link or a cover.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tauri::Manager;

use crate::db::ToStringErr;
use crate::platform_scanning::rom_library::{emulator_dir, is_within, rom_folder_configs, RomFolderConfig};
use crate::platform_scanning::synthetic_app_id;

#[derive(Debug, Clone, Deserialize)]
pub struct RomRenameItem {
    pub old_path: String,
    pub new_path: String,
}

#[derive(Debug, Default, Serialize)]
pub struct RomRenameOutcome {
    pub journal_ids: Vec<i64>,
    pub renamed: usize,
    pub skipped: usize,
}

pub struct RenameGuard {
    roots: Vec<PathBuf>,
    emulator_dirs: Vec<PathBuf>,
}

impl RenameGuard {
    pub fn from_configs(configs: &[RomFolderConfig]) -> Self {
        Self {
            roots: configs.iter().map(|c| PathBuf::from(&c.rom_folder)).collect(),
            emulator_dirs: configs.iter().filter_map(emulator_dir).collect(),
        }
    }

    fn allows(&self, old: &Path, new: &Path) -> bool {
        let same_dir = old.parent().is_some() && old.parent() == new.parent();
        let same_ext = old.extension().map(|e| e.to_ascii_lowercase()) == new.extension().map(|e| e.to_ascii_lowercase());
        let new_name_ok = new
            .file_name()
            .and_then(|n| n.to_str())
            .is_some_and(|n| !n.trim().is_empty() && !n.contains(['/', '\\']));
        same_dir
            && same_ext
            && new_name_ok
            && old.is_file()
            && !new.exists()
            && self.roots.iter().any(|root| is_within(old, root))
            && !self.emulator_dirs.iter().any(|dir| is_within(old, dir))
    }
}

// The on-disk cover/banner cache (igdb/cache.rs) is a folder per app_id
// plus an index.json keyed by it — both follow the id.
pub(crate) fn move_metadata_entry(meta_root: &Path, old_id: &str, new_id: &str) {
    let old_dir = meta_root.join(old_id);
    let new_dir = meta_root.join(new_id);
    if old_dir.is_dir() && !new_dir.exists() {
        let _ = std::fs::rename(&old_dir, &new_dir);
    }
    let index_path = meta_root.join("index.json");
    let Some(mut index) = std::fs::read_to_string(&index_path).ok().and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok()) else { return };
    let Some(obj) = index.as_object_mut() else { return };
    let Some(mut entry) = obj.remove(old_id) else { return };
    let old_prefix = old_dir.to_string_lossy().to_string();
    let new_prefix = new_dir.to_string_lossy().to_string();
    for field in ["cover", "banner"] {
        if let Some(p) = entry[field].as_str().map(|p| p.replacen(&old_prefix, &new_prefix, 1)) {
            entry[field] = serde_json::Value::String(p);
        }
    }
    obj.insert(new_id.to_string(), entry);
    let _ = std::fs::write(&index_path, serde_json::to_string_pretty(&index).unwrap_or_default());
}

fn move_rom_identity(conn: &rusqlite::Connection, meta_root: Option<&Path>, old_path: &str, new_path: &str) -> rusqlite::Result<()> {
    let old_id = synthetic_app_id("rom", old_path);
    let new_id = synthetic_app_id("rom", new_path);
    crate::game_links::move_game_link_key(conn, &old_id, &new_id)?;
    if let Some(root) = meta_root {
        move_metadata_entry(root, &old_id, &new_id);
    }
    Ok(())
}

pub fn apply_renames(
    conn: &mut rusqlite::Connection,
    meta_root: Option<&Path>,
    guard: &RenameGuard,
    items: &[RomRenameItem],
) -> Result<RomRenameOutcome, String> {
    let mut outcome = RomRenameOutcome::default();
    let mut done: Vec<&RomRenameItem> = Vec::new();
    for item in items {
        let old = Path::new(&item.old_path);
        let new = Path::new(&item.new_path);
        if !guard.allows(old, new) || std::fs::rename(old, new).is_err() {
            outcome.skipped += 1;
            continue;
        }
        done.push(item);
    }
    let now = chrono::Utc::now().to_rfc3339();
    let tx = conn.transaction().str_err()?;
    for item in &done {
        tx.execute(
            "INSERT INTO rom_rename_journal (old_path, new_path, scanned_at) VALUES (?1, ?2, ?3)",
            rusqlite::params![item.old_path, item.new_path, now],
        )
        .str_err()?;
        outcome.journal_ids.push(tx.last_insert_rowid());
        move_rom_identity(&tx, meta_root, &item.old_path, &item.new_path).str_err()?;
    }
    tx.commit().str_err()?;
    outcome.renamed = done.len();
    Ok(outcome)
}

pub fn revert_renames(conn: &mut rusqlite::Connection, meta_root: Option<&Path>, journal_ids: &[i64]) -> Result<usize, String> {
    let mut undone = 0;
    let now = chrono::Utc::now().to_rfc3339();
    let tx = conn.transaction().str_err()?;
    for id in journal_ids {
        let row: Option<(String, String)> = tx
            .query_row(
                "SELECT old_path, new_path FROM rom_rename_journal WHERE id = ?1 AND undone_at IS NULL",
                [id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .ok();
        let Some((old_path, new_path)) = row else { continue };
        let old = Path::new(&old_path);
        let new = Path::new(&new_path);
        if !new.is_file() || old.exists() || std::fs::rename(new, old).is_err() {
            continue;
        }
        tx.execute("UPDATE rom_rename_journal SET undone_at = ?2 WHERE id = ?1", rusqlite::params![id, now]).str_err()?;
        move_rom_identity(&tx, meta_root, &new_path, &old_path).str_err()?;
        undone += 1;
    }
    tx.commit().str_err()?;
    Ok(undone)
}

fn metadata_root(app_handle: &tauri::AppHandle) -> Option<PathBuf> {
    app_handle.path().app_data_dir().ok().map(|d| d.join("metadata"))
}

#[tauri::command]
pub async fn rename_rom_files(
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, crate::db::MetadeaDb>,
    items: Vec<RomRenameItem>,
) -> Result<RomRenameOutcome, String> {
    let meta_root = metadata_root(&app_handle);
    let mut conn = state.conn.lock().str_err()?;
    let guard = RenameGuard::from_configs(&rom_folder_configs(&conn));
    apply_renames(&mut conn, meta_root.as_deref(), &guard, &items)
}

#[tauri::command]
pub async fn undo_rom_renames(
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, crate::db::MetadeaDb>,
    journal_ids: Vec<i64>,
) -> Result<usize, String> {
    let meta_root = metadata_root(&app_handle);
    let mut conn = state.conn.lock().str_err()?;
    revert_renames(&mut conn, meta_root.as_deref(), &journal_ids)
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Fixture {
        root: PathBuf,
        db: crate::db::MetadeaDb,
        guard: RenameGuard,
    }

    fn fixture(name: &str) -> Fixture {
        let root = std::env::temp_dir().join(format!("metadea-rom-rename-{}-{}", std::process::id(), name));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join("MelonDs")).unwrap();
        std::fs::write(root.join("MelonDs").join("melonDS.exe"), b"").unwrap();
        let cfg = RomFolderConfig {
            platform_id: "ds".into(),
            rom_folder: root.to_string_lossy().to_string(),
            executable_path: root.join("MelonDs").join("melonDS.exe").to_string_lossy().to_string(),
            rom_extensions: vec!["nds".into()],
        };
        Fixture { guard: RenameGuard::from_configs(&[cfg]), root, db: crate::db::MetadeaDb::open_in_memory().unwrap() }
    }

    fn item(root: &Path, old: &str, new: &str) -> RomRenameItem {
        RomRenameItem { old_path: root.join(old).to_string_lossy().to_string(), new_path: root.join(new).to_string_lossy().to_string() }
    }

    #[test]
    fn renames_journal_and_move_the_link_key_then_undo_restores_everything() {
        let f = fixture("roundtrip");
        std::fs::write(f.root.join("5288 - Layton.nds"), b"rom").unwrap();
        std::fs::write(f.root.join("5288 - Layton.sav"), b"save").unwrap();
        let old_key = synthetic_app_id("rom", &f.root.join("5288 - Layton.nds").to_string_lossy());
        let new_key = synthetic_app_id("rom", &f.root.join("Layton.nds").to_string_lossy());
        let mut conn = f.db.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO local_game_links (launcher, link_key, external_id, manual) VALUES ('nintendo', ?1, 'game:1', 1)",
            [&old_key],
        )
        .unwrap();

        let plan = [item(&f.root, "5288 - Layton.nds", "Layton.nds"), item(&f.root, "5288 - Layton.sav", "Layton.sav")];
        let outcome = apply_renames(&mut conn, None, &f.guard, &plan).unwrap();
        assert_eq!((outcome.renamed, outcome.skipped, outcome.journal_ids.len()), (2, 0, 2));
        assert!(f.root.join("Layton.nds").is_file() && f.root.join("Layton.sav").is_file());
        let linked: String = conn
            .query_row("SELECT link_key FROM local_game_links WHERE external_id = 'game:1'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(linked, new_key);

        let undone = revert_renames(&mut conn, None, &outcome.journal_ids).unwrap();
        assert_eq!(undone, 2);
        assert!(f.root.join("5288 - Layton.nds").is_file() && f.root.join("5288 - Layton.sav").is_file());
        let linked: String = conn
            .query_row("SELECT link_key FROM local_game_links WHERE external_id = 'game:1'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(linked, old_key);
        // A second undo of the same rows is a no-op.
        assert_eq!(revert_renames(&mut conn, None, &outcome.journal_ids).unwrap(), 0);
        drop(conn);
        let _ = std::fs::remove_dir_all(&f.root);
    }

    #[test]
    fn refuses_existing_targets_extension_changes_emulator_dir_and_outside_paths() {
        let f = fixture("guard");
        std::fs::write(f.root.join("a.nds"), b"").unwrap();
        std::fs::write(f.root.join("b.nds"), b"").unwrap();
        std::fs::write(f.root.join("MelonDs").join("c.nds"), b"").unwrap();
        let outside = std::env::temp_dir().join(format!("metadea-rom-rename-outside-{}.nds", std::process::id()));
        std::fs::write(&outside, b"").unwrap();
        let other_dir = f.root.join("sub");
        std::fs::create_dir_all(&other_dir).unwrap();
        let plan = [
            item(&f.root, "a.nds", "b.nds"),
            item(&f.root, "a.nds", "a.iso"),
            item(&f.root, "MelonDs/c.nds", "MelonDs/d.nds"),
            RomRenameItem { old_path: outside.to_string_lossy().to_string(), new_path: outside.with_file_name("x.nds").to_string_lossy().to_string() },
            item(&f.root, "a.nds", "sub/a.nds"),
            item(&f.root, "missing.nds", "there.nds"),
        ];
        let mut conn = f.db.conn.lock().unwrap();
        let outcome = apply_renames(&mut conn, None, &f.guard, &plan).unwrap();
        assert_eq!((outcome.renamed, outcome.skipped), (0, 6));
        assert!(f.root.join("a.nds").is_file() && f.root.join("MelonDs").join("c.nds").is_file() && outside.is_file());
        drop(conn);
        let _ = std::fs::remove_file(&outside);
        let _ = std::fs::remove_dir_all(&f.root);
    }

    #[test]
    fn metadata_folder_and_index_follow_the_renamed_rom() {
        let f = fixture("metadata");
        let meta_root = f.root.join("metadata");
        std::fs::write(f.root.join("Old.nds"), b"").unwrap();
        let old_id = synthetic_app_id("rom", &f.root.join("Old.nds").to_string_lossy());
        let new_id = synthetic_app_id("rom", &f.root.join("New.nds").to_string_lossy());
        std::fs::create_dir_all(meta_root.join(&old_id)).unwrap();
        let cover = meta_root.join(&old_id).join("c_cover.webp");
        std::fs::write(&cover, b"").unwrap();
        std::fs::write(
            meta_root.join("index.json"),
            serde_json::json!({ old_id.clone(): { "name": "Old", "cover": cover.to_string_lossy() } }).to_string(),
        )
        .unwrap();
        let mut conn = f.db.conn.lock().unwrap();
        apply_renames(&mut conn, Some(&meta_root), &f.guard, &[item(&f.root, "Old.nds", "New.nds")]).unwrap();
        assert!(meta_root.join(&new_id).join("c_cover.webp").is_file());
        let index: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(meta_root.join("index.json")).unwrap()).unwrap();
        assert!(index[&old_id].is_null());
        assert!(index[&new_id]["cover"].as_str().unwrap().contains(&new_id));
        drop(conn);
        let _ = std::fs::remove_dir_all(&f.root);
    }
}
