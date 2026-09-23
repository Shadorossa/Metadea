//! Throwaway measurement (never run by default — `#[ignore]`): seeds a
//! realistic profile-sized dataset into the real schema and prints how many
//! JSON bytes each first-paint command ships over IPC, old shape vs the
//! scoped/light/typed variant added alongside it.
//!
//!   cargo test --lib -- ipc_size_probe --ignored --nocapture

use rusqlite::Connection;

const CATALOG_ROWS: usize = 5_000;
const RELATION_ROWS: usize = 7_600;
const LIBRARY_ROWS: usize = 300;
const CHARACTER_ROWS: usize = 200;
const CHARACTER_IMAGE_BYTES: usize = 24 * 1024;
const AVATAR_BYTES: usize = 160 * 1024;

fn seed(conn: &Connection, data_dir: &std::path::Path) -> Vec<String> {
    let synopsis = "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. ".repeat(5);
    let types = ["anime", "manga", "game", "movie", "series", "book", "lnovel", "vnovel"];
    for i in 0..CATALOG_ROWS {
        let t = types[i % types.len()];
        conn.execute(
            "INSERT INTO media_catalog (
                id, external_id, banners_csv, country_code, cover_url, favorites_count, format,
                genres_csv, genres_tag_csv, platforms_csv, ratings_count,
                release_day, release_month, release_year, score_global, shop_links_csv,
                source, source_url, status, synopsis, time_length,
                title_english, title_main, title_native, title_romaji, total_count, total_count_2, type
             ) VALUES (?1, ?2, ?3, 'JP', ?4, 1234, 'TV', 'Action,Adventure,Fantasy', 'Shounen,Magic,Isekai',
                       'PC,PS5', 4321, 12, 4, 2019, 7.8, 'steam|https://store.steampowered.com/app/123',
                       'anilist', ?5, 'FINISHED', ?6, 24, ?7, ?7, ?8, ?7, 24, 2, ?9)",
            rusqlite::params![
                format!("id-{i}"),
                format!("{t}:{i}"),
                format!("https://cdn.example.com/banner/{i}.jpg,https://cdn.example.com/banner/{i}b.jpg"),
                format!("https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx{i}-abcdefghijkl.jpg"),
                format!("https://anilist.co/anime/{i}"),
                synopsis,
                format!("Some Fairly Long Work Title Number {i}: The Return"),
                format!("作品タイトル {i}"),
                t,
            ],
        ).unwrap();
    }

    let mut library_ids = Vec::with_capacity(LIBRARY_ROWS);
    for i in 0..LIBRARY_ROWS {
        let idx = i * 7 % CATALOG_ROWS;
        let t = types[idx % types.len()];
        let ext = format!("{t}:{idx}");
        conn.execute(
            "INSERT INTO user_library (external_id, type, user_id, status, rating, progress)
             VALUES (?1, ?2, 'local', 'completed', 4.5, 24)",
            rusqlite::params![ext, t],
        ).unwrap();
        library_ids.push(ext);
    }
    for (pos, ext) in library_ids.iter().take(40).enumerate() {
        conn.execute(
            "INSERT OR IGNORE INTO user_list_items (list_key, external_id, position) VALUES ('anime_fav', ?1, ?2)",
            rusqlite::params![ext, pos as i64],
        ).unwrap();
        conn.execute(
            "INSERT OR IGNORE INTO monthly_history (month, external_id, position) VALUES ('2024-01', ?1, ?2)",
            rusqlite::params![ext, pos as i64],
        ).unwrap();
        conn.execute(
            "INSERT INTO user_activity (date, event_type, external_id, media_type, progress_start, progress_end, timestamp)
             VALUES ('2024-01-15', 'progress', ?1, 'anime', 1, 12, '2024-01-15T10:00:00Z')",
            [ext],
        ).unwrap();
    }

    // Relations: every catalog row gets ~1.5 edges; about half are
    // RECOMMENDATION fan-out, the rest SEQUEL/PREQUEL/SIDE_STORY chains.
    let kinds = ["RECOMMENDATION", "SEQUEL", "RECOMMENDATION", "PREQUEL", "SIDE_STORY", "RECOMMENDATION"];
    let mut inserted = 0;
    let mut i = 0usize;
    while inserted < RELATION_ROWS {
        let a = i % CATALOG_ROWS;
        // The extra `i / CATALOG_ROWS` term shifts the pairing on every
        // pass over the catalog so the loop keeps producing new pairs.
        let b = (i * 13 + 1 + i / CATALOG_ROWS) % CATALOG_ROWS;
        if a != b {
            let ta = types[a % types.len()];
            let tb = types[b % types.len()];
            let kind = kinds[i % kinds.len()];
            let changed = conn.execute(
                "INSERT OR IGNORE INTO media_relations (media_external_id, related_media_external_id, relation_type, type_label)
                 VALUES (?1, ?2, ?3, ?3)",
                rusqlite::params![format!("{ta}:{a}"), format!("{tb}:{b}"), kind],
            ).unwrap();
            inserted += changed;
        }
        i += 1;
    }

    // Characters with a stored portrait each (pseudo-random bytes so base64
    // can't compress away anything).
    let mut rng = 0x9e3779b97f4a7c15u64;
    let mut image = vec![0u8; CHARACTER_IMAGE_BYTES];
    for c in 0..CHARACTER_ROWS {
        for byte in image.iter_mut() {
            rng ^= rng << 13; rng ^= rng >> 7; rng ^= rng << 17;
            *byte = rng as u8;
        }
        let ext = format!("character:{c}");
        let data_url = format!("data:image/jpeg;base64,{}", crate::utils::base64_encode(&image));
        let stored = crate::image_storage::store_image_value(data_dir, "characters", &ext, &data_url).unwrap();
        conn.execute(
            "INSERT INTO characters (id, external_id, name, name_native, biography, image_url, gender, age, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'Female', '17', 'now', 'now')",
            rusqlite::params![format!("cid-{c}"), ext, format!("Character Name {c}"), format!("キャラ {c}"), synopsis, stored],
        ).unwrap();
    }

    // Profile avatar.
    let mut avatar = vec![0u8; AVATAR_BYTES];
    for byte in avatar.iter_mut() {
        rng ^= rng << 13; rng ^= rng >> 7; rng ^= rng << 17;
        *byte = rng as u8;
    }
    let data_url = format!("data:image/png;base64,{}", crate::utils::base64_encode(&avatar));
    let stored = crate::image_storage::store_image_value(data_dir, "profile", "avatar", &data_url).unwrap();
    conn.execute("INSERT INTO user_profile (id, avatar_data) VALUES (1, ?1)", [stored]).unwrap();

    library_ids
}

fn json_len<T: serde::Serialize>(value: &T) -> usize {
    serde_json::to_string(value).unwrap().len()
}

fn kb(bytes: usize) -> String {
    format!("{:>9.1} KB", bytes as f64 / 1024.0)
}

#[test]
#[ignore]
fn print_ipc_byte_sizes_old_vs_new() {
    let unique = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let data_dir = std::env::temp_dir().join(format!("metadea-ipc-probe-{unique}"));
    std::fs::create_dir_all(&data_dir).unwrap();

    let db = crate::db::MetadeaDb::open_in_memory().unwrap();
    let conn = db.conn.lock().unwrap();
    let library_ids = seed(&conn, &data_dir);

    let mut rows: Vec<(&str, usize, usize)> = Vec::new();

    // 1. Catalog
    let old_catalog: Vec<crate::media_catalog::MediaCatalogEntry> = {
        let mut stmt = conn.prepare(crate::media_catalog::SELECT_VISIBLE).unwrap();
        stmt.query_map([], crate::media_catalog::row_to_entry).unwrap().filter_map(|r| r.ok()).collect()
    };
    let new_catalog = crate::media_catalog::load_catalog_summaries_for_library(&conn, Some("local")).unwrap();
    let by_ids = crate::media_catalog::load_catalog_summaries_by_ids(&conn, &library_ids).unwrap();
    rows.push(("get_all_catalog_entries -> get_catalog_entries_for_library", json_len(&old_catalog), json_len(&new_catalog)));
    rows.push(("get_all_catalog_entries -> get_catalog_entries_by_ids(library ids)", json_len(&old_catalog), json_len(&by_ids)));

    // 2. Relations
    let old_relations = crate::media_relations::load_all_media_relations(&conn).unwrap();
    let scoped = crate::media_relations::load_media_relations_for_ids(&conn, &library_ids, None).unwrap();
    let scoped_no_rec = crate::media_relations::load_media_relations_for_ids(
        &conn, &library_ids, Some(&["RECOMMENDATION".to_string()]),
    ).unwrap();
    rows.push(("get_all_media_relations -> get_media_relations_for_ids", json_len(&old_relations), json_len(&scoped)));
    rows.push(("get_all_media_relations -> ...for_ids(exclude RECOMMENDATION)", json_len(&old_relations), json_len(&scoped_no_rec)));

    // 3. Characters
    let mut old_chars = crate::characters::load_all_characters(&conn).unwrap();
    for row in &mut old_chars {
        row.image_url = crate::image_storage::resolve_image_value(&data_dir, row.image_url.take()).unwrap();
    }
    let mut new_chars = crate::characters::load_all_characters(&conn).unwrap();
    crate::characters::resolve_character_images_light(&data_dir, &mut new_chars).unwrap();
    rows.push(("get_all_characters -> get_all_characters_light", json_len(&old_chars), json_len(&new_chars)));

    // 4. User avatar
    let stored: String = conn.query_row("SELECT avatar_data FROM user_profile WHERE id = 1", [], |r| r.get(0)).unwrap();
    let old_avatar = crate::image_storage::resolve_image_value(&data_dir, Some(stored.clone())).unwrap();
    let new_avatar = crate::image_storage::resolve_image_path_value(&data_dir, Some(stored)).unwrap();
    rows.push(("get_user_image -> get_user_image_path", json_len(&old_avatar), json_len(&new_avatar)));

    // 5. JSON-string commands vs typed (old wire form is the JSON text
    //    re-encoded as a JSON string, i.e. with every quote escaped).
    let favorites = crate::user_lists::load_user_favorites(&conn).unwrap();
    rows.push(("read_user_favorites -> read_user_favorites_typed",
        json_len(&serde_json::to_string(&favorites).unwrap()), json_len(&favorites)));
    let monthly = crate::user_library::load_monthly_history(&conn).unwrap();
    rows.push(("read_monthly_history -> read_monthly_history_typed",
        json_len(&serde_json::to_string(&monthly).unwrap()), json_len(&monthly)));
    let journey = crate::user_library::load_user_journey(&conn).unwrap();
    rows.push(("read_user_journey -> read_user_journey_typed",
        json_len(&serde_json::to_string(&journey).unwrap()), json_len(&journey)));

    println!();
    println!("IPC JSON bytes, {CATALOG_ROWS} catalog rows / {RELATION_ROWS} relations / {LIBRARY_ROWS} library rows / {CHARACTER_ROWS} characters x {} KB portraits", CHARACTER_IMAGE_BYTES / 1024);
    println!("{:<72} {:>12} {:>12} {:>8}", "command (old -> new)", "old", "new", "ratio");
    let (mut total_old, mut total_new) = (0usize, 0usize);
    for (name, old, new) in &rows {
        println!("{name:<72} {} {} {:>7.1}%", kb(*old), kb(*new), *new as f64 * 100.0 / *old as f64);
    }
    // First-paint set: one of each family (scoped catalog, scoped relations
    // without recommendations, light characters, avatar path, typed reads).
    for (name, old, new) in &rows {
        if name.contains("by_ids") || name.ends_with("for_ids") { continue; }
        total_old += old;
        total_new += new;
    }
    println!("{:<72} {} {} {:>7.1}%", "first-paint total", kb(total_old), kb(total_new), total_new as f64 * 100.0 / total_old as f64);

    drop(conn);
    let _ = std::fs::remove_dir_all(&data_dir);
}
