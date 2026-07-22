use rusqlite::{Connection, Result as SqlResult};
use std::sync::Mutex;

// ─── Error conversion ─────────────────────────────────────────────────────────
// Every Tauri command returns Result<T, String>, but rusqlite/serde_json errors
// aren't String — this collapses the `.map_err(|e| e.to_string())` boilerplate
// that used to appear at nearly every fallible call site into a single `.str_err()`.

pub trait ToStringErr<T> {
    fn str_err(self) -> Result<T, String>;
}

impl<T, E: std::fmt::Display> ToStringErr<T> for Result<T, E> {
    fn str_err(self) -> Result<T, String> {
        self.map_err(|e| e.to_string())
    }
}

// ─── Unified DB handle ────────────────────────────────────────────────────────

pub struct MetadeaDb {
    pub conn: Mutex<Connection>,
}

impl MetadeaDb {
    pub fn open(path: &std::path::Path) -> SqlResult<Self> {
        let conn = Connection::open(path)?;
        conn.execute_batch(METADEA_SCHEMA)?;
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS schema_migrations (
                version    INTEGER PRIMARY KEY,
                applied_at TEXT DEFAULT CURRENT_TIMESTAMP
            );"
        )?;
        run_migrations(&conn)?;
        // Shared "is this row hidden by a curator block" predicate, defined
        // once here instead of repeating "blocked_at IS NULL"/"IS NOT NULL"
        // in every query that joins against media_catalog — created after
        // run_migrations so blocked_at is guaranteed to exist by the time
        // these views reference it, even on a fresh upgrade's very first run.
        conn.execute_batch(
            "CREATE VIEW IF NOT EXISTS visible_media_catalog AS SELECT * FROM media_catalog WHERE blocked_at IS NULL;
             CREATE VIEW IF NOT EXISTS blocked_media_catalog AS SELECT * FROM media_catalog WHERE blocked_at IS NOT NULL;"
        )?;
        conn.execute("PRAGMA foreign_keys = ON", [])?;
        conn.pragma_update(None, "journal_mode", &"WAL")?;
        // Several Tauri commands fire near-simultaneously on page load
        // (persistToCatalog, save_media_relations, save_media_authors...).
        // They queue safely on the Mutex, but WAL can still hit a brief
        // SQLITE_BUSY (e.g. mid-checkpoint) — without a busy_timeout that
        // fails instantly as "database is locked" instead of just waiting
        // the few ms it takes to clear.
        conn.busy_timeout(std::time::Duration::from_secs(5))?;
        Ok(Self { conn: Mutex::new(conn) })
    }
}

fn current_schema_version(conn: &Connection) -> i64 {
    conn.query_row(
        "SELECT COALESCE(MAX(version), 0) FROM schema_migrations",
        [],
        |r| r.get(0),
    ).unwrap_or(0)
}

fn mark_migration(conn: &Connection, version: i64) -> SqlResult<()> {
    conn.execute("INSERT OR IGNORE INTO schema_migrations (version) VALUES (?1)", [version])?;
    Ok(())
}

pub(crate) fn union_find_root(parent: &mut std::collections::HashMap<String, String>, x: &str) -> String {
    let mut root = x.to_string();
    while let Some(p) = parent.get(&root) {
        if p == &root { break; }
        root = p.clone();
    }
    let mut cur = x.to_string();
    while let Some(p) = parent.get(&cur).cloned() {
        if p == cur { break; }
        parent.insert(cur.clone(), root.clone());
        cur = p;
    }
    root
}

pub(crate) fn union_find_merge(parent: &mut std::collections::HashMap<String, String>, a: &str, b: &str) {
    parent.entry(a.to_string()).or_insert_with(|| a.to_string());
    parent.entry(b.to_string()).or_insert_with(|| b.to_string());
    let ra = union_find_root(parent, a);
    let rb = union_find_root(parent, b);
    if ra != rb {
        parent.insert(ra, rb);
    }
}

// sagas/saga_relations can fragment into one single-member row per work (the
// PR pipeline anchors each proposal file's own "owners" independently — see
// buildRelatedProposalBundle in pr-editor-submit.ts). Rebuilds it instead from
// the real PREQUEL/SEQUEL graph in media_relations — connected components
// there are the real sagas. ALTERNATIVE is excluded: it links alternate
// versions/adaptations, not story continuations, and would merge unrelated
// entries in. Runs as a one-time migration and at the end of every
// sync_community_catalog (a downloaded database.db can carry the same
// fragmentation until build-database.js's own fix reaches a rebuilt release).
pub fn merge_fragmented_sagas(conn: &Connection) -> SqlResult<()> {
    let mut parent: std::collections::HashMap<String, String> = std::collections::HashMap::new();
    {
        let mut stmt = conn.prepare(
            "SELECT media_external_id, related_media_external_id FROM media_relations
             WHERE relation_type IN ('PREQUEL', 'SEQUEL')"
        )?;
        let rows = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?;
        for (a, b) in rows.filter_map(|r| r.ok()) {
            union_find_merge(&mut parent, &a, &b);
        }
    }
    if parent.is_empty() {
        return Ok(());
    }

    let ids: Vec<String> = parent.keys().cloned().collect();
    let mut components: std::collections::HashMap<String, Vec<String>> = std::collections::HashMap::new();
    for id in ids {
        let root = union_find_root(&mut parent, &id);
        components.entry(root).or_default().push(id);
    }

    for members in components.values() {
        if members.len() < 2 { continue; }
        // Same anchoring convention as save_cached_saga (TS/Rust): the
        // lexicographically-smallest member — so a future legitimate save
        // converges on the same id this migration already picked instead of
        // immediately re-fragmenting it.
        let canonical = members.iter().min().cloned().unwrap();

        let placeholders = members.iter().map(|_| "?").collect::<Vec<_>>().join(",");
        let existing_name: Option<String> = {
            let sql = format!("SELECT name FROM sagas WHERE id IN ({placeholders}) AND name != '' LIMIT 1");
            let mut stmt = conn.prepare(&sql)?;
            let params = rusqlite::params_from_iter(members.iter());
            stmt.query_row(params, |r| r.get(0)).ok()
        };

        conn.execute(
            "INSERT OR IGNORE INTO sagas (id, name) VALUES (?1, '')",
            [&canonical],
        )?;
        if let Some(name) = &existing_name {
            conn.execute(
                "UPDATE sagas SET name = ?2 WHERE id = ?1 AND (name IS NULL OR name = '')",
                rusqlite::params![&canonical, name],
            )?;
        }

        for member in members {
            conn.execute(
                "DELETE FROM saga_relations WHERE media_external_id = ?1 AND saga_id != ?2",
                rusqlite::params![member, &canonical],
            )?;
            conn.execute(
                "INSERT OR IGNORE INTO saga_relations (media_external_id, saga_id) VALUES (?1, ?2)",
                rusqlite::params![member, &canonical],
            )?;
        }

        for member in members {
            if member == &canonical { continue; }
            let remaining: i64 = conn.query_row(
                "SELECT COUNT(*) FROM saga_relations WHERE saga_id = ?1",
                [member],
                |r| r.get(0),
            )?;
            if remaining == 0 {
                conn.execute("DELETE FROM sagas WHERE id = ?1", [member])?;
            }
        }
    }

    Ok(())
}

fn run_migrations(conn: &Connection) -> SqlResult<()> {
    let v = current_schema_version(conn);

    if v < 1 {
        let _ = conn.execute("ALTER TABLE media_catalog ADD COLUMN authors_csv TEXT DEFAULT ''", []);
        let _ = conn.execute("ALTER TABLE media_catalog ADD COLUMN shop_links_csv TEXT DEFAULT ''", []);
        mark_migration(conn, 1)?;
    }
    if v < 2 {
        let _ = conn.execute("ALTER TABLE characters ADD COLUMN name_native TEXT", []);
        let _ = conn.execute("ALTER TABLE characters ADD COLUMN aliases_csv TEXT DEFAULT ''", []);
        let _ = conn.execute("ALTER TABLE characters ADD COLUMN biography TEXT", []);
        mark_migration(conn, 2)?;
    }
    if v < 3 {
        let _ = conn.execute("ALTER TABLE user_profile ADD COLUMN rating_system TEXT NOT NULL DEFAULT '5-star'", []);
        mark_migration(conn, 3)?;
    }
    if v < 4 {
        let _ = conn.execute("ALTER TABLE character_appearances ADD COLUMN character_name TEXT", []);
        mark_migration(conn, 4)?;
    }
    if v < 5 {
        // media_relations used to key on (media, related, relation_type),
        // which let the same target accumulate more than one row over time —
        // most visibly, an old sync writing the raw display label as
        // relation_type ("Expanded Edition") and a later one writing the
        // canonical key ("EXPANDED_GAME") for the exact same pair, so the
        // same related title rendered twice in a row's relations. Rebuild
        // the table keyed on (media, related) only, keeping the
        // most-recently-written row per pair (rowid DESC + INSERT OR IGNORE
        // = first-seen-wins-per-key, so the newest survives).
        let _ = conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS media_relations_v5 (
                media_external_id         TEXT NOT NULL,
                related_media_external_id TEXT NOT NULL,
                relation_type             TEXT NOT NULL,
                type_label                TEXT NOT NULL,
                PRIMARY KEY (media_external_id, related_media_external_id)
             );
             INSERT OR IGNORE INTO media_relations_v5
                (media_external_id, related_media_external_id, relation_type, type_label)
             SELECT media_external_id, related_media_external_id, relation_type, type_label
             FROM media_relations
             ORDER BY rowid DESC;
             DROP TABLE media_relations;
             ALTER TABLE media_relations_v5 RENAME TO media_relations;"
        );
        mark_migration(conn, 5)?;
    }
    if v < 6 {
        // Custom favorite images used to store an arbitrary remote image_url
        // read straight from the DB at render time — broken in release
        // builds whenever that URL wasn't reachable/allowed. Now the actual
        // image bytes are downloaded once and saved under the app's own
        // data dir (user_metadata/custom_image/<list_name>/<file_name>), so
        // rendering never depends on network/CSP again. Old rows point at
        // URLs, not files, so they can't be migrated in-place — drop and
        // let the user re-pick their custom crops.
        let _ = conn.execute_batch(
            "DROP TABLE IF EXISTS favorite_custom_images;
             CREATE TABLE favorite_custom_images (
                external_id TEXT PRIMARY KEY,
                list_name   TEXT NOT NULL,
                file_name   TEXT NOT NULL,
                bg_size     REAL NOT NULL DEFAULT 100,
                pos_x       REAL NOT NULL DEFAULT 50,
                pos_y       REAL NOT NULL DEFAULT 50,
                updated_at  TEXT DEFAULT CURRENT_TIMESTAMP
             );"
        );
        mark_migration(conn, 6)?;
    }
    if v < 7 {
        // Separate, append-only table for "when did I watch/read episode N"
        // — deliberately not touching user_library (which only tracks the
        // current progress number, not a per-episode timeline) so this can
        // grow freely without bloating the row every progress edit updates.
        let _ = conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS episode_history (
                id             TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
                external_id    TEXT NOT NULL,
                episode_number REAL NOT NULL,
                watched_at     TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
             );
             CREATE INDEX IF NOT EXISTS idx_episode_history_external_id
                ON episode_history(external_id);"
        );
        mark_migration(conn, 7)?;
    }
    if v < 8 {
        // Backfill: media_relations rows saved before save_media_relations /
        // import_proposal_bundle started writing the reciprocal edge (see
        // reciprocal_relation() in media_catalog.rs) could be one-directional
        // — a SEQUEL on one side with no matching PREQUEL on the other. The
        // saga chain's recursive walk only follows a row's own
        // media_external_id column forward, so a missing reciprocal edge
        // silently truncated the chain right there. INSERT OR IGNORE so an
        // already-curated (possibly different) classification on the other
        // side is never overwritten — this only fills genuine gaps.
        let pairs: &[(&str, &str, &str)] = &[
            ("SEQUEL", "PREQUEL", "Prequel"),
            ("PREQUEL", "SEQUEL", "Sequel"),
            ("SOURCE", "ADAPTATION", "Adaptation"),
            ("ADAPTATION", "SOURCE", "Source Material"),
            ("EPISODE", "PART_OF", "Part of"),
            ("UPDATE", "PART_OF", "Part of"),
        ];
        for (from_type, recip_type, recip_label) in pairs {
            let _ = conn.execute(
                "INSERT OR IGNORE INTO media_relations (media_external_id, related_media_external_id, relation_type, type_label)
                 SELECT related_media_external_id, media_external_id, ?2, ?3
                 FROM media_relations WHERE relation_type = ?1",
                rusqlite::params![from_type, recip_type, recip_label],
            );
        }
        mark_migration(conn, 8)?;
    }
    if v < 9 {
        // Backfill: media_relations.type_label used to be written from
        // whichever UI language the editor's app happened to be in (see
        // PrEditorModal.tsx's now-removed `relationLabels` write path), so
        // rows saved from a Spanish-language session hold Spanish text
        // ("Secuela", "Precuela", ...) instead of the canonical English the
        // shared community catalog expects. relation_type itself (the
        // actual key everything else matches on) was never affected by that
        // bug, so it's a reliable source to re-derive the correct label
        // from — this just re-applies canonical_relation_label() to every
        // row regardless of its current type_label, which is simpler and
        // more robust than trying to detect "is this already English".
        for (relation_type, label) in canonical_relation_labels() {
            let _ = conn.execute(
                "UPDATE media_relations SET type_label = ?2 WHERE relation_type = ?1 AND type_label != ?2",
                rusqlite::params![relation_type, label],
            );
        }
        mark_migration(conn, 9)?;
    }
    if v < 10 {
        // Set once by PrEditorModal (the "Edit Collaborative Catalog Entry"
        // flow) on save — a live API resync checks this before touching an
        // entry's relations, so a manual deletion/reorder there can't get
        // silently re-added or reshuffled by the next scheduled resync (the
        // live provider has no idea the removal was deliberate; it just
        // reports the same relation again).
        let _ = conn.execute("ALTER TABLE media_catalog ADD COLUMN manually_edited_at TEXT", []);
        mark_migration(conn, 10)?;
    }
    if v < 11 {
        // Set via PrEditorModal to reserve an external_id (so it can never be
        // re-added as "new" from a live search result) while hiding the row
        // itself everywhere else — search, relations, saga chains, browse
        // lists — for remasters/editions the user considers noise. The row
        // itself is never deleted, only excluded from every read path that
        // isn't a direct "does this id already exist" lookup.
        let _ = conn.execute("ALTER TABLE media_catalog ADD COLUMN blocked_at TEXT", []);
        mark_migration(conn, 11)?;
    }
    if v < 12 {
        // Renamed for a clearer, consistent name alongside media_relations/
        // media_by_author — an install that already created staff_appearances
        // (before this rename) gets its existing rows carried over; a fresh
        // install never had the old name, so METADEA_SCHEMA's own
        // `CREATE TABLE IF NOT EXISTS media_staff_relation` above already
        // covers it and this is a silent no-op there.
        let _ = conn.execute("ALTER TABLE staff_appearances RENAME TO media_staff_relation", []);
        mark_migration(conn, 12)?;
    }
    if v < 13 {
        // Every mapper computes these on each live fetch (the provider's own
        // page URL, a game's lead developer for the banner overlay) but
        // neither was ever persisted — the catalog-only fast path shown on
        // most visits (see mediaService.ts/needsResync) had no column to
        // read them back from, so the source logo/link and "Main Developer"
        // badge flickered in and out depending on whether that visit
        // happened to trigger a live fetch or not.
        let _ = conn.execute("ALTER TABLE media_catalog ADD COLUMN source_url TEXT", []);
        let _ = conn.execute("ALTER TABLE media_catalog ADD COLUMN developer_badge TEXT", []);
        mark_migration(conn, 13)?;
    }
    if v < 14 {
        // Replaced by deleted_relations: manually_edited_at was an all-or-
        // nothing per-row gate — once a live resync's relation merge saw it
        // set, it stopped adding *any* new relation to that entry (even a
        // genuinely new sequel released afterward), not just the specific
        // one the user had deleted. deleted_relations is a per-pair
        // tombstone instead — a resync/community merge skips re-adding
        // exactly the (media, related) pair recorded here, and nothing else
        // is blocked. See save_media_relations / mergeAndPersistRelations.
        let _ = conn.execute("ALTER TABLE media_catalog DROP COLUMN manually_edited_at", []);
        let _ = conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS deleted_relations (
                media_external_id         TEXT NOT NULL,
                related_media_external_id TEXT NOT NULL,
                deleted_at                TEXT DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (media_external_id, related_media_external_id)
             );"
        );
        mark_migration(conn, 14)?;
    }
    if v < 15 {
        // companies_cache_csv merges developers+publishers into one flat
        // list (also directly editable via PrEditorModal) — a game where
        // the same company is both (e.g. self-published) can't be told
        // apart once flattened, so the catalog-only fast path had no way to
        // reproduce the live fetch's publisher-only meta line without
        // wrongly subtracting a company that legitimately belongs in both.
        // publishers_csv is persisted separately, verbatim, purely for that
        // display line — see igdb-mapper.ts / catalog-mapper.ts.
        let _ = conn.execute("ALTER TABLE media_catalog ADD COLUMN publishers_csv TEXT", []);
        mark_migration(conn, 15)?;
    }
    if v < 17 {
        // AniList's countryOfOrigin / TMDB's origin_country ("País de
        // origen" stat) was only ever built live, never persisted — the
        // catalog-only fast path had no way to show it, so it'd flash in
        // only once the live fetch resolved. See catalog-mapper.ts.
        // (Was migration 16 — renumbered because an earlier, since-reverted
        // migration 16 already got applied and marked on dev databases,
        // which made run_migrations silently skip this one.)
        let _ = conn.execute("ALTER TABLE media_catalog ADD COLUMN country_code TEXT", []);
        mark_migration(conn, 17)?;
    }
    if v < 18 {
        // AniList's raw.endDate — only release_year/month/day (the *start*
        // date) was ever persisted, so the catalog-only fast path could only
        // ever rebuild a single-date dateBadge, never the "start - end"
        // range anilist-mapper builds live for finished series.
        let _ = conn.execute("ALTER TABLE media_catalog ADD COLUMN release_end_year INTEGER", []);
        let _ = conn.execute("ALTER TABLE media_catalog ADD COLUMN release_end_month INTEGER", []);
        let _ = conn.execute("ALTER TABLE media_catalog ADD COLUMN release_end_day INTEGER", []);
        mark_migration(conn, 18)?;
    }
    if v < 19 {
        // Display-only alternate title (AniList's title.english when it
        // differs from the main romaji/native title) had no catalog column
        // at all — the fast path could never show it, only a live fetch
        // could, so it always flashed in after the rest of the page.
        let _ = conn.execute("ALTER TABLE media_catalog ADD COLUMN title_english TEXT", []);
        mark_migration(conn, 19)?;
    }
    if v < 20 {
        // Fix inverted reciprocal relation for ADAPTATION (previously mapped to SOURCE,
        // which erroneously marked anime adaptations as the "Source Material" of their original manga).
        let _ = conn.execute(
            "UPDATE media_relations 
             SET relation_type = 'ADAPTATION', type_label = 'Adaptation' 
             WHERE relation_type = 'SOURCE' AND (related_media_external_id LIKE 'anime:%' OR related_media_external_id LIKE 'movie:%' OR related_media_external_id LIKE 'series:%')",
            [],
        );
        mark_migration(conn, 20)?;
    }
    if v < 21 {
        // save_cached_saga anchors a saga's id on its lexicographically-
        // smallest member — adding an earlier-released member later shifts
        // that anchor to a new id, but the *old* sagas row was never
        // cleaned up, only ever left to linger as an apparent duplicate of
        // the same saga (first surfaced by the admin panel's Sagas tab,
        // which lists every sagas row unfiltered). A superseded row is
        // identifiable without tracking history: its own id now shows up as
        // a plain *member* of some other, current saga_id — a work is never
        // legitimately both a saga's own anchor and another saga's member
        // at once. ON DELETE CASCADE on saga_relations.saga_id handles the
        // now-pointless relations rows that go with it.
        let _ = conn.execute(
            "DELETE FROM sagas WHERE id IN (
                SELECT s.id FROM sagas s
                WHERE EXISTS (
                    SELECT 1 FROM saga_relations sr
                    WHERE sr.media_external_id = s.id AND sr.saga_id != s.id
                )
             )",
            [],
        );
        mark_migration(conn, 21)?;
    }
    if v < 22 {
        // Migration 21 only caught sagas whose own anchor shifted (the old
        // anchor still shows up as a plain member of the live saga). It
        // missed the more common fragmentation: the collaborative-catalog PR
        // pipeline mis-anchoring *every* saga member as its own standalone
        // single-member saga in the first place (see merge_fragmented_sagas'
        // own doc comment for why) — visible as the same saga name appearing
        // once per member instead of once total. Rebuilds sagas/
        // saga_relations from the real PREQUEL/SEQUEL graph instead of
        // trusting that bookkeeping.
        let _ = merge_fragmented_sagas(conn);
        mark_migration(conn, 22)?;
    }
    if v < 23 {
        // media_saga_groups is superseded — re-derivable live from
        // ALTERNATIVE edges (pr-editor-load.ts), drop lives in
        // vestigial_cleanup.rs. order_index adds a manual saga position
        // (see saga_relations' own doc comment).
        crate::vestigial_cleanup::drop_media_saga_groups(conn);
        let _ = conn.execute("ALTER TABLE saga_relations ADD COLUMN order_index REAL", []);
        mark_migration(conn, 23)?;
    }

    Ok(())
}

// Canonical (always-English) relation_type -> type_label pairs — mirrors
// frontend/src/i18n/en.ts's `media.relations` table plus the few keys
// (EPISODE/UPDATE/PART_OF/SOURCE) that are only ever written as hardcoded
// English literals in the frontend rather than through that i18n table.
// Kept here (not shared with media_catalog.rs's reciprocal_relation, which
// only needs a handful of these) since this is a one-off backfill list, not
// a piece of ongoing relation-writing logic.
fn canonical_relation_labels() -> &'static [(&'static str, &'static str)] {
    &[
        ("SEQUEL", "Sequel"), ("PREQUEL", "Prequel"), ("SIDE_STORY", "Side story"),
        ("ALTERNATIVE", "Alternative"), ("ADAPTATION", "Adaptation"), ("PARENT", "Source"),
        ("SUMMARY", "Summary"), ("SPIN_OFF", "Spin-off"), ("OTHER", "Other"),
        ("CHARACTER", "Character"), ("CONTAINS", "Contains"), ("RECOMMENDATION", "Recommended"),
        ("EDITIONS", "Editions"),
        ("REL_ADAPTATION", "Adaptation"),
        ("REL_ALTERNATIVE", "Alternative Version"),
        ("REMASTER", "Remaster"),
        ("REMAKE", "Remake"),
        ("EXPANDED_GAME", "Expanded Edition"),
        ("REL_UPDATE", "Update"),
        ("DLC", "DLC"),
        ("EXPANSION", "Content Expansion"),
        ("STANDALONE", "Standalone Expansion"),
        ("FORK", "Fork"),
        ("SEASON", "Season"),
        ("SOURCE", "Source Material"),
        ("EPISODE", "Episode"),
        ("UPDATE", "Update"),
        ("PART_OF", "Part of"),
    ]
}

// ─── ID generator ─────────────────────────────────────────────────────────────

pub fn generate_id() -> String {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let a = (nanos as u64)
        .wrapping_mul(6364136223846793005)
        .wrapping_add(1442695040888963407);
    let b = ((nanos >> 64) as u64)
        .wrapping_mul(6364136223846793005)
        .wrapping_add(a);
    format!("{:016x}{:016x}", a, b)
}

// ─── Unified Schema (tables in alphabetical order) ───────────────────────────

const METADEA_SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS app_env (
    name       TEXT PRIMARY KEY,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    value      TEXT NOT NULL DEFAULT ''
);

-- Local-only cover override, used exclusively by the profile Favorites tab
-- (never synced/shared) — lets a user re-crop/zoom whatever cover a
-- favorited media or character already has without touching the real
-- media_catalog/characters cover_url. bg_size/pos_x/pos_y map directly to
-- CSS background-size/background-position percentages, so the editor's
-- live preview and the final card render use the exact same formula. The
-- image itself is downloaded once and stored on disk under
-- user_metadata/custom_image/<list_name>/<file_name> (see favorite_images.rs)
-- rather than re-fetched from image_url at render time.
CREATE TABLE IF NOT EXISTS favorite_custom_images (
    external_id TEXT PRIMARY KEY,
    bg_size     REAL NOT NULL DEFAULT 100,
    file_name   TEXT NOT NULL,
    list_name   TEXT NOT NULL,
    pos_x       REAL NOT NULL DEFAULT 50,
    pos_y       REAL NOT NULL DEFAULT 50,
    updated_at  TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS characters (
    id           TEXT PRIMARY KEY,
    aliases_csv  TEXT DEFAULT '',
    biography    TEXT,
    external_id  TEXT UNIQUE NOT NULL,
    image_url    TEXT,
    name         TEXT NOT NULL DEFAULT '',
    name_native  TEXT,
    reaction     TEXT,
    created_at   TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at   TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS characters_external_idx ON characters(external_id);

CREATE TABLE IF NOT EXISTS character_appearances (
    character_external_id TEXT NOT NULL,
    character_name        TEXT,
    media_external_id     TEXT NOT NULL,
    relation_type         TEXT,
    added_at              TEXT DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (character_external_id, media_external_id)
);

-- Staff (director, writer, composer, ...) — deliberately its own table
-- rather than reusing `characters`, since it's a different kind of person
-- (a real-world credit, not an in-universe character) even though both are
-- rendered with the same card layout on the media page.
CREATE TABLE IF NOT EXISTS media_staff (
    id           TEXT PRIMARY KEY,
    external_id  TEXT UNIQUE NOT NULL,
    image_url    TEXT,
    name         TEXT NOT NULL DEFAULT '',
    created_at   TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at   TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS media_staff_external_idx ON media_staff(external_id);

CREATE TABLE IF NOT EXISTS media_staff_relation (
    media_external_id TEXT NOT NULL,
    role               TEXT,
    staff_external_id TEXT NOT NULL,
    added_at           TEXT DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (staff_external_id, media_external_id)
);

CREATE TABLE IF NOT EXISTS local_folders (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    label      TEXT NOT NULL DEFAULT '',
    path       TEXT NOT NULL DEFAULT '',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS local_game_links (
    external_id TEXT NOT NULL,
    launcher    TEXT NOT NULL,
    link_key    TEXT NOT NULL DEFAULT '',
    updated_at  TEXT DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (launcher, link_key)
);

CREATE TABLE IF NOT EXISTS local_routes (
    key        TEXT PRIMARY KEY,
    path       TEXT NOT NULL DEFAULT '',
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS local_anime_folders (
    anilist_id   INTEGER PRIMARY KEY,
    episode_count INTEGER DEFAULT 0,
    folder_path  TEXT NOT NULL,
    updated_at   TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS media_catalog (
    id                   TEXT PRIMARY KEY,
    external_id          TEXT UNIQUE NOT NULL,
    authors_csv          TEXT DEFAULT '',
    banners_csv          TEXT DEFAULT '',
    blocked_at           TEXT,
    country_code         TEXT,
    cover_url            TEXT,
    developer_badge      TEXT,
    favorites_count      INTEGER DEFAULT 0,
    format               TEXT DEFAULT '',
    genres_csv           TEXT DEFAULT '',
    genres_tag_csv       TEXT DEFAULT '',
    last_sync_error      TEXT,
    last_synced_at       TEXT,
    parent_id            TEXT,
    platforms_csv        TEXT DEFAULT '',
    publishers_csv       TEXT DEFAULT '',
    ratings_count        INTEGER DEFAULT 0,
    release_day          INTEGER,
    release_end_day      INTEGER,
    release_end_month    INTEGER,
    release_end_year     INTEGER,
    release_month        INTEGER,
    release_year         INTEGER,
    score_global         REAL,
    shop_links_csv       TEXT DEFAULT '',
    source               TEXT DEFAULT '',
    source_url           TEXT,
    status               TEXT,
    sync_failed_count    INTEGER DEFAULT 0,
    synopsis             TEXT,
    time_length          INTEGER,
    title_english        TEXT,
    title_main           TEXT DEFAULT '',
    title_native         TEXT DEFAULT '',
    title_romaji         TEXT DEFAULT '',
    total_count          INTEGER,
    total_count_2        INTEGER,
    type                 TEXT,
    created_at           TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at           TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS media_catalog_external_idx ON media_catalog(external_id);

CREATE TABLE IF NOT EXISTS media_author (
    external_id      TEXT PRIMARY KEY,
    author_image_url TEXT,
    author_url       TEXT,
    name             TEXT NOT NULL,
    created_at       TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at       TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS media_by_author (
    author_external_id TEXT NOT NULL,
    media_external_id  TEXT NOT NULL,
    role               TEXT,
    PRIMARY KEY (media_external_id, author_external_id),
    FOREIGN KEY (author_external_id) REFERENCES media_author(external_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS sagas (
    id          TEXT PRIMARY KEY,
    description TEXT,
    name        TEXT NOT NULL DEFAULT '',
    created_at  TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at  TEXT DEFAULT CURRENT_TIMESTAMP
);

-- order_index: manual saga position (see assign_saga_order_indices in
-- sagas.rs) — new chains start at 100, inserts between two ordered entries
-- get the fractional midpoint. NULL when never touched by the editor;
-- build_saga_list then falls back to release-date order.
CREATE TABLE IF NOT EXISTS saga_relations (
    media_external_id TEXT NOT NULL,
    saga_id           TEXT NOT NULL,
    order_index       REAL,
    PRIMARY KEY (media_external_id, saga_id),
    FOREIGN KEY (saga_id) REFERENCES sagas(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS saga_relations_saga_idx ON saga_relations(saga_id);

-- relation_type is deliberately NOT part of the primary key — a given work
-- can only relate to another work one way at a time (see migration 5's
-- comment for why including it there let the same pair accumulate more than
-- one row, e.g. once tagged with a raw display label and again with a
-- canonical key after a later fix, both surviving side by side).
CREATE TABLE IF NOT EXISTS media_relations (
    media_external_id         TEXT NOT NULL,
    related_media_external_id TEXT NOT NULL,
    relation_type             TEXT NOT NULL,
    type_label                TEXT NOT NULL,
    PRIMARY KEY (media_external_id, related_media_external_id)
);
-- get_all_media_relations joins media_catalog ON related_media_external_id —
-- the PK's leading column (media_external_id) doesn't cover that side of
-- the join, so it fell back to a full scan without this.
CREATE INDEX IF NOT EXISTS idx_media_relations_related ON media_relations(related_media_external_id);

-- Per-pair tombstone: a live API resync or community-catalog merge must
-- never silently re-add a relation the user deliberately deleted here — but
-- unlike a per-row 'manually edited' flag, this only ever blocks the exact
-- (media, related) pair recorded, so a genuinely new relation (a sequel
-- released afterward, say) still comes through normally. See
-- save_media_relations (writes tombstones for anything dropped from the
-- full list it's given) and mergeAndPersistRelations (reads them back).
CREATE TABLE IF NOT EXISTS deleted_relations (
    media_external_id         TEXT NOT NULL,
    related_media_external_id TEXT NOT NULL,
    deleted_at                TEXT DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (media_external_id, related_media_external_id)
);

-- Snapshot of external_ids seen in the last downloaded community catalog
-- (sync_community_catalog) — diffed against the newly downloaded set on the
-- next sync to detect entries removed upstream (e.g. deleted via a merged
-- collaborative-editor PR), so the client can clean those up locally instead
-- of keeping them forever (the merge itself is INSERT OR IGNORE only).
CREATE TABLE IF NOT EXISTS community_synced_ids (
    external_id TEXT PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS monthly_history (
    external_id  TEXT NOT NULL,
    month        TEXT NOT NULL,
    position     INTEGER NOT NULL DEFAULT 0,
    added_at     TEXT DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (month, external_id)
);
-- read_monthly_history orders by (month DESC, position) — the PK only
-- covers point lookups on month, not this ordering, so it still needs a
-- sort without this.
CREATE INDEX IF NOT EXISTS idx_monthly_history_month_position ON monthly_history(month, position);

CREATE TABLE IF NOT EXISTS tier_list_items (
    external_id  TEXT NOT NULL,
    position     INTEGER NOT NULL DEFAULT 0,
    tier_key     TEXT NOT NULL DEFAULT 'pool',
    tier_list_id TEXT NOT NULL,
    PRIMARY KEY (tier_list_id, external_id)
);

CREATE TABLE IF NOT EXISTS tier_lists (
    id         TEXT PRIMARY KEY,
    list_type  TEXT NOT NULL DEFAULT 'works',
    name       TEXT NOT NULL DEFAULT '',
    tiers      TEXT NOT NULL DEFAULT '[]',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS user_activity (
    id             TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
    date           TEXT NOT NULL,
    event_type     TEXT NOT NULL,
    external_id    TEXT NOT NULL,
    media_type     TEXT,
    progress_end   INTEGER,
    progress_start INTEGER,
    timestamp      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS user_library (
    id                TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    external_id       TEXT NOT NULL UNIQUE,
    finished_at       TEXT,
    is_favorite       INTEGER DEFAULT 0,
    is_platinum       INTEGER DEFAULT 0,
    minutes_spent     REAL DEFAULT 0,
    notes             TEXT,
    progress          REAL DEFAULT 0,
    progress_2        REAL DEFAULT 0,
    rating            REAL,
    selected_platform TEXT,
    selected_version  TEXT,
    started_at        TEXT,
    status            TEXT DEFAULT 'planning',
    tags              TEXT,
    type              TEXT NOT NULL,
    user_id           TEXT NOT NULL,
    added_at          TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at        TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS user_list_items (
    external_id TEXT NOT NULL,
    list_key    TEXT NOT NULL,
    position    INTEGER NOT NULL DEFAULT 0,
    added_at    TEXT DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (list_key, external_id)
);
-- get_all_user_lists' per-list preview subquery and get_list_items_full both
-- filter by list_key then order by position — the PK alone still needs a
-- sort after the point lookup, this index doesn't.
CREATE INDEX IF NOT EXISTS idx_user_list_items_list_key_position ON user_list_items(list_key, position);

CREATE TABLE IF NOT EXISTS user_lists (
    key         TEXT PRIMARY KEY,
    description TEXT NOT NULL DEFAULT '',
    is_fav      INTEGER NOT NULL DEFAULT 0,
    name        TEXT NOT NULL DEFAULT '',
    created_at  TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at  TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS user_profile (
    id                INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    avatar_data       TEXT NOT NULL DEFAULT '',
    banner_data       TEXT NOT NULL DEFAULT '',
    bio               TEXT NOT NULL DEFAULT '',
    custom_color      TEXT NOT NULL DEFAULT '#c084fc',
    display_name      TEXT NOT NULL DEFAULT '',
    dynamic_theme     INTEGER NOT NULL DEFAULT 0,
    font              TEXT NOT NULL DEFAULT '',
    language          TEXT NOT NULL DEFAULT 'es',
    rating_system     TEXT NOT NULL DEFAULT '5-star',
    source_avatar_url TEXT NOT NULL DEFAULT '',
    source_name       TEXT NOT NULL DEFAULT '',
    source_username   TEXT NOT NULL DEFAULT '',
    theme             TEXT NOT NULL DEFAULT 'nebula',
    created_at        TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at        TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS user_sessions (
    service    TEXT PRIMARY KEY,
    token      TEXT NOT NULL DEFAULT '',
    username   TEXT,
    saved_at   TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
";

// ─── FAV seeds ────────────────────────────────────────────────────────────────

const FAV_SEEDS: &[(&str, &str)] = &[
    ("anime_fav",      "Anime favoritos"),
    ("manga_fav",      "Manga favoritos"),
    ("multimedia_fav", "Multimedia favoritos"),
    ("game_fav",       "Juegos favoritos"),
    ("vnovel_fav",     "Novelas visuales favoritas"),
    ("lnovel_fav",     "Novelas ligeras favoritas"),
    ("series_fav",     "Series favoritas"),
    ("movie_fav",      "Películas favoritas"),
    ("book_fav",       "Libros favoritos"),
    ("character_fav",  "Personajes favoritos"),
];

// ─── Seed fav lists ───────────────────────────────────────────────────────────

pub fn seed_fav_lists(db: &MetadeaDb) {
    let conn = match db.conn.lock() { Ok(c) => c, Err(_) => return };
    for (key, name) in FAV_SEEDS {
        let _ = conn.execute(
            "INSERT OR IGNORE INTO user_lists (key, name, is_fav) VALUES (?1, ?2, 1)",
            rusqlite::params![key, name],
        );
    }
}
