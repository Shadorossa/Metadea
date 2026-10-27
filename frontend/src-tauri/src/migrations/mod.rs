// Schema migrations, one `m<N>` function per version, applied in order by
// `run_migrations`. Each version runs inside its own transaction together
// with its schema_migrations row, so a failure rolls the whole step back
// (DROP TABLE + RENAME included) and it is simply retried on the next
// launch instead of leaving a half-applied version marked as done.
//
// Search this file for "DROP COLUMN" to find every column this app has
// ever actually removed (as opposed to just stopped reading/writing).
use rusqlite::{Connection, Result as SqlResult, Transaction};

use crate::db::{current_schema_version, mark_migration};
mod aniskip;
mod anime_filler;
mod catalog_id_collision_repair;
mod character_repairs;
mod community_sync_cursor;
mod company_cache;
mod continue_watching;
mod emulator_screenshots;
mod game_sessions;
mod jukebox;
mod legacy_sequel_aliases;
mod mal;
mod plugins;
mod reconsumption;
mod relation_label_repair;
mod relation_repairs;
mod remove_event_type;
mod saga_repairs;
mod sakuga;
mod schema_repairs;
mod social_profile_parity;
mod tier_list_board;
mod yearly_bingo;
mod yearly_challenge;

pub(crate) mod retro_achievements;
pub(crate) mod epub_reader;
pub(crate) mod textless_cover_cache;
pub(crate) mod comicvine_arc_cache;
pub(crate) mod time_to_beat_cache;
pub(crate) mod wallpaper_cache;

type Migration = fn(&Transaction) -> SqlResult<()>;

pub(crate) const MIGRATIONS: &[(i64, Migration)] = &[
    (1, m1), (2, m2), (3, m3), (4, m4),
    (5, relation_repairs::dedupe_relations_per_pair),
    (6, m6), (7, m7),
    (8, relation_repairs::backfill_reciprocal_edges),
    (9, relation_repairs::canonicalize_type_labels),
    (10, m10), (11, m11), (12, m12), (13, m13), (14, m14), (15, m15),
    // Migration 16 was reverted before release — see m17's comment.
    (17, m17), (18, m18), (19, m19),
    (20, relation_repairs::fix_inverted_adaptation_reciprocal),
    (21, saga_repairs::drop_superseded_anchor_sagas),
    (22, saga_repairs::merge_fragmented),
    (23, m23), (24, m24), (25, m25), (26, m26),
    (27, relation_repairs::fix_adaptation_reciprocal_to_source),
    (28, m28), (29, m29), (30, m30), (31, m31), (32, m32),
    (33, character_repairs::refile_light_novel_appearances),
    (34, m34), (35, m35), (36, m36),
    (37, schema_repairs::add_missing_custom_color),
    (38, m38), (39, m39),
    (40, character_repairs::unify_character_ids),
    (41, m41), (42, m42), (43, m43), (44, m44), (45, m45), (46, m46), (47, m47),
    (48, m48), (49, m49), (50, m50),
    (51, character_repairs::unify_character_ids),
    (52, m52), (53, m53), (54, m54),
    (55, saga_repairs::rename_after_earliest_member),
    (56, m56),
    (57, schema_repairs::recreate_media_theme_with_slug),
    (58, m58), (59, m59), (60, m60), (61, m61), (62, m62),
    (63, saga_repairs::rename_after_earliest_member),
    (64, m64), (65, m65), (66, m66), (67, m67), (68, m68), (69, m69),
    (70, aniskip::add_mal_id_and_aniskip_cache),
    (71, retro_achievements::migrate),
    (72, epub_reader::migrate),
    (73, reconsumption::migrate),
    (74, jukebox::migrate),
    (75, mal::migrate),
    (76, emulator_screenshots::migrate),
    (77, continue_watching::migrate),
    (78, company_cache::migrate),
    (79, yearly_challenge::migrate),
    (80, social_profile_parity::migrate),
    (81, textless_cover_cache::migrate),
    (82, tier_list_board::migrate),
    (83, yearly_bingo::migrate),
    (84, comicvine_arc_cache::migrate),
    (85, time_to_beat_cache::migrate),
    (86, anime_filler::migrate),
    (87, game_sessions::migrate),
    (88, wallpaper_cache::migrate),
    (89, plugins::migrate),
    (90, sakuga::migrate),
    (91, remove_event_type::migrate),
    (92, crate::vestigial_cleanup::drop_unused_tables_and_lists),
    (93, community_sync_cursor::migrate),
    (94, catalog_id_collision_repair::migrate),
    (95, relation_label_repair::migrate),
    (96, legacy_sequel_aliases::migrate),
];

pub(crate) fn run_migrations(conn: &Connection) -> SqlResult<()> {
    run(conn, MIGRATIONS)
}

// Test fixture for one migration: a database migrated up to (not
// including) `version`, to seed the rows that version has to deal with.
#[cfg(test)]
fn db_before(version: i64) -> Connection {
    let conn = Connection::open_in_memory().unwrap();
    crate::db::ensure_base_schema(&conn).unwrap();
    let index = MIGRATIONS.iter().position(|(v, _)| *v == version).unwrap();
    run(&conn, &MIGRATIONS[..index]).unwrap();
    conn
}

// Applies `version` alone on a db_before(version) database.
#[cfg(test)]
fn apply(conn: &Connection, version: i64) {
    let index = MIGRATIONS.iter().position(|(v, _)| *v == version).unwrap();
    run(conn, &MIGRATIONS[..=index]).unwrap();
}

fn run(conn: &Connection, migrations: &[(i64, Migration)]) -> SqlResult<()> {
    let current = current_schema_version(conn);
    let latest = migrations.iter().map(|(v, _)| *v).max().unwrap_or(0);
    if current > latest {
        // An older binary against a database a newer Metadea already
        // migrated further: refusing beats silently running with tables
        // and columns this build has never heard of.
        return Err(rusqlite::Error::SqliteFailure(
            rusqlite::ffi::Error::new(rusqlite::ffi::SQLITE_ERROR),
            Some(format!(
                "This database was created by a newer Metadea version (schema {current}, this build supports up to {latest}). Update Metadea to open it."
            )),
        ));
    }
    for (version, migrate) in migrations {
        if *version <= current {
            continue;
        }
        let tx = conn.unchecked_transaction()?;
        migrate(&tx)?;
        mark_migration(&tx, *version)?;
        tx.commit()?;
    }
    Ok(())
}

fn exec_ignoring(tx: &Transaction, sql: &str, expected: &[&str]) -> SqlResult<()> {
    // Schema errors surface at prepare time (SqlInputError) for ALTER TABLE
    // and at step time (SqliteFailure) for DML — both carry the message.
    match tx.execute(sql, []) {
        Ok(_) => Ok(()),
        Err(rusqlite::Error::SqliteFailure(_, Some(msg)))
        | Err(rusqlite::Error::SqlInputError { msg, .. })
            if expected.iter().any(|needle| msg.contains(needle)) => Ok(()),
        Err(e) => Err(e),
    }
}

// ALTER TABLE ... ADD COLUMN idempotency guard: a fresh database's base
// schema (METADEA_SCHEMA) already carries most columns older installs gain
// through these migrations, so "duplicate column name" is expected there
// and is the only error swallowed.
fn add_column(tx: &Transaction, sql: &str) -> SqlResult<()> {
    exec_ignoring(tx, sql, &["duplicate column name"])
}

// ALTER TABLE ... DROP COLUMN counterpart: a fresh database's base schema
// never had the column at all, so "no such column" is expected there.
fn drop_column(tx: &Transaction, sql: &str) -> SqlResult<()> {
    exec_ignoring(tx, sql, &["no such column"])
}

fn m1(tx: &Transaction) -> SqlResult<()> {
    add_column(tx, "ALTER TABLE media_catalog ADD COLUMN authors_csv TEXT DEFAULT ''")?;
    add_column(tx, "ALTER TABLE media_catalog ADD COLUMN shop_links_csv TEXT DEFAULT ''")
}

fn m2(tx: &Transaction) -> SqlResult<()> {
    add_column(tx, "ALTER TABLE characters ADD COLUMN name_native TEXT")?;
    add_column(tx, "ALTER TABLE characters ADD COLUMN aliases_csv TEXT DEFAULT ''")?;
    add_column(tx, "ALTER TABLE characters ADD COLUMN biography TEXT")
}

fn m3(tx: &Transaction) -> SqlResult<()> {
    add_column(tx, "ALTER TABLE user_profile ADD COLUMN rating_system TEXT NOT NULL DEFAULT '5-star'")
}

fn m4(tx: &Transaction) -> SqlResult<()> {
    add_column(tx, "ALTER TABLE character_appearances ADD COLUMN character_name TEXT")
}

fn m6(tx: &Transaction) -> SqlResult<()> {
    // Custom favorite images used to store an arbitrary remote image_url
    // read straight from the DB at render time — broken in release
    // builds whenever that URL wasn't reachable/allowed. Now the actual
    // image bytes are downloaded once and saved under the app's own
    // data dir (user_metadata/custom_image/<list_name>/<file_name>), so
    // rendering never depends on network/CSP again. Old rows point at
    // URLs, not files, so they can't be migrated in-place — drop and
    // let the user re-pick their custom crops.
    tx.execute_batch(
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
    )
}

fn m7(tx: &Transaction) -> SqlResult<()> {
    // Separate, append-only table for "when did I watch/read episode N"
    // — deliberately not touching user_library (which only tracks the
    // current progress number, not a per-episode timeline) so this can
    // grow freely without bloating the row every progress edit updates.
    tx.execute_batch(
        "CREATE TABLE IF NOT EXISTS episode_history (
            id             TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
            external_id    TEXT NOT NULL,
            episode_number REAL NOT NULL,
            watched_at     TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
         );
         CREATE INDEX IF NOT EXISTS idx_episode_history_external_id
            ON episode_history(external_id);"
    )
}

fn m10(tx: &Transaction) -> SqlResult<()> {
    // Set once by PrEditorModal (the "Edit Collaborative Catalog Entry"
    // flow) on save — a live API resync checks this before touching an
    // entry's relations, so a manual deletion/reorder there can't get
    // silently re-added or reshuffled by the next scheduled resync (the
    // live provider has no idea the removal was deliberate; it just
    // reports the same relation again).
    add_column(tx, "ALTER TABLE media_catalog ADD COLUMN manually_edited_at TEXT")
}

fn m11(tx: &Transaction) -> SqlResult<()> {
    // Set via PrEditorModal to reserve an external_id (so it can never be
    // re-added as "new" from a live search result) while hiding the row
    // itself everywhere else — search, relations, saga chains, browse
    // lists — for remasters/editions the user considers noise. The row
    // itself is never deleted, only excluded from every read path that
    // isn't a direct "does this id already exist" lookup.
    add_column(tx, "ALTER TABLE media_catalog ADD COLUMN blocked_at TEXT")
}

fn m12(tx: &Transaction) -> SqlResult<()> {
    // Renamed for a clearer, consistent name alongside media_relations/
    // media_by_author — an install that already created staff_appearances
    // (before this rename) gets its existing rows carried over; a fresh
    // install never had the old name, so METADEA_SCHEMA's own
    // `CREATE TABLE IF NOT EXISTS media_staff_relation` above already
    // covers it and this is a silent no-op there. (METADEA_SCHEMA runs
    // before migrations, so the new name may already exist as well.)
    exec_ignoring(
        tx,
        "ALTER TABLE staff_appearances RENAME TO media_staff_relation",
        &["no such table", "already another table"],
    )
}

fn m13(tx: &Transaction) -> SqlResult<()> {
    // Every mapper computes this on each live fetch (the provider's own
    // page URL) but it was never persisted — the catalog-only fast path
    // shown on most visits (see mediaService.ts/needsResync) had no
    // column to read it back from, so the source logo/link flickered in
    // and out depending on whether that visit happened to trigger a live
    // fetch or not.
    // (developer_badge used to also be added here — dropped in
    // migration 26, superseded by the companies/media_by_company
    // tables. A fresh install replays every migration from v0, so it's
    // removed from here too, not just the base schema, or it'd come
    // right back.)
    add_column(tx, "ALTER TABLE media_catalog ADD COLUMN source_url TEXT")
}

fn m14(tx: &Transaction) -> SqlResult<()> {
    // Replaced by deleted_relations: manually_edited_at was an all-or-
    // nothing per-row gate — once a live resync's relation merge saw it
    // set, it stopped adding *any* new relation to that entry (even a
    // genuinely new sequel released afterward), not just the specific
    // one the user had deleted. deleted_relations is a per-pair
    // tombstone instead — a resync/community merge skips re-adding
    // exactly the (media, related) pair recorded here, and nothing else
    // is blocked. See save_media_relations / mergeAndPersistRelations.
    drop_column(tx, "ALTER TABLE media_catalog DROP COLUMN manually_edited_at")?;
    tx.execute_batch(
        "CREATE TABLE IF NOT EXISTS deleted_relations (
            media_external_id         TEXT NOT NULL,
            related_media_external_id TEXT NOT NULL,
            deleted_at                TEXT DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (media_external_id, related_media_external_id)
         );"
    )
}

fn m15(_tx: &Transaction) -> SqlResult<()> {
    // Used to add publishers_csv here — dropped in migration 26,
    // superseded by the companies/media_by_company tables (a game where
    // the same company is both developer and publisher couldn't be told
    // apart once flattened into one CSV). No-op now, kept only so the
    // migration number stays marked as applied on every database.
    Ok(())
}

fn m17(tx: &Transaction) -> SqlResult<()> {
    // AniList's countryOfOrigin / TMDB's origin_country ("País de
    // origen" stat) was only ever built live, never persisted — the
    // catalog-only fast path had no way to show it, so it'd flash in
    // only once the live fetch resolved. See catalog-mapper.ts.
    // (Was migration 16 — renumbered because an earlier, since-reverted
    // migration 16 already got applied and marked on dev databases,
    // which made run_migrations silently skip this one.)
    add_column(tx, "ALTER TABLE media_catalog ADD COLUMN country_code TEXT")
}

fn m18(tx: &Transaction) -> SqlResult<()> {
    // AniList's raw.endDate — only release_year/month/day (the *start*
    // date) was ever persisted, so the catalog-only fast path could only
    // ever rebuild a single-date dateBadge, never the "start - end"
    // range anilist-mapper builds live for finished series.
    add_column(tx, "ALTER TABLE media_catalog ADD COLUMN release_end_year INTEGER")?;
    add_column(tx, "ALTER TABLE media_catalog ADD COLUMN release_end_month INTEGER")?;
    add_column(tx, "ALTER TABLE media_catalog ADD COLUMN release_end_day INTEGER")
}

fn m19(tx: &Transaction) -> SqlResult<()> {
    // Display-only alternate title (AniList's title.english when it
    // differs from the main romaji/native title) had no catalog column
    // at all — the fast path could never show it, only a live fetch
    // could, so it always flashed in after the rest of the page.
    add_column(tx, "ALTER TABLE media_catalog ADD COLUMN title_english TEXT")
}

fn m23(tx: &Transaction) -> SqlResult<()> {
    // media_saga_groups is superseded — re-derivable live from
    // ALTERNATIVE edges (pr-editor-load.ts), drop lives in
    // vestigial_cleanup.rs. order_index adds a manual saga position
    // (see saga_relations' own doc comment).
    crate::vestigial_cleanup::drop_media_saga_groups(tx);
    add_column(tx, "ALTER TABLE saga_relations ADD COLUMN order_index REAL")
}

fn m24(tx: &Transaction) -> SqlResult<()> {
    // local_game_links had no way to tell "still installed" from
    // "uninstalled ages ago" — a link just sat there forever once
    // created. local_games_seen tracks the last live scan that actually
    // found each (launcher, link_key); prune_stale_game_links (folders.rs)
    // deletes a link once its game hasn't been seen in a while. Seed from
    // today's existing links so upgrading doesn't treat them as already
    // stale on the very first post-upgrade scan.
    tx.execute(
        "CREATE TABLE IF NOT EXISTS local_games_seen (
            launcher     TEXT NOT NULL,
            link_key     TEXT NOT NULL,
            last_seen_at TEXT NOT NULL,
            PRIMARY KEY (launcher, link_key)
        )",
        [],
    )?;
    tx.execute(
        "INSERT OR IGNORE INTO local_games_seen (launcher, link_key, last_seen_at)
         SELECT launcher, link_key, CURRENT_TIMESTAMP FROM local_game_links",
        [],
    )?;
    Ok(())
}

fn m25(tx: &Transaction) -> SqlResult<()> {
    // Actors table shared between voice actors (anime, role='voice') and
    // live-action actors (role='actor') — one kind of "who portrays this
    // character" concept instead of two near-identical tables, since a
    // person can plausibly be sourced from either AniList Staff or TMDB.
    tx.execute(
        "CREATE TABLE IF NOT EXISTS actors (
            id          TEXT PRIMARY KEY,
            external_id TEXT UNIQUE NOT NULL,
            name        TEXT NOT NULL DEFAULT '',
            name_native TEXT,
            image_url   TEXT,
            created_at  TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at  TEXT DEFAULT CURRENT_TIMESTAMP
        )",
        [],
    )?;
    tx.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS actors_external_idx ON actors(external_id)",
        [],
    )?;
    tx.execute(
        "CREATE TABLE IF NOT EXISTS character_actors (
            actor_external_id     TEXT NOT NULL,
            character_external_id TEXT NOT NULL,
            role                  TEXT,
            language              TEXT,
            added_at              TEXT DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (actor_external_id, character_external_id),
            FOREIGN KEY (actor_external_id) REFERENCES actors(external_id) ON DELETE CASCADE
        )",
        [],
    )?;
    Ok(())
}

fn m26(tx: &Transaction) -> SqlResult<()> {
    // Real relational replacement for how media tracks companies —
    // developer_badge/publishers_csv flattened developer+publisher (and,
    // for anime, studios) into a couple of CSV-ish columns with no
    // stable id, so a company that's both (e.g. self-published) needed
    // two separately-named fields just to avoid ambiguity. role carries
    // that distinction properly instead ('developer'/'publisher'/
    // 'studio'/'production'), across every provider, not just games.
    // (The DROP COLUMN for developer_badge/publishers_csv originally
    // lived right here, added on the same day after this migration had
    // already run and been marked applied on real databases — so it
    // silently never executed for anyone who'd already updated. Moved
    // to migration 28, a fresh number every already-migrated database
    // will actually hit. See this module's own doc comment: search
    // "DROP COLUMN" to find every column this app has actually removed.)
    tx.execute(
        "CREATE TABLE IF NOT EXISTS companies (
            external_id TEXT PRIMARY KEY,
            name        TEXT NOT NULL DEFAULT '',
            logo_url    TEXT,
            created_at  TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at  TEXT DEFAULT CURRENT_TIMESTAMP
        )",
        [],
    )?;
    tx.execute(
        "CREATE TABLE IF NOT EXISTS media_by_company (
            company_external_id TEXT NOT NULL,
            media_external_id    TEXT NOT NULL,
            role                  TEXT NOT NULL,
            added_at              TEXT DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (media_external_id, company_external_id, role),
            FOREIGN KEY (company_external_id) REFERENCES companies(external_id) ON DELETE CASCADE
        )",
        [],
    )?;
    Ok(())
}

fn m28(tx: &Transaction) -> SqlResult<()> {
    // The real column removal for developer_badge/publishers_csv — see
    // migration 26's comment. Same DROP COLUMN this app already relies
    // on in migration 14; already-migrated databases (which ran the
    // no-op version of this inside migration 26 earlier) need this new
    // number to actually pick it up.
    drop_column(tx, "ALTER TABLE media_catalog DROP COLUMN developer_badge")?;
    drop_column(tx, "ALTER TABLE media_catalog DROP COLUMN publishers_csv")
}

fn m29(tx: &Transaction) -> SqlResult<()> {
    // Generic staleness/resync tracking, one row per external_id — as of
    // migration 32 this is the single source of truth for every entity
    // (media_catalog included), replacing what used to be duplicated as
    // media_catalog's own last_synced_at/sync_failed_count/last_sync_error
    // columns. Characters and staff/authors have their own dedicated
    // pages that used to live-fetch their external provider
    // unconditionally on every single visit; this table lets
    // needsResync() (media-status.ts) gate those the same way it
    // already gates media.
    tx.execute_batch(
        "CREATE TABLE IF NOT EXISTS sync_state (
            external_id       TEXT PRIMARY KEY,
            last_synced_at    TEXT,
            sync_failed_count INTEGER DEFAULT 0,
            last_sync_error   TEXT
        );",
    )
}

fn m30(tx: &Transaction) -> SqlResult<()> {
    // AniList's own character-profile fields, previously never cached
    // locally at all (only name/native/image/bio/aliases were) — needed
    // so a character page skipped by sync_state's staleness gate can
    // still render these from local data instead of going blank.
    add_column(tx, "ALTER TABLE characters ADD COLUMN gender TEXT")?;
    add_column(tx, "ALTER TABLE characters ADD COLUMN age TEXT")?;
    add_column(tx, "ALTER TABLE characters ADD COLUMN blood_type TEXT")?;
    add_column(tx, "ALTER TABLE characters ADD COLUMN dob_year INTEGER")?;
    add_column(tx, "ALTER TABLE characters ADD COLUMN dob_month INTEGER")?;
    add_column(tx, "ALTER TABLE characters ADD COLUMN dob_day INTEGER")
}

fn m31(tx: &Transaction) -> SqlResult<()> {
    // Same idea as migration 30, for the author page: AniList staff/
    // OpenLibrary author fields that were fetched live but never cached,
    // needed so a sync_state-skipped visit can still render a full profile.
    add_column(tx, "ALTER TABLE media_author ADD COLUMN name_native TEXT")?;
    add_column(tx, "ALTER TABLE media_author ADD COLUMN aliases_csv TEXT")?;
    add_column(tx, "ALTER TABLE media_author ADD COLUMN biography TEXT")?;
    add_column(tx, "ALTER TABLE media_author ADD COLUMN birth_date TEXT")?;
    add_column(tx, "ALTER TABLE media_author ADD COLUMN death_date TEXT")
}

fn m32(tx: &Transaction) -> SqlResult<()> {
    // media_catalog's own sync bookkeeping moves into sync_state too —
    // single source of truth for every entity now, not just the ones
    // that never had one. Migrate whatever's already tracked first, then
    // drop the columns it lived in (media_catalog.rs, proposal_bundle.rs,
    // and community_sync.rs no longer reference them). Both the SELECT
    // and the DROPs tolerate "no such column": a brand-new database's
    // base schema (db.rs's CREATE TABLE) never has these columns at all,
    // so both legitimately no-op there instead of failing app startup.
    exec_ignoring(
        tx,
        "INSERT OR IGNORE INTO sync_state (external_id, last_synced_at, sync_failed_count, last_sync_error)
         SELECT external_id, last_synced_at, sync_failed_count, last_sync_error
         FROM media_catalog
         WHERE last_synced_at IS NOT NULL OR sync_failed_count IS NOT NULL OR last_sync_error IS NOT NULL",
        &["no such column"],
    )?;
    drop_column(tx, "ALTER TABLE media_catalog DROP COLUMN last_sync_error")?;
    drop_column(tx, "ALTER TABLE media_catalog DROP COLUMN last_synced_at")?;
    drop_column(tx, "ALTER TABLE media_catalog DROP COLUMN sync_failed_count")
}

fn m34(tx: &Transaction) -> SqlResult<()> {
    // A media's character grid used to have no stable order at all —
    // get_media_characters had no ORDER BY, so SQLite returned rows in
    // physical/rowid order. save_characters_skeleton (media-side writer)
    // happened to insert in AniList's own role-sorted order, so a fresh
    // resync looked right by coincidence — but save_character_appearances
    // (the character's own edit page) deletes and reinserts that ONE
    // character's rows across every media it appears in, handing each a
    // brand-new (later) rowid and silently shoving it to the end of every
    // OTHER character's untouched rows for the same media. This column
    // makes the order explicit and independent of rowid churn.
    add_column(tx, "ALTER TABLE character_appearances ADD COLUMN position INTEGER")
}

fn m35(tx: &Transaction) -> SqlResult<()> {
    // authors_csv (a flat comma-separated name cache, curator-editable in
    // the PR editor) is retired — the "sticky" logic that rebuilt
    // MediaPageData.authors from it on every live refetch discarded each
    // author's image/url/external_id even when the fresh fetch had them,
    // permanently downgrading real author cards to bare unlinked names
    // (see mediaService.ts's applyStickyLocalFields, now removed). The
    // media_author/media_by_author relation tables already carry the
    // same information plus image/url, and don't have that problem —
    // single source of truth from here on. Tolerates "no such column": a
    // brand-new database's base schema never had this column at all.
    drop_column(tx, "ALTER TABLE media_catalog DROP COLUMN authors_csv")
}

fn m36(tx: &Transaction) -> SqlResult<()> {
    // source_avatar_url/source_name/source_username were meant to hold
    // the raw Google-provided identity separately from the user's own
    // customized display_name/avatar_data, but no code ever wrote to
    // them — dead columns. server_user_id replaces them with something
    // that IS used: a local, read-only cache of the UUID Turso already
    // assigned this account (see routes/auth.ts in metadea-web) once
    // Google-linked. Turso stays the only place that ever *assigns* it —
    // this column is just mirrored from the signed JWT after the fact,
    // never written from anywhere else, so there's no path for a client
    // to invent or overwrite another account's id.
    drop_column(tx, "ALTER TABLE user_profile DROP COLUMN source_avatar_url")?;
    drop_column(tx, "ALTER TABLE user_profile DROP COLUMN source_name")?;
    drop_column(tx, "ALTER TABLE user_profile DROP COLUMN source_username")?;
    add_column(tx, "ALTER TABLE user_profile ADD COLUMN server_user_id TEXT")
}

fn m38(tx: &Transaction) -> SqlResult<()> {
    // social_user_list shipped in v0.3.81 without status/progress —
    // needed so a visited profile's Overview tab can compute the same
    // completed/in-progress/planning stats bar the local profile page
    // does, instead of only ever having rating/dates/notes to show.
    add_column(tx, "ALTER TABLE social_user_list ADD COLUMN status TEXT")?;
    add_column(tx, "ALTER TABLE social_user_list ADD COLUMN progress REAL")
}

fn m39(tx: &Transaction) -> SqlResult<()> {
    // Optional second, independent rating dimension per library entry
    // (Settings > Preferencias' opt-in "doble calificación") — e.g. a
    // "gustos" score alongside a separate "objetivo" one, each with its
    // own name and its own rating system, entirely orthogonal to the
    // existing per-version log system (each version/edition already has
    // its own row here; this is one more field on each of those rows,
    // not a new dimension of versioning).
    add_column(tx, "ALTER TABLE user_library ADD COLUMN rating_2 REAL")
}

fn m41(tx: &Transaction) -> SqlResult<()> {
    // Story arcs (e.g. Bleach's "Sociedad de Almas"/"Arrancar", or a
    // multi-part saga entry like "Sennen Kessen-hen" collapsing its 4
    // parts into one "Thousand Year Blood War" arc) — a curator concept
    // distinct from both media_relations (which media are related) and
    // sagas/saga_relations (chronological order of whole entries): an
    // arc groups specific *episode ranges* within one or more media
    // entries under one name and optional custom cover. One arc can
    // point at the same media_external_id more than once (two different
    // arcs, two different ranges) or at several different entries at
    // once (one arc, several items) — that's why this is two tables
    // rather than a column on media_relations.
    tx.execute_batch(
        "CREATE TABLE IF NOT EXISTS story_arcs (
            id           TEXT PRIMARY KEY,
            name         TEXT NOT NULL,
            image_base64 TEXT,
            created_at   TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at   TEXT DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS story_arc_items (
            id                TEXT PRIMARY KEY,
            arc_id            TEXT NOT NULL,
            media_external_id TEXT NOT NULL,
            ep_start          INTEGER,
            ep_end            INTEGER,
            position          INTEGER NOT NULL DEFAULT 0,
            group_id          TEXT,
            FOREIGN KEY (arc_id) REFERENCES story_arcs(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS story_arc_items_arc_idx ON story_arc_items(arc_id);
        CREATE INDEX IF NOT EXISTS story_arc_items_media_idx ON story_arc_items(media_external_id);",
    )
}

fn m42(tx: &Transaction) -> SqlResult<()> {
    // Lets a curator manually reorder arcs (e.g. Bleach's arcs
    // chronologically) instead of always seeing them alphabetically.
    // Backfilled from rowid so existing installs keep whatever order
    // SQLite already stored them in rather than shuffling on upgrade.
    tx.execute_batch(
        "ALTER TABLE story_arcs ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;
         UPDATE story_arcs SET sort_order = rowid;",
    )
}

fn m43(tx: &Transaction) -> SqlResult<()> {
    // Where the video player's position was last seen for an episode that
    // hasn't been auto-marked watched yet — lets "Reproducir" resume from
    // there instead of always restarting at 0, even after fully closing the
    // player and coming back later (an in-memory identity would only
    // survive while the app itself stays open). One row per
    // (external_id, episode_number); cleared once that episode is
    // actually marked watched (see episode_history's own writer).
    tx.execute_batch(
        "CREATE TABLE IF NOT EXISTS episode_resume_position (
            external_id      TEXT NOT NULL,
            episode_number   REAL NOT NULL,
            position_seconds REAL NOT NULL,
            updated_at       TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (external_id, episode_number)
         );",
    )
}

fn m44(tx: &Transaction) -> SqlResult<()> {
    // local_games_seen only ever recorded (launcher, link_key) — enough
    // to tell prune_stale_game_links when a link is stale, but not
    // enough to show anything for a game once it drops out of every
    // *live* source: scan_all_games only ever scans currently-installed
    // titles, and Steam's owned-games API (steam-merge.ts, frontend)
    // doesn't include Family Sharing titles at all. A borrowed game that
    // gets uninstalled used to just vanish from the grid entirely
    // instead of staying listed as "not installed" like a normal owned-
    // but-uninstalled Steam game does. No source to backfill name from
    // for existing rows (local_game_links never stored it either), so
    // this only takes effect for a game the next time it's actually
    // scanned while still present — one scan's grace before it would
    // otherwise disappear on a later uninstall.
    add_column(tx, "ALTER TABLE local_games_seen ADD COLUMN name TEXT NOT NULL DEFAULT ''")
}

fn m45(tx: &Transaction) -> SqlResult<()> {
    // Per-episode data (name + still image) for the media page's new
    // "Episodios" tab — sourced from TMDB (series) or AniList's
    // streamingEpisodes (anime), fetched once and cached here the same
    // way media_catalog caches the rest of a work's metadata, rather
    // than re-hitting either API on every visit. episode_number is REAL
    // (not INTEGER) for the same reason episode_history/
    // episode_resume_position already are — specials/OVAs can carry a
    // fractional number (e.g. "12.5").
    tx.execute_batch(
        "CREATE TABLE IF NOT EXISTS media_episode (
            external_id    TEXT NOT NULL,
            season_number  INTEGER NOT NULL DEFAULT 0,
            episode_number REAL NOT NULL,
            name           TEXT,
            cover_url      TEXT,
            PRIMARY KEY (external_id, season_number, episode_number)
         );",
    )
}

fn m46(tx: &Transaction) -> SqlResult<()> {
    // A separate, deliberately-square photo for the Instagram-style
    // share image (see share-image.ts) — the main avatar can be any
    // crop/aspect ratio, but a square one specifically for sharing
    // avoids it being stretched/cropped oddly on the share card.
    // Falls back to avatar_data when empty (see get_user_image).
    add_column(tx, "ALTER TABLE user_profile ADD COLUMN share_avatar_data TEXT NOT NULL DEFAULT ''")
}

fn m47(tx: &Transaction) -> SqlResult<()> {
    // Purely local negative cache — records that this install already
    // asked AniList whether `external_id` has a prequel/sequel and got
    // nothing new back, so seasonResolve.ts's fallback (only reached
    // when media_relations has no PREQUEL/SEQUEL row for it yet — most
    // standalone/season-1 titles) doesn't re-ask AniList the same
    // question every single time that title's Local panel is opened.
    // Deliberately its own table, not a media_catalog column: this is
    // per-install state, not catalog data that gets shared/synced.
    tx.execute(
        "CREATE TABLE IF NOT EXISTS anilist_pre_sequel (
            external_id TEXT PRIMARY KEY,
            checked_at  TEXT DEFAULT CURRENT_TIMESTAMP
         );",
        [],
    )?;
    Ok(())
}

fn m48(tx: &Transaction) -> SqlResult<()> {
    add_column(tx, "ALTER TABLE user_lists ADD COLUMN is_private INTEGER NOT NULL DEFAULT 0")
}

fn m49(tx: &Transaction) -> SqlResult<()> {
    add_column(tx, "ALTER TABLE user_lists ADD COLUMN list_type TEXT NOT NULL DEFAULT 'media'")?;
    tx.execute(
        "UPDATE user_lists SET list_type = 'characters'
         WHERE EXISTS (
             SELECT 1 FROM user_list_items i
             WHERE i.list_key = user_lists.key AND i.external_id LIKE 'character:%'
         )",
        [],
    )?;
    Ok(())
}

fn m50(tx: &Transaction) -> SqlResult<()> {
    add_column(tx, "ALTER TABLE user_lists ADD COLUMN is_ranked INTEGER NOT NULL DEFAULT 0")
}

fn m52(tx: &Transaction) -> SqlResult<()> {
    // Where the in-app comic/manga/book reader last left off inside one
    // archive/document — same "resume position" idea as
    // episode_resume_position (migration 43), just page_number instead
    // of position_seconds. One row per (external_id, episode_number):
    // episode_number is whichever issue/chapter/volume file this is (the
    // same numbering already used for episode_history), page_number is
    // the position within *that* file specifically. total_pages is
    // cached alongside it so the UI can show "página X de Y" without
    // re-opening the archive just to count pages.
    tx.execute_batch(
        "CREATE TABLE IF NOT EXISTS reading_progress (
            external_id    TEXT NOT NULL,
            episode_number REAL NOT NULL,
            page_number    INTEGER NOT NULL,
            total_pages    INTEGER,
            updated_at     TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (external_id, episode_number)
         );",
    )
}

fn m53(tx: &Transaction) -> SqlResult<()> {
    tx.execute_batch(
        "CREATE TABLE IF NOT EXISTS comic_bookmarks (
            id             INTEGER PRIMARY KEY AUTOINCREMENT,
            external_id    TEXT NOT NULL,
            episode_number REAL NOT NULL,
            page_number    INTEGER NOT NULL,
            created_at     TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(external_id, episode_number, page_number)
         );
         CREATE INDEX IF NOT EXISTS idx_comic_bookmarks_entry ON comic_bookmarks(external_id, episode_number);",
    )
}

fn m54(tx: &Transaction) -> SqlResult<()> {
    // 'PARENT' used to double as two unrelated concepts sharing one
    // string: AniList's own real relation type (the main story a side
    // story/movie/OVA is attached to — igdb/comicvine never see this
    // one) AND this app's own choice of key for "the base game/comic
    // volume an edition or issue belongs to" (igdb-mapper.ts/
    // comicvine-mapper.ts). That collision is what made the editor's
    // relation dropdown show a "Base Edition"-ish label right next to
    // "Source Material" for completely different reasons depending on
    // whether you were looking at an anime or a game. Splitting the
    // game/comic sense out to its own BASE_EDITION key leaves PARENT
    // meaning only the AniList concept from here on. Scoped to game/
    // vnovel/comic rows specifically (by the OWNING media's catalog
    // type) rather than every PARENT row, since anime/manga/lnovel
    // entries with a real AniList PARENT edge must keep it as-is.
    tx.execute(
        "UPDATE media_relations SET relation_type = 'BASE_EDITION', type_label = 'Base Edition'
         WHERE relation_type = 'PARENT'
         AND media_external_id IN (
             SELECT external_id FROM media_catalog WHERE type IN ('game', 'vnovel', 'comic')
         )",
        [],
    )?;
    Ok(())
}

fn m56(tx: &Transaction) -> SqlResult<()> {
    // Openings/endings from animethemes.moe (the "Temas" tab on an
    // anime's media page) — cached locally after the first fetch, same
    // pattern as media_episode above, so it's a straight DB read on
    // every later visit instead of re-hitting animethemes.moe. sequence
    // is the Nth OP/ED of that type (OP1, OP2, ED1, ...), but is NOT
    // unique on its own — animethemes.moe attaches a recap/compilation
    // work's own OP1/ED1/... to the SAME anime entry as the main
    // show's (e.g. Gintama's id also carries "Yorinuki Gintama-san"'s
    // themes), so two rows can share (theme_type, sequence) with
    // different songs. slug is animethemes.moe's own real unique name
    // per theme ("OP1" vs "OP1-YorinukiGintamaSan") and is what this
    // keys on instead.
    tx.execute_batch(
        "CREATE TABLE IF NOT EXISTS media_theme (
            external_id  TEXT NOT NULL,
            slug         TEXT NOT NULL,
            theme_type   TEXT NOT NULL,
            sequence     INTEGER NOT NULL,
            song_title   TEXT,
            artists      TEXT,
            episodes     TEXT,
            video_url    TEXT,
            PRIMARY KEY (external_id, slug)
         );",
    )
}

fn m58(tx: &Transaction) -> SqlResult<()> {
    add_column(tx, "ALTER TABLE media_theme ADD COLUMN preview_url TEXT")
}

fn m59(tx: &Transaction) -> SqlResult<()> {
    tx.execute_batch(
        "CREATE TABLE IF NOT EXISTS emulator_configs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            platform_id TEXT NOT NULL UNIQUE,
            emulator_name TEXT NOT NULL,
            executable_path TEXT,
            launch_args TEXT,
            rom_folder TEXT,
            tracking_mode TEXT DEFAULT 'process',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
         );
         CREATE INDEX IF NOT EXISTS idx_emulator_configs_platform
            ON emulator_configs(platform_id);"
    )
}

fn m60(tx: &Transaction) -> SqlResult<()> {
    // A game the user manually removed from Local's grid (see
    // remove_local_game) — unlike local_games_seen, this must survive
    // even a source that keeps reporting the game every scan (a ROM
    // file still sitting on disk, an install scan_all_games re-finds
    // every time), so scan_all_games filters its output against this
    // table instead of relying on the seen/links delete alone.
    tx.execute_batch(
        "CREATE TABLE IF NOT EXISTS local_hidden_games (
            launcher TEXT NOT NULL,
            link_key TEXT NOT NULL,
            hidden_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (launcher, link_key)
         );"
    )
}

fn m61(tx: &Transaction) -> SqlResult<()> {
    add_column(tx, "ALTER TABLE story_arc_items ADD COLUMN group_id TEXT")
}

fn m62(tx: &Transaction) -> SqlResult<()> {
    add_column(tx, "ALTER TABLE media_theme ADD COLUMN versions TEXT")
}

fn m64(tx: &Transaction) -> SqlResult<()> {
    // Episode provenance makes the cache self-validating: a TMDB episode
    // can belong to one stored work only, while mapping_key invalidates
    // rows made with an older prequel/sequel chain layout.
    add_column(tx, "ALTER TABLE media_episode ADD COLUMN source_key TEXT")?;
    add_column(tx, "ALTER TABLE media_episode ADD COLUMN mapping_key TEXT")?;
    tx.execute_batch(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_media_episode_source_key
         ON media_episode(source_key) WHERE source_key IS NOT NULL;",
    )
}

fn m65(tx: &Transaction) -> SqlResult<()> {
    // Global character identity links: provider-specific duplicates
    // (source_character_external_id) redirect to a canonical character.
    tx.execute_batch(
        "CREATE TABLE IF NOT EXISTS character_merges (
            source_character_external_id TEXT PRIMARY KEY,
            canonical_character_external_id TEXT NOT NULL,
            added_at TEXT DEFAULT CURRENT_TIMESTAMP
        );",
    )
}

fn m66(tx: &Transaction) -> SqlResult<()> {
    // API-Sports competition seasons and their match lists are app data,
    // not a transient view of the provider response. Keeping the rows
    // separate lets a previously synced competition open without an API
    // key or network connection. matches_synced_at distinguishes a
    // successful empty season from a season never fetched yet.
    // Dropped again by 91 (remove_event_type) when the type was removed.
    tx.execute_batch(
        "CREATE TABLE IF NOT EXISTS media_event_season (
            external_id              TEXT PRIMARY KEY,
            competition_external_id  TEXT NOT NULL,
            season_key               TEXT NOT NULL,
            season_number             INTEGER NOT NULL DEFAULT 0,
            name                      TEXT NOT NULL DEFAULT '',
            cover_url                 TEXT,
            air_date                  TEXT,
            is_current                INTEGER NOT NULL DEFAULT 0,
            matches_synced_at         TEXT,
            created_at                TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at                TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            UNIQUE (competition_external_id, season_key)
         );
         CREATE INDEX IF NOT EXISTS idx_media_event_season_competition
            ON media_event_season(competition_external_id, season_number DESC);
         CREATE TABLE IF NOT EXISTS media_event_match (
            season_external_id  TEXT NOT NULL,
            match_id            TEXT NOT NULL,
            date                TEXT,
            time                TEXT,
            home                TEXT,
            away                TEXT,
            home_score          TEXT,
            away_score          TEXT,
            image               TEXT,
            venue               TEXT,
            status              TEXT,
            PRIMARY KEY (season_external_id, match_id),
            FOREIGN KEY (season_external_id) REFERENCES media_event_season(external_id) ON DELETE CASCADE
         );
         CREATE INDEX IF NOT EXISTS idx_media_event_match_date
            ON media_event_match(season_external_id, date, time);",
    )
}

fn m67(tx: &Transaction) -> SqlResult<()> {
    add_column(tx, "ALTER TABLE media_catalog ADD COLUMN issue_source_id TEXT")?;
    add_column(tx, "ALTER TABLE media_catalog ADD COLUMN episode_source_id TEXT")
}

// Indexes for the profile's first-paint queries.
//
// idx_media_catalog_blocked: nearly every user-data read excludes blocked
// works via `external_id NOT IN (SELECT external_id FROM
// blocked_media_catalog)` (user_library.rs SELECT_BASE, read_monthly_history,
// read_user_journey, user_lists.rs, social_profile.rs) or `EXISTS(... WHERE
// external_id = ?)` (save_library_entry). Blocked rows are a tiny fraction
// of media_catalog, so a partial index over just them turns that subquery
// from a full catalog scan into a scan of a few dozen index entries.
//
// idx_user_library_user_id: get_catalog_entries_for_library (media_catalog.rs)
// scopes the catalog to one user's library rows by user_id — the table only
// had its UNIQUE(external_id) index, so a per-user lookup was a full scan.
// (user_id, external_id) makes it a covering range scan for the id list
// that query needs.
//
// idx_media_relations_related: declared in the base schema (db.rs) but lost
// on every install that ran m5, which rebuilt media_relations by DROP +
// RENAME without recreating its indexes — so get_all_media_relations' JOIN
// on related_media_external_id, get_base_edition_candidates_for_redirect's
// reverse lookup and get_media_relations_for_ids' related-side pass were
// all full scans. Recreated here for those installs.
fn m68(tx: &Transaction) -> SqlResult<()> {
    tx.execute_batch(
        "CREATE INDEX IF NOT EXISTS idx_media_catalog_blocked
            ON media_catalog(external_id) WHERE blocked_at IS NOT NULL;
         CREATE INDEX IF NOT EXISTS idx_user_library_user_id
            ON user_library(user_id, external_id);
         CREATE INDEX IF NOT EXISTS idx_media_relations_related
            ON media_relations(related_media_external_id);",
    )
}

// ROM library (platform_scanning/rom_library.rs, rom_rename.rs):
// - emulator_configs.rom_extensions: comma list of the extensions the
//   configured emulator handles; '' means the platform's built-in default
//   (emulators::default_rom_extensions). The scanner only looks at these,
//   so saves/configs beside the ROMs never match.
// - local_game_links.manual: every row written so far came from the IGDB
//   picker (save_game_link), so they are all manual. Automatic ROM matches
//   insert with 0 and never overwrite a 1 (game_links::save_auto_game_link).
// - rom_rename_journal: one row per file the automatic clean-up renamed,
//   what the Local tab's "N files renamed · Undo" toast reverts.
fn m69(tx: &Transaction) -> SqlResult<()> {
    add_column(tx, "ALTER TABLE emulator_configs ADD COLUMN rom_extensions TEXT NOT NULL DEFAULT ''")?;
    add_column(tx, "ALTER TABLE local_game_links ADD COLUMN manual INTEGER NOT NULL DEFAULT 0")?;
    tx.execute("UPDATE local_game_links SET manual = 1", [])?;
    tx.execute_batch(
        "CREATE TABLE IF NOT EXISTS rom_rename_journal (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            old_path   TEXT NOT NULL,
            new_path   TEXT NOT NULL,
            scanned_at TEXT NOT NULL,
            undone_at  TEXT
        );",
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fresh_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        crate::db::ensure_base_schema(&conn).unwrap();
        conn
    }

    fn latest_version() -> i64 {
        MIGRATIONS.iter().map(|(v, _)| *v).max().unwrap()
    }

    #[test]
    fn migrations_are_listed_in_strictly_increasing_order() {
        for pair in MIGRATIONS.windows(2) {
            assert!(pair[0].0 < pair[1].0, "{} must come before {}", pair[0].0, pair[1].0);
        }
    }

    #[test]
    fn fresh_database_reaches_the_latest_version_and_is_idempotent() {
        let conn = fresh_db();
        run_migrations(&conn).unwrap();
        assert_eq!(current_schema_version(&conn), latest_version());
        run_migrations(&conn).unwrap();
        assert_eq!(current_schema_version(&conn), latest_version());
        // Every version got its own row, not just the last one.
        let applied: i64 = conn
            .query_row("SELECT COUNT(*) FROM schema_migrations", [], |r| r.get(0))
            .unwrap();
        assert_eq!(applied as usize, MIGRATIONS.len());
    }

    #[test]
    fn a_failing_migration_rolls_back_and_leaves_the_version_unchanged() {
        fn creates_then_fails(tx: &Transaction) -> SqlResult<()> {
            tx.execute_batch("CREATE TABLE probe (x INTEGER)")?;
            tx.execute_batch("INSERT INTO no_such_table VALUES (1)")
        }
        fn ok(tx: &Transaction) -> SqlResult<()> {
            tx.execute_batch("CREATE TABLE first (x INTEGER)")
        }
        let conn = fresh_db();
        let custom: &[(i64, Migration)] = &[(1, ok), (2, creates_then_fails), (3, ok)];

        assert!(run(&conn, custom).is_err());
        assert_eq!(current_schema_version(&conn), 1);
        // The failed step's own DDL was rolled back together with its version row.
        let probe_exists: i64 = conn
            .query_row("SELECT COUNT(*) FROM sqlite_master WHERE name = 'probe'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(probe_exists, 0);
    }

    #[test]
    fn a_database_from_a_newer_metadea_is_refused() {
        let conn = fresh_db();
        mark_migration(&conn, latest_version() + 1).unwrap();
        let err = run_migrations(&conn).unwrap_err().to_string();
        assert!(err.contains("newer Metadea version"), "{err}");
    }

    fn query_plan(conn: &Connection, sql: &str) -> String {
        let mut stmt = conn.prepare(&format!("EXPLAIN QUERY PLAN {sql}")).unwrap();
        let rows = stmt.query_map([], |r| r.get::<_, String>(3)).unwrap();
        rows.filter_map(|r| r.ok()).collect::<Vec<_>>().join("\n")
    }

    #[test]
    fn blocked_lookups_use_the_partial_index() {
        let db = crate::db::MetadeaDb::open_in_memory().unwrap();
        let conn = db.conn.lock().unwrap();
        // The NOT IN (blocked_media_catalog) predicate every user-data read
        // carries — user_library.rs SELECT_BASE is the representative one.
        let plan = query_plan(
            &conn,
            "SELECT id FROM user_library
             WHERE external_id NOT IN (SELECT external_id FROM blocked_media_catalog)",
        );
        assert!(plan.contains("SCAN media_catalog USING INDEX idx_media_catalog_blocked")
            || plan.contains("COVERING INDEX idx_media_catalog_blocked"), "{plan}");
        // save_library_entry's point check.
        let plan = query_plan(
            &conn,
            "SELECT EXISTS(SELECT 1 FROM blocked_media_catalog WHERE external_id = 'anime:1')",
        );
        assert!(plan.contains("INDEX"), "{plan}");
    }

    #[test]
    fn per_user_library_scans_use_the_user_id_index() {
        let db = crate::db::MetadeaDb::open_in_memory().unwrap();
        let conn = db.conn.lock().unwrap();
        let plan = query_plan(
            &conn,
            "SELECT external_id FROM user_library WHERE user_id = 'local'",
        );
        assert!(plan.contains("COVERING INDEX idx_user_library_user_id"), "{plan}");
    }

    #[test]
    fn add_column_ignores_only_duplicate_columns() {
        let conn = fresh_db();
        let tx = conn.unchecked_transaction().unwrap();
        add_column(&tx, "ALTER TABLE user_lists ADD COLUMN is_ranked INTEGER NOT NULL DEFAULT 0").unwrap();
        assert!(add_column(&tx, "ALTER TABLE no_such_table ADD COLUMN x TEXT").is_err());
        drop_column(&tx, "ALTER TABLE user_lists DROP COLUMN never_existed").unwrap();
        assert!(drop_column(&tx, "ALTER TABLE no_such_table DROP COLUMN x").is_err());
    }
}
