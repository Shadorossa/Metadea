// Per-game detail commands: the full detail payload, remake/remaster
// reverse lookup and the edition relation graph walk.

use crate::igdb_env::load_env_config;
use super::auth::get_twitch_token;
use super::client::{igdb_query, IGDB_API_GAMES};
use super::images::{extract_image_candidates, pick_landscape_image};
use super::mapping::{build_store_links, detect_vn};

// Single-request detail fetch: banner candidates (artworks/screenshots) and
// store links (external_games) are Game sub-fields in IGDB's schema, so they
// ride along in the same query instead of requiring separate round-trips.
// Only the remake→base-game reverse lookup (`igdb_get_base_games`) can't be
// embedded this way — IGDB has no back-reference field for it — and it's
// only fired for the minority of games that are actually remakes.
#[tauri::command]
pub async fn igdb_get_game_detail(
    app_handle: tauri::AppHandle,
    igdb_id: u64,
) -> Result<serde_json::Value, String> {
    let cfg = load_env_config(&app_handle)?;
    let client_id = cfg.igdb_client_id.ok_or("Missing IGDB client_id")?;
    let client_secret = cfg.igdb_client_secret.ok_or("Missing IGDB client_secret")?;
    let token = get_twitch_token(&client_id, &client_secret).await?;
    let client = crate::http::http_client();

    let games_query = format!(
        "fields id,name,url,cover.image_id,summary,first_release_date,rating,total_rating,status,\
         genres.name,involved_companies.company.id,involved_companies.company.name,\
         involved_companies.company.logo.image_id,\
         involved_companies.developer,involved_companies.publisher,platforms.name,\
         alternative_names.name,alternative_names.comment,game_type,\
         parent_game.id,parent_game.name,parent_game.cover.image_id,parent_game.first_release_date,parent_game.genres.id,\
         version_parent.id,version_parent.name,version_parent.cover.image_id,version_parent.first_release_date,version_parent.genres.id,\
         artworks.image_id,artworks.width,artworks.height,artworks.alpha_channel,\
         screenshots.image_id,screenshots.width,screenshots.height,\
         external_games.category,external_games.url,\
         remakes.id,remakes.name,remakes.cover.image_id,remakes.first_release_date,remakes.genres.id,remakes.game_type,\
         remasters.id,remasters.name,remasters.cover.image_id,remasters.first_release_date,remasters.genres.id,remasters.game_type,\
         expansions.id,expansions.name,expansions.cover.image_id,expansions.first_release_date,expansions.genres.id,expansions.game_type,\
         standalone_expansions.id,standalone_expansions.name,standalone_expansions.cover.image_id,standalone_expansions.first_release_date,standalone_expansions.genres.id,standalone_expansions.game_type,\
         expanded_games.id,expanded_games.name,expanded_games.cover.image_id,expanded_games.first_release_date,expanded_games.genres.id,expanded_games.game_type,\
         ports.id,ports.name,ports.cover.image_id,ports.first_release_date,ports.genres.id,ports.game_type,\
         forks.id,forks.name,forks.cover.image_id,forks.first_release_date,forks.genres.id,forks.game_type; \
         where id = {}; limit 1;",
        igdb_id
    );

    let games = igdb_query(client, &client_id, &token, IGDB_API_GAMES, &games_query).await?;
    let mut game = games[0].clone();
    if game.is_null() {
        return Ok(game);
    }

    let mut candidates = extract_image_candidates(&game["artworks"]);
    candidates.extend(extract_image_candidates(&game["screenshots"]));
    game["banner_image_id"] = pick_landscape_image(&candidates)
        .map(serde_json::Value::String)
        .unwrap_or(serde_json::Value::Null);

    let mut store_links = build_store_links(&game["external_games"]);

    // Some ports (e.g. a console release of a PC game) carry storefront
    // links the base entry doesn't — if this game has none of its own,
    // check its ports before giving up. Batched into one follow-up request
    // rather than one per port.
    if store_links.is_none() {
        if let Some(port_ids) = game["ports"].as_array().map(|ports| {
            ports.iter().filter_map(|p| p["id"].as_u64()).collect::<Vec<_>>()
        }) {
            if !port_ids.is_empty() {
                let ids_csv = port_ids.iter().map(|i| i.to_string()).collect::<Vec<_>>().join(",");
                let ports_query = format!(
                    "fields id,external_games.category,external_games.url; where id = ({}); limit {};",
                    ids_csv, port_ids.len()
                );
                if let Ok(port_results) = igdb_query(client, &client_id, &token, IGDB_API_GAMES, &ports_query).await {
                    if let Some(port_arr) = port_results.as_array() {
                        let mut merged: Vec<serde_json::Value> = Vec::new();
                        let mut seen_urls = std::collections::HashSet::new();
                        for port in port_arr {
                            if let Some(links) = build_store_links(&port["external_games"]) {
                                for link in links {
                                    if let Some(url) = link["url"].as_str() {
                                        if seen_urls.insert(url.to_string()) {
                                            merged.push(link);
                                        }
                                    }
                                }
                            }
                        }
                        if !merged.is_empty() {
                            store_links = Some(merged);
                        }
                    }
                }
            }
        }
    }

    // Explicitly null (not just an absent field) once both the game itself
    // and its ports have been checked — lets the frontend persist "we looked,
    // there really are none" to shop_links_csv instead of leaving it
    // ambiguous with "never checked".
    game["store_links"] = match store_links {
        Some(links) => serde_json::Value::Array(links),
        None => serde_json::Value::Null,
    };

    // Related sub-games (remakes, expansions, ...) are their own titles and
    // can be visual novels even when the current game isn't (or vice versa)
    // — tag each one with is_vn from its own genres so the frontend can
    // route it to /media?id=vnovel:X instead of always assuming id=game:X,
    // which used to create duplicate catalog stubs of the same title under
    // both prefixes. dlcs deliberately excluded — see mapIgdbToMedia's own
    // comment (igdb-mapper.ts) for why DLC no longer surfaces as a relation
    // at all (cosmetic/minor content, not worth its own card).
    const REL_ARRAYS: &[&str] = &[
        "remakes", "remasters", "expansions",
        "standalone_expansions", "expanded_games", "ports", "forks",
    ];
    if let Some(obj) = game.as_object_mut() {
        for key in REL_ARRAYS {
            if let Some(arr) = obj.get_mut(*key).and_then(|v| v.as_array_mut()) {
                for node in arr.iter_mut() {
                    let is_vn = detect_vn(node);
                    if let Some(node_obj) = node.as_object_mut() {
                        node_obj.insert("is_vn".to_string(), serde_json::Value::Bool(is_vn));
                        node_obj.remove("genres");
                    }
                }
            }
        }
        for key in &["parent_game", "version_parent"] {
            if let Some(node) = obj.get(*key).cloned() {
                if !node.is_null() {
                    let is_vn = detect_vn(&node);
                    if let Some(node_obj) = obj.get_mut(*key).and_then(|v| v.as_object_mut()) {
                        node_obj.insert("is_vn".to_string(), serde_json::Value::Bool(is_vn));
                        node_obj.remove("genres");
                    }
                }
            }
        }
    }

    // These were only needed to derive banner_image_id/store_links above —
    // drop them so the IPC payload isn't carrying raw sub-arrays twice over.
    if let Some(obj) = game.as_object_mut() {
        obj.remove("artworks");
        obj.remove("screenshots");
        obj.remove("external_games");
    }

    Ok(game)
}

// Reverse lookup for remakes/remasters: IGDB only exposes the forward
// "remakes"/"remasters" array on the original game, not a back-reference on
// the edition itself. `relation_field` picks which forward array to search
// ("remakes" when the core detail response has game_type == 8, "remasters"
// for game_type == 9) — same query shape either way, just which column is
// matched against.
#[tauri::command]
pub async fn igdb_get_base_games(
    app_handle: tauri::AppHandle,
    igdb_id: u64,
    relation_field: String,
) -> Result<serde_json::Value, String> {
    let cfg = load_env_config(&app_handle)?;
    let client_id = cfg.igdb_client_id.ok_or("Missing IGDB client_id")?;
    let client_secret = cfg.igdb_client_secret.ok_or("Missing IGDB client_secret")?;
    let token = get_twitch_token(&client_id, &client_secret).await?;
    let client = crate::http::http_client();

    if relation_field != "remakes" && relation_field != "remasters" {
        return Err(format!("Unsupported relation_field: {}", relation_field));
    }

    let base_query = format!(
        "fields id,name,cover.image_id,first_release_date,genres.id; where {} = {}; limit 5;",
        relation_field, igdb_id
    );

    let mut results = igdb_query(client, &client_id, &token, IGDB_API_GAMES, &base_query).await?;
    if let Some(arr) = results.as_array_mut() {
        for node in arr.iter_mut() {
            let is_vn = detect_vn(node);
            if let Some(node_obj) = node.as_object_mut() {
                node_obj.insert("is_vn".to_string(), serde_json::Value::Bool(is_vn));
                node_obj.remove("genres");
            }
        }
    }
    Ok(results)
}

// Walks the forward edition/version relation graph (remakes, remasters,
// expansions, standalone_expansions, expanded_games, ports, forks,
// parent_game) breadth-first, batching one IGDB query per depth level, so
// that e.g. "a remaster of an expanded edition" or "a port of a remaster"
// still surfaces on the original game's page even though it's two or three
// hops away rather than a direct relation. Bounded by MAX_DEPTH/MAX_NODES
// to keep this to a handful of requests. Each returned node carries a
// synthetic "via" field naming the relation array that first discovered it,
// so the frontend can label it (the node's own further relation arrays are
// stripped before returning — only needed for traversal).
#[tauri::command]
pub async fn igdb_get_relation_graph(
    app_handle: tauri::AppHandle,
    root_id: u64,
) -> Result<Vec<serde_json::Value>, String> {
    let cfg = load_env_config(&app_handle)?;
    let client_id = cfg.igdb_client_id.ok_or("Missing IGDB client_id")?;
    let client_secret = cfg.igdb_client_secret.ok_or("Missing IGDB client_secret")?;
    let token = get_twitch_token(&client_id, &client_secret).await?;
    let client = crate::http::http_client();

    const MAX_DEPTH: usize = 4;
    const MAX_NODES: usize = 40;
    const REL_FIELDS: &[&str] = &[
        "remakes", "remasters", "expansions",
        "standalone_expansions", "expanded_games", "ports", "forks",
    ];


    let mut visited: std::collections::HashMap<u64, String> = std::collections::HashMap::new();
    visited.insert(root_id, "root".to_string());
    let mut frontier: Vec<u64> = vec![root_id];
    let mut collected: Vec<serde_json::Value> = Vec::new();

    for _ in 0..MAX_DEPTH {
        if frontier.is_empty() || visited.len() >= MAX_NODES {
            break;
        }
        let ids_csv = frontier.iter().map(|i| i.to_string()).collect::<Vec<_>>().join(",");
        let query = format!(
            "fields id,name,cover.image_id,first_release_date,genres.id,\
             parent_game.id,\
             remakes.id,remasters.id,expansions.id,\
             standalone_expansions.id,expanded_games.id,ports.id,forks.id; \
             where id = ({}); limit {};",
            ids_csv,
            frontier.len()
        );

        let results = igdb_query(client, &client_id, &token, IGDB_API_GAMES, &query).await?;
        let arr = results.as_array().cloned().unwrap_or_default();

        let mut next_frontier: Vec<u64> = Vec::new();
        for item in &arr {
            let id = match item["id"].as_u64() {
                Some(v) => v,
                None => continue,
            };

            if id != root_id {
                let is_vn = detect_vn(item);
                let mut out = item.clone();
                if let Some(obj) = out.as_object_mut() {
                    let via = visited.get(&id).cloned().unwrap_or_else(|| "relation".to_string());
                    obj.insert("via".to_string(), serde_json::Value::String(via));
                    obj.insert("is_vn".to_string(), serde_json::Value::Bool(is_vn));
                    for f in REL_FIELDS {
                        obj.remove(*f);
                    }
                    obj.remove("parent_game");
                    obj.remove("genres");
                }
                collected.push(out);
            }

            // All non-root nodes are dead ends for BFS traversal.
            // Their own sub-relations (DLC of a remake, remaster of a remake)
            // belong specifically to that edition and must only show on its own
            // page — not bubble up to the base game's relation list.
            if id != root_id {
                continue;
            }

            for field in REL_FIELDS {
                // Ports are never shown as related versions.
                if *field == "ports" {
                    continue;
                }
                if let Some(list) = item[*field].as_array() {
                    for sub in list {
                        if let Some(sid) = sub["id"].as_u64() {
                            if visited.len() < MAX_NODES && !visited.contains_key(&sid) {
                                visited.insert(sid, field.to_string());
                                next_frontier.push(sid);
                            }
                        }
                    }
                }
            }
            if let Some(pid) = item["parent_game"]["id"].as_u64() {
                if visited.len() < MAX_NODES && !visited.contains_key(&pid) {
                    visited.insert(pid, "parent_game".to_string());
                    next_frontier.push(pid);
                }
            }
        }
        frontier = next_frontier;
    }

    Ok(collected)
}
