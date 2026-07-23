// Companies (developer/publisher/studio/production) tied to a media entry —
// mirrors media_authors.rs's shape/commands, with an explicit `role` on the
// relation since the same company can legitimately hold more than one role
// for the same media (e.g. a self-published game) — see media_by_company's
// own doc comment in db.rs.
use chrono::Utc;
use serde::{Deserialize, Serialize};
use crate::db::ToStringErr;

#[derive(Debug, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct DbMediaCompany {
    pub external_id: String,
    pub name: String,
    pub logo_url: Option<String>,
    /// 'developer' | 'publisher' — see MediaCompany's own doc comment
    /// (frontend/src/lib/media/types.ts) for the full per-provider mapping.
    pub role: String,
}

#[tauri::command]
pub async fn get_media_companies(
    state: tauri::State<'_, crate::db::MetadeaDb>,
    media_external_id: String,
) -> Result<Vec<DbMediaCompany>, String> {
    let conn = state.conn.lock().str_err()?;
    let mut stmt = conn
        .prepare(
            "SELECT c.external_id, c.name, c.logo_url, mc.role
             FROM media_by_company mc
             JOIN companies c ON c.external_id = mc.company_external_id
             WHERE mc.media_external_id = ?1",
        )
        .str_err()?;
    let rows = stmt
        .query_map([&media_external_id], |row| {
            Ok(DbMediaCompany {
                external_id: row.get(0)?,
                name: row.get(1)?,
                logo_url: row.get(2)?,
                role: row.get(3)?,
            })
        })
        .str_err()?
        .filter_map(|r| r.ok())
        .collect();
    Ok(rows)
}

// Full curated list, so anything missing was deliberately removed — same
// replace-in-place shape as save_media_authors/save_staff_skeleton.
#[tauri::command]
pub async fn save_media_companies(
    state: tauri::State<'_, crate::db::MetadeaDb>,
    media_external_id: String,
    companies: Vec<DbMediaCompany>,
) -> Result<(), String> {
    let mut conn = state.conn.lock().str_err()?;
    let tx = conn.transaction().str_err()?;
    let now = Utc::now().to_rfc3339();

    tx.execute(
        "DELETE FROM media_by_company WHERE media_external_id = ?1",
        [&media_external_id],
    ).str_err()?;

    for company in companies {
        if company.external_id.is_empty() { continue; }

        tx.execute(
            "INSERT INTO companies (external_id, name, logo_url, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?4)
             ON CONFLICT(external_id) DO UPDATE SET
                name = excluded.name, logo_url = excluded.logo_url, updated_at = excluded.updated_at",
            rusqlite::params![&company.external_id, &company.name, &company.logo_url, &now],
        ).str_err()?;

        tx.execute(
            "INSERT OR REPLACE INTO media_by_company (company_external_id, media_external_id, role, added_at)
             VALUES (?1, ?2, ?3, ?4)",
            rusqlite::params![&company.external_id, &media_external_id, &company.role, &now],
        ).str_err()?;
    }

    tx.commit().str_err()?;
    Ok(())
}
