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
        conn.execute("PRAGMA foreign_keys = ON", [])?;
        conn.pragma_update(None, "journal_mode", &"WAL")?;
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
    value      TEXT NOT NULL DEFAULT '',
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
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
    list_name   TEXT NOT NULL,
    file_name   TEXT NOT NULL,
    bg_size     REAL NOT NULL DEFAULT 100,
    pos_x       REAL NOT NULL DEFAULT 50,
    pos_y       REAL NOT NULL DEFAULT 50,
    updated_at  TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS characters (
    id           TEXT PRIMARY KEY,
    external_id  TEXT UNIQUE NOT NULL,
    name         TEXT NOT NULL DEFAULT '',
    name_native  TEXT,
    aliases_csv  TEXT DEFAULT '',
    biography    TEXT,
    image_url    TEXT,
    reaction     TEXT,
    created_at   TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at   TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS characters_external_idx ON characters(external_id);

CREATE TABLE IF NOT EXISTS character_appearances (
    character_external_id TEXT NOT NULL,
    media_external_id     TEXT NOT NULL,
    relation_type         TEXT,
    character_name        TEXT,
    added_at              TEXT DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (character_external_id, media_external_id)
);

CREATE TABLE IF NOT EXISTS local_folders (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    label      TEXT NOT NULL DEFAULT '',
    path       TEXT NOT NULL DEFAULT '',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS local_game_links (
    launcher    TEXT NOT NULL,
    link_key    TEXT NOT NULL DEFAULT '',
    external_id TEXT NOT NULL,
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
    folder_path  TEXT NOT NULL,
    episode_count INTEGER DEFAULT 0,
    updated_at   TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS media_catalog (
    id                   TEXT PRIMARY KEY,
    external_id          TEXT UNIQUE NOT NULL,
    parent_id            TEXT,
    type                 TEXT,
    format               TEXT DEFAULT '',
    source               TEXT DEFAULT '',
    title_main           TEXT DEFAULT '',
    title_romaji         TEXT DEFAULT '',
    title_native         TEXT DEFAULT '',
    synopsis             TEXT,
    cover_url            TEXT,
    banners_csv          TEXT DEFAULT '',
    release_year         INTEGER,
    release_month        INTEGER,
    release_day          INTEGER,
    time_length          INTEGER,
    status               TEXT,
    score_global         REAL,
    favorites_count      INTEGER DEFAULT 0,
    ratings_count        INTEGER DEFAULT 0,
    total_count          INTEGER,
    total_count_2        INTEGER,
    genres_csv           TEXT DEFAULT '',
    genres_tag_csv       TEXT DEFAULT '',
    platforms_csv        TEXT DEFAULT '',
    shop_links_csv       TEXT DEFAULT '',
    companies_cache_csv  TEXT DEFAULT '',
    authors_csv          TEXT DEFAULT '',
    last_synced_at       TEXT,
    sync_failed_count    INTEGER DEFAULT 0,
    last_sync_error      TEXT,
    created_at           TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at           TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS media_catalog_external_idx ON media_catalog(external_id);

CREATE TABLE IF NOT EXISTS media_author (
    external_id      TEXT PRIMARY KEY,
    name             TEXT NOT NULL,
    author_image_url TEXT,
    author_url       TEXT,
    created_at       TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at       TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS media_by_author (
    media_external_id  TEXT NOT NULL,
    author_external_id TEXT NOT NULL,
    role               TEXT,
    PRIMARY KEY (media_external_id, author_external_id),
    FOREIGN KEY (author_external_id) REFERENCES media_author(external_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS sagas (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL DEFAULT '',
    description TEXT,
    created_at  TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at  TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS saga_relations (
    media_external_id TEXT NOT NULL,
    saga_id           TEXT NOT NULL,
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

CREATE TABLE IF NOT EXISTS media_saga_groups (
    media_external_id TEXT NOT NULL PRIMARY KEY,
    group_name        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS monthly_history (
    month        TEXT NOT NULL,
    external_id  TEXT NOT NULL,
    position     INTEGER NOT NULL DEFAULT 0,
    added_at     TEXT DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (month, external_id)
);
-- read_monthly_history orders by (month DESC, position) — the PK only
-- covers point lookups on month, not this ordering, so it still needs a
-- sort without this.
CREATE INDEX IF NOT EXISTS idx_monthly_history_month_position ON monthly_history(month, position);

CREATE TABLE IF NOT EXISTS tier_list_items (
    tier_list_id TEXT NOT NULL,
    external_id  TEXT NOT NULL,
    tier_key     TEXT NOT NULL DEFAULT 'pool',
    position     INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (tier_list_id, external_id)
);

CREATE TABLE IF NOT EXISTS tier_lists (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL DEFAULT '',
    list_type  TEXT NOT NULL DEFAULT 'works',
    tiers      TEXT NOT NULL DEFAULT '[]',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS user_activity (
    id             TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
    date           TEXT NOT NULL,
    external_id    TEXT NOT NULL,
    event_type     TEXT NOT NULL,
    media_type     TEXT,
    progress_start INTEGER,
    progress_end   INTEGER,
    timestamp      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS user_library (
    id                TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    user_id           TEXT NOT NULL,
    external_id       TEXT NOT NULL UNIQUE,
    type              TEXT NOT NULL,
    status            TEXT DEFAULT 'planning',
    rating            REAL,
    progress          REAL DEFAULT 0,
    progress_2        REAL DEFAULT 0,
    minutes_spent     REAL DEFAULT 0,
    is_favorite       INTEGER DEFAULT 0,
    is_platinum       INTEGER DEFAULT 0,
    tags              TEXT,
    notes             TEXT,
    added_at          TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at        TEXT DEFAULT CURRENT_TIMESTAMP,
    selected_platform TEXT,
    selected_version  TEXT,
    started_at        TEXT,
    finished_at       TEXT
);

CREATE TABLE IF NOT EXISTS user_list_items (
    list_key    TEXT NOT NULL,
    external_id TEXT NOT NULL,
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
    name        TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    is_fav      INTEGER NOT NULL DEFAULT 0,
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
