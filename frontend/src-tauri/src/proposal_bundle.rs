// The collaborative-catalog PR bundle format and its import path (both the
// dev-time "read every catalog/**.json on disk" sync and the shared
// per-section upsert helpers) — split out of media_catalog.rs.
use chrono::Utc;
use serde::{Deserialize, Serialize};
use crate::db::ToStringErr;
use crate::media_catalog::{MediaCatalogEntry, existing_catalog_ids, reciprocal_relation, infer_type_from_id, infer_source_from_id};
use crate::media_relations::DbMediaRelation;
use crate::media_authors::DbMediaAuthor;

#[derive(Debug, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct ProposalBundle {
    pub media_catalog: MediaCatalogEntry,
    // DbMediaRelation already carries an optional media_external_id (see its
    // definition above) — no need for a near-identical ProposalRelation
    // struct that only differed by that one field.
    pub media_relations: Vec<DbMediaRelation>,
    pub characters: Vec<crate::characters::SkeletonCharacter>,
    pub media_authors: Vec<DbMediaAuthor>,
    pub saga_name: Option<String>,
}

// A character has no owning media_catalog row — mirrors
// CharacterProposalBundle in submitCollaborativeProposal.ts.
#[derive(Debug, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct CharacterProposalField {
    pub external_id: String,
    pub name: String,
    pub name_native: Option<String>,
    pub aliases_csv: Option<String>,
    pub biography: Option<String>,
    pub image_url: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct CharacterProposalAppearance {
    pub media_external_id: String,
    pub relation_type: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct CharacterProposalActor {
    pub external_id: String,
    pub name: String,
    pub name_native: Option<String>,
    pub image_url: Option<String>,
    pub role: Option<String>,
    pub language: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct CharacterProposalBundle {
    pub character: CharacterProposalField,
    pub appearances: Vec<CharacterProposalAppearance>,
    pub actors: Vec<CharacterProposalActor>,
}

// One level of recursion is all catalog/ ever has (catalog/<Folder>/*.json).
fn collect_json_files(dir: &std::path::Path, out: &mut Vec<std::path::PathBuf>) -> Result<(), String> {
    for entry in std::fs::read_dir(dir).map_err(|e| e.to_string())? {
        let path = entry.map_err(|e| e.to_string())?.path();
        if path.is_dir() {
            collect_json_files(&path, out)?;
        } else if path.extension().and_then(|s| s.to_str()) == Some("json") {
            out.push(path);
        }
    }
    Ok(())
}

pub fn sync_local_proposals(db: &crate::db::MetadeaDb) -> Result<(), String> {
    let cwd = std::env::current_dir().unwrap_or_default();
    let mut catalog_dir = cwd.join("catalog");
    if !catalog_dir.exists() {
        if let Some(parent) = std::env::current_dir().ok().and_then(|p| p.parent().map(|p| p.to_path_buf())) {
            catalog_dir = parent.join("catalog");
        }
    }

    if !catalog_dir.exists() {
        return Ok(());
    }

    let mut files = Vec::new();
    collect_json_files(&catalog_dir, &mut files)?;

    for path in files {
        let content = match std::fs::read_to_string(&path) {
            Ok(c) => c,
            Err(e) => {
                eprintln!("Failed to read proposal file {:?}: {}", path, e);
                continue;
            }
        };

        // Which shape a file is gets sniffed from its own content (a "character"
        // key vs a "media_catalog" key), same as build-database.js's readBundles
        // — neither this function nor that script needs to hardcode which
        // folder holds which kind.
        let raw: serde_json::Value = match serde_json::from_str(&content) {
            Ok(v) => v,
            Err(e) => {
                eprintln!("Failed to parse proposal file {:?}: {}", path, e);
                continue;
            }
        };

        if raw.get("character").is_some() {
            match serde_json::from_value::<CharacterProposalBundle>(raw) {
                Ok(bundle) => {
                    if let Err(e) = import_character_bundle(db, bundle) {
                        eprintln!("Failed to import character bundle {:?}: {}", path, e);
                    }
                }
                Err(e) => eprintln!("Failed to deserialize character bundle {:?}: {}", path, e),
            }
        } else {
            match serde_json::from_value::<ProposalBundle>(raw) {
                Ok(bundle) => {
                    if let Err(e) = import_proposal_bundle(db, bundle) {
                        eprintln!("Failed to import bundle {:?}: {}", path, e);
                    }
                }
                Err(e) => eprintln!("Failed to deserialize bundle {:?}: {}", path, e),
            }
        }
    }

    Ok(())
}

fn import_character_bundle(db: &crate::db::MetadeaDb, bundle: CharacterProposalBundle) -> Result<(), String> {
    let mut conn = db.conn.lock().str_err()?;
    let tx = conn.transaction().str_err()?;
    let now = Utc::now().to_rfc3339();
    let char = &bundle.character;

    // Same "fill in, don't clobber an existing row" convention as
    // replace_bundle_characters below — dev-time sync, not the authoritative
    // merge (that's sync_community_catalog, reading the built database.db).
    tx.execute(
        "INSERT OR IGNORE INTO characters (id, external_id, name, name_native, aliases_csv, biography, image_url, reaction, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, NULL, ?8, ?8)",
        rusqlite::params![
            crate::db::generate_id(),
            &char.external_id,
            &char.name,
            &char.name_native,
            &char.aliases_csv,
            &char.biography,
            &char.image_url,
            &now,
        ],
    ).str_err()?;

    for app in &bundle.appearances {
        tx.execute(
            "INSERT OR REPLACE INTO character_appearances (character_external_id, media_external_id, relation_type, character_name, added_at)
             VALUES (?1, ?2, ?3, NULL, ?4)",
            rusqlite::params![&char.external_id, &app.media_external_id, &app.relation_type, &now],
        ).str_err()?;
    }

    for actor in &bundle.actors {
        tx.execute(
            "INSERT OR IGNORE INTO actors (id, external_id, name, name_native, image_url, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)",
            rusqlite::params![
                crate::db::generate_id(),
                &actor.external_id,
                &actor.name,
                &actor.name_native,
                &actor.image_url,
                &now,
            ],
        ).str_err()?;

        tx.execute(
            "INSERT OR REPLACE INTO character_actors (actor_external_id, character_external_id, role, language, added_at)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            rusqlite::params![&actor.external_id, &char.external_id, &actor.role, &actor.language, &now],
        ).str_err()?;
    }

    tx.commit().str_err()?;
    Ok(())
}

// import_proposal_bundle used to be one 275-line function covering all five
// bundle sections inline — split into one helper per section (still run
// inside the same transaction, so the whole import stays atomic) purely for
// readability; no behavior changes from the original SQL.
fn upsert_bundle_catalog_entry(tx: &rusqlite::Transaction, entry: &MediaCatalogEntry) -> Result<(), String> {
    let exists_val: i64 = tx
        .query_row(
            "SELECT COUNT(*) FROM media_catalog WHERE external_id = ?1",
            [&entry.external_id],
            |row| row.get(0),
        )
        .str_err()?;

    if exists_val == 0 {
        tx.execute(
            "INSERT INTO media_catalog (
                id, external_id, authors_csv, banners_csv, blocked_at, country_code, cover_url,
                favorites_count, format, genres_csv, genres_tag_csv,
                last_sync_error, last_synced_at, parent_id, platforms_csv,
                ratings_count, release_day, release_end_day, release_end_month, release_end_year,
                release_month, release_year, score_global,
                shop_links_csv, source, source_url, status, sync_failed_count, synopsis,
                time_length, title_english, title_main, title_native, title_romaji, total_count, total_count_2,
                type, created_at, updated_at
            ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            rusqlite::params![
                crate::db::generate_id(),
                &entry.external_id,
                &entry.authors_csv,
                &entry.banners_csv,
                &entry.blocked_at,
                &entry.country_code,
                &entry.cover_url,
                &entry.favorites_count,
                &entry.format,
                &entry.genres_csv,
                &entry.genres_tag_csv,
                &entry.last_sync_error,
                &entry.last_synced_at,
                &entry.parent_id,
                &entry.platforms_csv,
                &entry.ratings_count,
                &entry.release_day,
                &entry.release_end_day,
                &entry.release_end_month,
                &entry.release_end_year,
                &entry.release_month,
                &entry.release_year,
                &entry.score_global,
                &entry.shop_links_csv,
                &entry.source,
                &entry.source_url,
                &entry.status,
                &entry.sync_failed_count,
                &entry.synopsis,
                &entry.time_length,
                &entry.title_english,
                &entry.title_main,
                &entry.title_native,
                &entry.title_romaji,
                &entry.total_count,
                &entry.total_count_2,
                &entry.r#type,
                &entry.created_at,
                &entry.updated_at,
            ],
        )
        .str_err()?;
    } else {
        tx.execute(
            "UPDATE media_catalog SET
                authors_csv = ?, banners_csv = ?, blocked_at = ?, country_code = ?, cover_url = ?,
                favorites_count = ?, format = ?, genres_csv = ?,
                genres_tag_csv = ?, last_sync_error = ?, last_synced_at = ?, parent_id = ?,
                platforms_csv = ?, ratings_count = ?, release_day = ?,
                release_end_day = ?, release_end_month = ?, release_end_year = ?,
                release_month = ?, release_year = ?, score_global = ?, shop_links_csv = ?,
                source = ?, source_url = ?, status = ?, sync_failed_count = ?,
                synopsis = ?, time_length = ?, title_english = ?, title_main = ?, title_native = ?,
                title_romaji = ?, total_count = ?, total_count_2 = ?, type = ?,
                updated_at = ?
             WHERE external_id = ?",
            rusqlite::params![
                &entry.authors_csv,
                &entry.banners_csv,
                &entry.blocked_at,
                &entry.country_code,
                &entry.cover_url,
                &entry.favorites_count,
                &entry.format,
                &entry.genres_csv,
                &entry.genres_tag_csv,
                &entry.last_sync_error,
                &entry.last_synced_at,
                &entry.parent_id,
                &entry.platforms_csv,
                &entry.ratings_count,
                &entry.release_day,
                &entry.release_end_day,
                &entry.release_end_month,
                &entry.release_end_year,
                &entry.release_month,
                &entry.release_year,
                &entry.score_global,
                &entry.shop_links_csv,
                &entry.source,
                &entry.source_url,
                &entry.status,
                &entry.sync_failed_count,
                &entry.synopsis,
                &entry.time_length,
                &entry.title_english,
                &entry.title_main,
                &entry.title_native,
                &entry.title_romaji,
                &entry.total_count,
                &entry.total_count_2,
                &entry.r#type,
                &entry.updated_at,
                &entry.external_id,
            ],
        )
        .str_err()?;
    }
    Ok(())
}

// Owners are the distinct media_external_id each row is tagged for
// (defaulting to this entry's own id when untagged) — only *their* existing
// relations get cleared before re-inserting the bundle's rows for them, in
// one statement instead of the previous O(owners × targets) DELETE-per-pair.
// Scoping the DELETE to owners also fixes a correctness bug: the old
// pairwise delete wiped *any* existing relation between two ids merely
// mentioned here, even if a different, unrelated PR had contributed it and
// this bundle never touches that owner at all. Returns the owner list since
// the saga_name section later needs it too.
fn replace_bundle_relations(
    tx: &rusqlite::Transaction,
    entry: &MediaCatalogEntry,
    relations: &[DbMediaRelation],
    now: &str,
) -> Result<Vec<String>, String> {
    let owners: Vec<String> = {
        let mut set = std::collections::HashSet::new();
        for rel in relations {
            set.insert(rel.media_external_id.clone().unwrap_or_else(|| entry.external_id.clone()));
        }
        set.into_iter().collect()
    };

    if !owners.is_empty() {
        let placeholders = owners.iter().map(|_| "?").collect::<Vec<_>>().join(",");
        let sql = format!("DELETE FROM media_relations WHERE media_external_id IN ({})", placeholders);
        tx.execute(&sql, rusqlite::params_from_iter(owners.iter())).str_err()?;
    }

    // One batch existence check instead of a per-row query (was the same N+1
    // existing_catalog_ids was written to fix elsewhere in this file) — kept
    // mutable so a related id appearing more than once in the same bundle
    // still only gets its stub catalog row inserted once.
    let related_ids: Vec<String> = relations.iter().map(|r| r.related_media_external_id.clone()).collect();
    let mut known_ids = existing_catalog_ids(&tx, &related_ids)?;

    for rel in relations {
        let parent_id = rel.media_external_id.as_deref().unwrap_or(&entry.external_id);

        // A media can't be related to itself.
        if rel.related_media_external_id == parent_id {
            continue;
        }

        tx.execute(
            "INSERT OR REPLACE INTO media_relations (media_external_id, related_media_external_id, relation_type, type_label)
             VALUES (?1, ?2, ?3, ?4)",
            rusqlite::params![
                parent_id,
                &rel.related_media_external_id,
                &rel.relation_type,
                &rel.type_label,
            ],
        )
        .str_err()?;

        if let Some((recip_type, recip_label)) = reciprocal_relation(&rel.relation_type) {
            tx.execute(
                "INSERT OR IGNORE INTO media_relations (media_external_id, related_media_external_id, relation_type, type_label)
                 VALUES (?1, ?2, ?3, ?4)",
                rusqlite::params![&rel.related_media_external_id, parent_id, recip_type, recip_label],
            )
            .str_err()?;
        }

        if !known_ids.contains(&rel.related_media_external_id) {
            let rel_type = infer_type_from_id(&rel.related_media_external_id);

            tx.execute(
                "INSERT INTO media_catalog (
                    id, external_id, type, source, title_main, cover_url, created_at, updated_at
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                rusqlite::params![
                    crate::db::generate_id(),
                    &rel.related_media_external_id,
                    &rel_type,
                    infer_source_from_id(&rel.related_media_external_id),
                    &rel.title,
                    &rel.cover,
                    now,
                    now,
                ],
            )
            .str_err()?;
            known_ids.insert(rel.related_media_external_id.clone());
        }
    }

    Ok(owners)
}

fn replace_bundle_characters(
    tx: &rusqlite::Transaction,
    entry: &MediaCatalogEntry,
    characters: &[crate::characters::SkeletonCharacter],
    now: &str,
) -> Result<(), String> {
    tx.execute(
        "DELETE FROM character_appearances WHERE media_external_id = ?1",
        [&entry.external_id],
    )
    .str_err()?;

    for char in characters {
        tx.execute(
            "INSERT OR IGNORE INTO characters (id, external_id, name, image_url, reaction, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            rusqlite::params![
                crate::db::generate_id(),
                &char.external_id,
                &char.name,
                &char.image_url,
                None::<String>,
                now,
                now,
            ],
        )
        .str_err()?;

        tx.execute(
            "INSERT OR REPLACE INTO character_appearances (character_external_id, media_external_id, relation_type, character_name, added_at)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            rusqlite::params![
                &char.external_id,
                &entry.external_id,
                &char.relation_type,
                &char.character_name,
                now,
            ],
        )
        .str_err()?;
    }
    Ok(())
}

fn replace_bundle_authors(
    tx: &rusqlite::Transaction,
    entry: &MediaCatalogEntry,
    authors: &[DbMediaAuthor],
    now: &str,
) -> Result<(), String> {
    tx.execute(
        "DELETE FROM media_by_author WHERE media_external_id = ?1",
        [&entry.external_id],
    )
    .str_err()?;

    for auth in authors {
        tx.execute(
            "INSERT OR REPLACE INTO media_author (external_id, name, author_image_url, author_url, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            rusqlite::params![
                &auth.external_id,
                &auth.name,
                &auth.image,
                &auth.url,
                now,
            ],
        )
        .str_err()?;

        tx.execute(
            "INSERT OR REPLACE INTO media_by_author (media_external_id, author_external_id, role)
             VALUES (?1, ?2, ?3)",
            rusqlite::params![
                &entry.external_id,
                &auth.external_id,
                &auth.role,
            ],
        )
        .str_err()?;
    }
    Ok(())
}

fn upsert_bundle_saga_name(
    tx: &rusqlite::Transaction,
    entry: &MediaCatalogEntry,
    owners: &[String],
    saga_name: &str,
) -> Result<(), String> {
    let saga_id = owners.iter().min().cloned().unwrap_or_else(|| entry.external_id.clone());
    tx.execute(
        "INSERT OR REPLACE INTO sagas (id, name) VALUES (?1, ?2)",
        rusqlite::params![&saga_id, saga_name],
    )
    .str_err()?;

    for owner in owners {
        tx.execute(
            "INSERT OR REPLACE INTO saga_relations (saga_id, media_external_id) VALUES (?1, ?2)",
            rusqlite::params![&saga_id, owner],
        )
        .str_err()?;
    }
    Ok(())
}

pub fn import_proposal_bundle(db: &crate::db::MetadeaDb, bundle: ProposalBundle) -> Result<(), String> {
    let mut conn = db.conn.lock().str_err()?;
    let tx = conn.transaction().str_err()?;

    let now = Utc::now().to_rfc3339();
    let entry = bundle.media_catalog;

    upsert_bundle_catalog_entry(&tx, &entry)?;
    let owners = replace_bundle_relations(&tx, &entry, &bundle.media_relations, &now)?;
    replace_bundle_characters(&tx, &entry, &bundle.characters, &now)?;
    replace_bundle_authors(&tx, &entry, &bundle.media_authors, &now)?;

    if let Some(saga_name) = &bundle.saga_name {
        upsert_bundle_saga_name(&tx, &entry, &owners, saga_name)?;
    }

    tx.commit().str_err()?;
    Ok(())
}
