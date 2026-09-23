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

// ─── IN (...) chunking ────────────────────────────────────────────────────────
// Older SQLite builds cap bound variables at 999 per statement, so a caller
// with an unbounded id list splits it with `ids.chunks(SQL_IN_CHUNK)` and
// merges the per-chunk results.

pub(crate) const SQL_IN_CHUNK: usize = 500;

pub(crate) fn sql_placeholders(count: usize) -> String {
    vec!["?"; count].join(",")
}

// ─── Unified DB handle ────────────────────────────────────────────────────────

pub struct MetadeaDb {
    pub conn: Mutex<Connection>,
}

impl MetadeaDb {
    pub fn open(path: &std::path::Path) -> SqlResult<Self> {
        Self::from_connection(Connection::open(path)?)
    }

    // Same schema/migrations/views/pragmas as a real install, on an
    // in-memory connection — lets tests exercise the exact query shapes the
    // commands run (views included) without touching disk.
    #[cfg(test)]
    pub(crate) fn open_in_memory() -> SqlResult<Self> {
        Self::from_connection(Connection::open_in_memory()?)
    }

    fn from_connection(conn: Connection) -> SqlResult<Self> {
        ensure_base_schema(&conn)?;
        crate::migrations::run_migrations(&conn)?;
        // Shared "is this row hidden by a curator block" predicate, defined
        // once here instead of repeating "blocked_at IS NULL"/"IS NOT NULL"
        // in every query that joins against media_catalog — created after
        // run_migrations so blocked_at is guaranteed to exist by the time
        // these views reference it, even on a fresh upgrade's very first run.
        conn.execute_batch(
            "CREATE VIEW IF NOT EXISTS visible_media_catalog AS SELECT * FROM media_catalog WHERE blocked_at IS NULL;
             CREATE VIEW IF NOT EXISTS blocked_media_catalog AS SELECT * FROM media_catalog WHERE blocked_at IS NOT NULL;"
        )?;
        apply_connection_pragmas(&conn)?;
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

// Per-connection tuning, applied once at open. WAL + synchronous=NORMAL is
// the documented safe pairing (durable against app crashes, only a power
// loss can drop the last transactions); the rest trade a bounded amount of
// memory for fewer page reads on the profile's first paint, which walks
// media_catalog/user_library/media_relations in full: a 32 MB page cache
// (negative cache_size is in KiB) holds the whole working set, mmap lets
// reads skip the copy into that cache, and temp_store=MEMORY keeps the
// sort/IN-list scratch tables of those queries off disk.
pub(crate) fn apply_connection_pragmas(conn: &Connection) -> SqlResult<()> {
    conn.execute("PRAGMA foreign_keys = ON", [])?;
    conn.pragma_update(None, "journal_mode", "WAL")?;
    conn.pragma_update(None, "synchronous", "NORMAL")?;
    conn.pragma_update(None, "cache_size", -32000)?;
    conn.pragma_update(None, "mmap_size", 67_108_864)?;
    conn.pragma_update(None, "temp_store", "MEMORY")?;
    Ok(())
}

#[cfg(test)]
mod pragma_tests {
    use super::apply_connection_pragmas;
    use rusqlite::Connection;

    fn pragma_i64(conn: &Connection, name: &str) -> i64 {
        conn.pragma_query_value(None, name, |r| r.get(0)).unwrap()
    }

    #[test]
    fn open_applies_every_connection_pragma() {
        // A file-backed connection: journal_mode=WAL and mmap_size are
        // reported as "memory"/0 on an in-memory database, so those two can
        // only be verified against a real file.
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let path = std::env::temp_dir().join(format!("metadea-pragmas-{unique}.db"));
        {
            let conn = Connection::open(&path).unwrap();
            apply_connection_pragmas(&conn).unwrap();
            assert_eq!(pragma_i64(&conn, "foreign_keys"), 1);
            let journal: String = conn.pragma_query_value(None, "journal_mode", |r| r.get(0)).unwrap();
            assert_eq!(journal.to_lowercase(), "wal");
            // synchronous: 0=OFF 1=NORMAL 2=FULL; temp_store: 0=DEFAULT 1=FILE 2=MEMORY
            assert_eq!(pragma_i64(&conn, "synchronous"), 1);
            assert_eq!(pragma_i64(&conn, "cache_size"), -32000);
            assert_eq!(pragma_i64(&conn, "mmap_size"), 67_108_864);
            assert_eq!(pragma_i64(&conn, "temp_store"), 2);
        }
        for suffix in ["", "-wal", "-shm"] {
            let _ = std::fs::remove_file(format!("{}{suffix}", path.display()));
        }
    }

    #[test]
    fn the_shared_open_path_applies_the_pragmas_too() {
        let db = super::MetadeaDb::open_in_memory().unwrap();
        let conn = db.conn.lock().unwrap();
        assert_eq!(pragma_i64(&conn, "foreign_keys"), 1);
        assert_eq!(pragma_i64(&conn, "synchronous"), 1);
        assert_eq!(pragma_i64(&conn, "cache_size"), -32000);
        assert_eq!(pragma_i64(&conn, "temp_store"), 2);
    }
}

// Base schema for a brand-new database plus the migrations ledger; every
// CREATE is IF NOT EXISTS, so this is a no-op on an existing one. Shared
// with the migrations module's tests so they start from the same shape a
// fresh install does.
pub(crate) fn ensure_base_schema(conn: &Connection) -> SqlResult<()> {
    conn.execute_batch(METADEA_SCHEMA)?;
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS schema_migrations (
            version    INTEGER PRIMARY KEY,
            applied_at TEXT DEFAULT CURRENT_TIMESTAMP
        );"
    )
}

pub(crate) fn current_schema_version(conn: &Connection) -> i64 {
    conn.query_row(
        "SELECT COALESCE(MAX(version), 0) FROM schema_migrations",
        [],
        |r| r.get(0),
    ).unwrap_or(0)
}

pub(crate) fn mark_migration(conn: &Connection, version: i64) -> SqlResult<()> {
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

#[cfg(test)]
mod union_find_tests {
    use super::{union_find_merge, union_find_root};
    use std::collections::HashMap;

    #[test]
    fn root_of_unknown_key_is_itself_and_does_not_insert() {
        let mut parent = HashMap::new();
        assert_eq!(union_find_root(&mut parent, "a"), "a");
        assert!(parent.is_empty());
    }

    #[test]
    fn merge_registers_both_keys_and_points_first_root_at_second() {
        let mut parent = HashMap::new();
        union_find_merge(&mut parent, "a", "b");
        assert_eq!(parent.len(), 2);
        assert_eq!(union_find_root(&mut parent, "a"), "b");
        assert_eq!(union_find_root(&mut parent, "b"), "b");
    }

    #[test]
    fn merging_the_same_pair_twice_or_with_itself_is_a_no_op() {
        let mut parent = HashMap::new();
        union_find_merge(&mut parent, "a", "b");
        union_find_merge(&mut parent, "a", "b");
        union_find_merge(&mut parent, "b", "a");
        union_find_merge(&mut parent, "a", "a");
        assert_eq!(parent.len(), 2);
        assert_eq!(union_find_root(&mut parent, "a"), "b");
    }

    #[test]
    fn transitive_merges_share_one_root() {
        let mut parent = HashMap::new();
        union_find_merge(&mut parent, "a", "b");
        union_find_merge(&mut parent, "c", "d");
        assert_ne!(union_find_root(&mut parent, "a"), union_find_root(&mut parent, "c"));
        union_find_merge(&mut parent, "b", "c");
        let root = union_find_root(&mut parent, "a");
        for id in ["b", "c", "d"] {
            assert_eq!(union_find_root(&mut parent, id), root);
        }
    }

    #[test]
    fn root_lookup_compresses_the_path() {
        let mut parent: HashMap<String, String> = [("a", "b"), ("b", "c"), ("c", "c")]
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect();
        assert_eq!(union_find_root(&mut parent, "a"), "c");
        assert_eq!(parent["a"], "c");
        assert_eq!(parent["b"], "c");
    }
}

#[cfg(test)]
mod merge_fragmented_sagas_tests {
    use super::merge_fragmented_sagas;
    use rusqlite::Connection;

    fn conn() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE sagas (
                id TEXT PRIMARY KEY,
                description TEXT,
                name TEXT NOT NULL DEFAULT ''
             );
             CREATE TABLE saga_relations (
                media_external_id TEXT NOT NULL,
                saga_id TEXT NOT NULL,
                order_index REAL,
                PRIMARY KEY (media_external_id, saga_id)
             );
             CREATE TABLE media_relations (
                media_external_id TEXT NOT NULL,
                related_media_external_id TEXT NOT NULL,
                relation_type TEXT NOT NULL,
                type_label TEXT NOT NULL,
                PRIMARY KEY (media_external_id, related_media_external_id)
             );",
        )
        .unwrap();
        conn
    }

    fn relate(conn: &Connection, a: &str, b: &str, kind: &str) {
        conn.execute(
            "INSERT INTO media_relations (media_external_id, related_media_external_id, relation_type, type_label)
             VALUES (?1, ?2, ?3, '')",
            rusqlite::params![a, b, kind],
        )
        .unwrap();
    }

    fn saga(conn: &Connection, id: &str, name: &str) {
        conn.execute("INSERT INTO sagas (id, name) VALUES (?1, ?2)", rusqlite::params![id, name]).unwrap();
    }

    fn member(conn: &Connection, media: &str, saga_id: &str) {
        conn.execute(
            "INSERT INTO saga_relations (media_external_id, saga_id) VALUES (?1, ?2)",
            rusqlite::params![media, saga_id],
        )
        .unwrap();
    }

    fn saga_ids(conn: &Connection) -> Vec<String> {
        let mut stmt = conn.prepare("SELECT id FROM sagas ORDER BY id").unwrap();
        stmt.query_map([], |r| r.get(0)).unwrap().map(|r| r.unwrap()).collect()
    }

    fn saga_name(conn: &Connection, id: &str) -> String {
        conn.query_row("SELECT name FROM sagas WHERE id = ?1", [id], |r| r.get(0)).unwrap()
    }

    fn memberships(conn: &Connection) -> Vec<(String, String)> {
        let mut stmt = conn
            .prepare("SELECT media_external_id, saga_id FROM saga_relations ORDER BY media_external_id, saga_id")
            .unwrap();
        stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?))).unwrap().map(|r| r.unwrap()).collect()
    }

    fn pair(a: &str, b: &str) -> (String, String) {
        (a.to_string(), b.to_string())
    }

    #[test]
    fn does_nothing_without_prequel_or_sequel_relations() {
        let conn = conn();
        saga(&conn, "A", "Foo");
        member(&conn, "A", "A");
        relate(&conn, "A", "B", "ALTERNATIVE");
        merge_fragmented_sagas(&conn).unwrap();
        assert_eq!(saga_ids(&conn), vec!["A"]);
        assert_eq!(memberships(&conn), vec![pair("A", "A")]);
    }

    #[test]
    fn merges_fragments_into_lexicographically_smallest_id_and_keeps_the_name() {
        let conn = conn();
        saga(&conn, "A", "Foo");
        saga(&conn, "B", "");
        member(&conn, "A", "A");
        member(&conn, "B", "B");
        relate(&conn, "A", "B", "SEQUEL");
        merge_fragmented_sagas(&conn).unwrap();
        assert_eq!(saga_ids(&conn), vec!["A"]);
        assert_eq!(saga_name(&conn, "A"), "Foo");
        assert_eq!(memberships(&conn), vec![pair("A", "A"), pair("B", "A")]);
    }

    #[test]
    fn adopts_a_name_from_a_non_canonical_fragment() {
        let conn = conn();
        saga(&conn, "A", "");
        saga(&conn, "B", "Bar");
        member(&conn, "A", "A");
        member(&conn, "B", "B");
        relate(&conn, "B", "A", "PREQUEL");
        merge_fragmented_sagas(&conn).unwrap();
        assert_eq!(saga_ids(&conn), vec!["A"]);
        assert_eq!(saga_name(&conn, "A"), "Bar");
    }

    #[test]
    fn creates_the_canonical_saga_when_no_row_exists_yet() {
        let conn = conn();
        relate(&conn, "A", "B", "SEQUEL");
        relate(&conn, "B", "C", "SEQUEL");
        merge_fragmented_sagas(&conn).unwrap();
        assert_eq!(saga_ids(&conn), vec!["A"]);
        assert_eq!(saga_name(&conn, "A"), "");
        assert_eq!(memberships(&conn), vec![pair("A", "A"), pair("B", "A"), pair("C", "A")]);
    }

    #[test]
    fn a_self_relation_alone_is_a_singleton_and_is_skipped() {
        let conn = conn();
        saga(&conn, "A", "Solo");
        relate(&conn, "A", "A", "SEQUEL");
        merge_fragmented_sagas(&conn).unwrap();
        assert_eq!(saga_ids(&conn), vec!["A"]);
        assert!(memberships(&conn).is_empty());
    }

    #[test]
    fn keeps_a_foreign_saga_that_still_has_other_members() {
        let conn = conn();
        saga(&conn, "X", "Other");
        member(&conn, "A", "X");
        member(&conn, "Z", "X");
        relate(&conn, "A", "B", "SEQUEL");
        merge_fragmented_sagas(&conn).unwrap();
        assert_eq!(saga_ids(&conn), vec!["A", "X"]);
        assert_eq!(saga_name(&conn, "A"), "");
        assert_eq!(memberships(&conn), vec![pair("A", "A"), pair("B", "A"), pair("Z", "X")]);
    }

    #[test]
    fn independent_components_stay_separate() {
        let conn = conn();
        relate(&conn, "A", "B", "SEQUEL");
        relate(&conn, "C", "D", "SEQUEL");
        merge_fragmented_sagas(&conn).unwrap();
        assert_eq!(saga_ids(&conn), vec!["A", "C"]);
        assert_eq!(
            memberships(&conn),
            vec![pair("A", "A"), pair("B", "A"), pair("C", "C"), pair("D", "C")]
        );
    }
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
CREATE TABLE IF NOT EXISTS actors (
    id          TEXT PRIMARY KEY,
    external_id TEXT UNIQUE NOT NULL,
    name        TEXT NOT NULL DEFAULT '',
    name_native TEXT,
    image_url   TEXT,
    created_at  TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at  TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS actors_external_idx ON actors(external_id);

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
    gender       TEXT,
    age          TEXT,
    blood_type   TEXT,
    dob_year     INTEGER,
    dob_month    INTEGER,
    dob_day      INTEGER,
    created_at   TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at   TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS characters_external_idx ON characters(external_id);

-- Shared between voice actors (role='voice', sourced from AniList Staff) and
-- live-action actors (role='actor', e.g. TMDB) — see actors' own doc comment.
CREATE TABLE IF NOT EXISTS character_actors (
    actor_external_id     TEXT NOT NULL,
    character_external_id TEXT NOT NULL,
    role                  TEXT,
    language              TEXT,
    added_at              TEXT DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (actor_external_id, character_external_id),
    FOREIGN KEY (actor_external_id) REFERENCES actors(external_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS companies (
    external_id TEXT PRIMARY KEY,
    name        TEXT NOT NULL DEFAULT '',
    logo_url    TEXT,
    created_at  TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at  TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS character_appearances (
    character_external_id TEXT NOT NULL,
    character_name        TEXT,
    media_external_id     TEXT NOT NULL,
    relation_type         TEXT,
    position              INTEGER,
    added_at              TEXT DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (character_external_id, media_external_id)
);

CREATE TABLE IF NOT EXISTS character_merges (
    source_character_external_id TEXT PRIMARY KEY,
    canonical_character_external_id TEXT NOT NULL,
    added_at TEXT DEFAULT CURRENT_TIMESTAMP
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

-- Last time a live scan (scan_all_games) actually found this (launcher,
-- link_key) installed — lets prune_stale_game_links (folders.rs) tell still
-- installed from uninstalled a while ago, and clean up the corresponding
-- local_game_links row instead of it lingering forever.
CREATE TABLE IF NOT EXISTS local_games_seen (
    launcher     TEXT NOT NULL,
    link_key     TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    name         TEXT NOT NULL DEFAULT '',
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
    banners_csv          TEXT DEFAULT '',
    blocked_at           TEXT,
    country_code         TEXT,
    cover_url            TEXT,
    favorites_count      INTEGER DEFAULT 0,
    format               TEXT DEFAULT '',
    genres_csv           TEXT DEFAULT '',
    genres_tag_csv       TEXT DEFAULT '',
    parent_id            TEXT,
    platforms_csv        TEXT DEFAULT '',
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
    synopsis             TEXT,
    time_length          INTEGER,
    title_english        TEXT,
    title_main           TEXT DEFAULT '',
    title_native         TEXT DEFAULT '',
    title_romaji         TEXT DEFAULT '',
    total_count          INTEGER,
    total_count_2        INTEGER,
    issue_source_id      TEXT,
    episode_source_id    TEXT,
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
    name_native      TEXT,
    aliases_csv      TEXT,
    biography        TEXT,
    birth_date       TEXT,
    death_date       TEXT,
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

-- role distinguishes developer/publisher (games only for now) — part of the
-- PK since a self-published game's own company is legitimately both.
CREATE TABLE IF NOT EXISTS media_by_company (
    company_external_id TEXT NOT NULL,
    media_external_id    TEXT NOT NULL,
    role                  TEXT NOT NULL,
    added_at              TEXT DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (media_external_id, company_external_id, role),
    FOREIGN KEY (company_external_id) REFERENCES companies(external_id) ON DELETE CASCADE
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

-- Purely local negative cache — see migration 47's comment.
CREATE TABLE IF NOT EXISTS anilist_pre_sequel (
    external_id TEXT PRIMARY KEY,
    checked_at  TEXT DEFAULT CURRENT_TIMESTAMP
);

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
    rating_2          REAL,
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
    is_private  INTEGER NOT NULL DEFAULT 0,
    is_ranked   INTEGER NOT NULL DEFAULT 0,
    list_type   TEXT NOT NULL DEFAULT 'media',
    name        TEXT NOT NULL DEFAULT '',
    created_at  TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at  TEXT DEFAULT CURRENT_TIMESTAMP
);

-- ── Social: cached OTHER users' downloaded profile data (never your own) ──
-- Mirrors user_library/user_activity/monthly_history/user_lists/
-- user_list_items, keyed additionally by social_user_id since these hold
-- data for many different visited profiles at once. Fully replaced (DELETE
-- + re-INSERT scoped to one social_user_id) by hydrate_social_profile every
-- time a profile is (re)synced — see social_profile.rs.
CREATE TABLE IF NOT EXISTS social_user_list (
    social_user_id TEXT NOT NULL,
    external_id    TEXT NOT NULL,
    rating         REAL,
    started_at     TEXT,
    finished_at    TEXT,
    notes          TEXT,
    tags           TEXT,
    status         TEXT,
    progress       REAL,
    PRIMARY KEY (social_user_id, external_id)
);

CREATE TABLE IF NOT EXISTS social_user_activity (
    social_user_id TEXT NOT NULL,
    external_id    TEXT NOT NULL,
    media_type     TEXT,
    event_type     TEXT NOT NULL,
    progress_start INTEGER,
    progress_end   INTEGER,
    date           TEXT,
    timestamp      TEXT NOT NULL,
    PRIMARY KEY (social_user_id, timestamp, external_id)
);

CREATE TABLE IF NOT EXISTS social_monthly_history (
    social_user_id TEXT NOT NULL,
    external_id    TEXT NOT NULL,
    month          TEXT NOT NULL,
    position       INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (social_user_id, month, external_id)
);
CREATE INDEX IF NOT EXISTS idx_social_monthly_history ON social_monthly_history(social_user_id, month, position);

CREATE TABLE IF NOT EXISTS social_user_lists (
    social_user_id TEXT NOT NULL,
    key            TEXT NOT NULL,
    name           TEXT NOT NULL DEFAULT '',
    description    TEXT NOT NULL DEFAULT '',
    is_fav         INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (social_user_id, key)
);

CREATE TABLE IF NOT EXISTS social_user_list_items (
    social_user_id TEXT NOT NULL,
    list_key       TEXT NOT NULL,
    external_id    TEXT NOT NULL,
    position       INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (social_user_id, list_key, external_id)
);
CREATE INDEX IF NOT EXISTS idx_social_user_list_items ON social_user_list_items(social_user_id, list_key, position);

CREATE TABLE IF NOT EXISTS user_profile (
    id                INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    avatar_data       TEXT NOT NULL DEFAULT '',
    banner_data       TEXT NOT NULL DEFAULT '',
    share_avatar_data TEXT NOT NULL DEFAULT '',
    bio               TEXT NOT NULL DEFAULT '',
    custom_color      TEXT NOT NULL DEFAULT '#c084fc',
    display_name      TEXT NOT NULL DEFAULT '',
    dynamic_theme     INTEGER NOT NULL DEFAULT 0,
    font              TEXT NOT NULL DEFAULT '',
    language          TEXT NOT NULL DEFAULT 'es',
    rating_system     TEXT NOT NULL DEFAULT '5-star',
    server_user_id    TEXT,
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
