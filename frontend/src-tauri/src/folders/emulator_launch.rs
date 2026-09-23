// Launching a game: emulator argument templating, the per-launcher URL
// schemes, and the GOG Galaxy client fallback.

use std::path::PathBuf;
use crate::db::ToStringErr;
use super::emulator_captures::{rom_title, start_emulator_capture_watcher};

// Splits an emulator's launch_args string into process args, substituting
// the `{ROM}` placeholder (see EmulatorsTab.astro's own field, which shows
// that exact token as its placeholder text) with the actual ROM path
// wherever it appears; falls back to just appending the ROM path as the
// final argument when the user never typed `{ROM}` at all.
//
// Tokenizes `launch_args` itself FIRST (quote-aware, so the user can still
// group their OWN flags), then substitutes rom_path into whichever
// token(s) contain `{ROM}` — never the other way around. An earlier
// version built one combined string (`launch_args` with `{ROM}` already
// replaced by the real path) and tokenized THAT by whitespace instead: a
// real ROM's filename or folder almost always has spaces in it, and since
// nothing quoted the substituted path, tokenizing after the fact silently
// split it into multiple unrelated arguments — the emulator launched, but
// with a garbled/truncated file argument instead of the real ROM, reading
// as a generic "unsupported format" dialog rather than actually opening
// anything. Splitting first means rom_path always lands as exactly one
// argument (Command::args below doesn't need it quoted at all — each Vec
// entry is already atomic), no matter how many spaces are in it or
// whether the user's own template wrapped `{ROM}` in quotes or not.
fn build_emulator_args(launch_args: &str, rom_path: &str) -> Vec<String> {
    let template = if launch_args.trim().is_empty() { "{ROM}" } else { launch_args };

    let mut tokens = Vec::new();
    let mut current = String::new();
    let mut in_quotes = false;
    for c in template.chars() {
        match c {
            '"' => in_quotes = !in_quotes,
            c if c.is_whitespace() && !in_quotes => {
                if !current.is_empty() {
                    tokens.push(std::mem::take(&mut current));
                }
            }
            c => current.push(c),
        }
    }
    if !current.is_empty() {
        tokens.push(current);
    }

    let has_placeholder = tokens.iter().any(|t| t.contains("{ROM}"));
    let mut args: Vec<String> = tokens
        .into_iter()
        .map(|tok| if tok.contains("{ROM}") { tok.replace("{ROM}", rom_path) } else { tok })
        .collect();
    if !has_placeholder {
        args.push(rom_path.to_string());
    }
    args
}

#[cfg(test)]
mod build_emulator_args_tests {
    use super::build_emulator_args;

    const ROM: &str = r"C:\Roms\Some Game (USA) [v1.1].iso";

    fn args(template: &str) -> Vec<String> {
        build_emulator_args(template, ROM)
    }

    #[test]
    fn empty_launch_args_yields_only_the_rom_path() {
        assert_eq!(args(""), vec![ROM]);
        assert_eq!(args("   \t "), vec![ROM]);
    }

    #[test]
    fn substitutes_placeholder_as_one_atomic_argument_even_with_spaces() {
        assert_eq!(args("-f {ROM}"), vec!["-f", ROM]);
    }

    #[test]
    fn appends_rom_path_when_template_has_no_placeholder() {
        assert_eq!(args("-f --fullscreen"), vec!["-f", "--fullscreen", ROM]);
    }

    #[test]
    fn strips_user_quotes_around_placeholder() {
        assert_eq!(args(r#"-f "{ROM}""#), vec!["-f", ROM]);
    }

    #[test]
    fn substitutes_placeholder_embedded_in_a_larger_token() {
        assert_eq!(args("--path={ROM}"), vec![format!("--path={ROM}")]);
    }

    #[test]
    fn substitutes_every_placeholder_and_does_not_append_again() {
        assert_eq!(args("{ROM} -x {ROM}"), vec![ROM, "-x", ROM]);
    }

    #[test]
    fn keeps_users_own_quoted_flag_values_grouped() {
        assert_eq!(
            args(r#"-c "my config.cfg" {ROM}"#),
            vec!["-c", "my config.cfg", ROM]
        );
    }

    #[test]
    fn placeholder_is_case_sensitive_so_lowercase_rom_token_is_left_alone() {
        assert_eq!(args("{rom}"), vec!["{rom}", ROM]);
    }

    #[test]
    fn unbalanced_quote_swallows_the_rest_of_the_template_into_one_token() {
        assert_eq!(args(r#""-f {ROM}"#), vec![format!("-f {ROM}")]);
    }

    #[test]
    fn relative_rom_path_is_passed_through_unchanged() {
        assert_eq!(
            build_emulator_args("{ROM}", "roms/game.nes"),
            vec!["roms/game.nes"]
        );
        assert_eq!(
            build_emulator_args("-f", "roms/game.nes"),
            vec!["-f", "roms/game.nes"]
        );
    }

    #[test]
    fn splits_on_any_whitespace_including_tabs_and_collapses_runs() {
        assert_eq!(args("-a\t-b   -c"), vec!["-a", "-b", "-c", ROM]);
    }
}

#[tauri::command]
#[allow(clippy::too_many_arguments)] // one flat IPC payload
pub async fn launch_game(
    app_handle: tauri::AppHandle,
    launcher: String,
    app_id: Option<String>,
    install_path: Option<String>,
    rom_platform: Option<String>,
    external_id: Option<String>,
    // The game's display title: an emulator session's captures are moved to
    // $PICTURES/Metadea/<title>/ (the ROM's file name when absent).
    title: Option<String>,
    // Presence art for the game session (game_sessions.rs); optional.
    cover_url: Option<String>,
    // Multi-disc sets: the disc picked in the game panel and the set's .m3u
    // (see disc_launch.rs for which one boots).
    disc_path: Option<String>,
    disc_playlist: Option<String>,
) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    let is_direct_exe = install_path
        .as_deref()
        .map(|p| p.to_lowercase().ends_with(".exe"))
        .unwrap_or(false);

    if !is_direct_exe {
        if let Some(platform_id) = rom_platform {
            use tauri::Manager;
            let rom_path = install_path.ok_or("No ROM path for emulator game")?;
            let db = app_handle.state::<crate::db::MetadeaDb>();
            let (executable_path, launch_args) = {
                let conn = db.conn.lock().str_err()?;
                conn.query_row(
                    "SELECT executable_path, launch_args FROM emulator_configs WHERE platform_id = ?1",
                    [&platform_id],
                    |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)),
                )
                .map_err(|_| format!("No emulator configured for {}", platform_id))?
            };
            if executable_path.is_empty() {
                return Err(format!("No emulator executable configured for {}", platform_id));
            }
            let capture_title = title
                .filter(|title| !title.trim().is_empty())
                .unwrap_or_else(|| rom_title(&rom_path));
            // Saves: newer central copies go back into the emulator's folders
            // (or RetroArch is pointed at the central folder) before it
            // starts; never blocks the launch on failure (see saves/mod.rs).
            let save_session = crate::saves::begin_session(&app_handle, &platform_id, &rom_path, &capture_title).await;
            let boot_path = super::disc_launch::resolve_rom_launch_path(&executable_path, &launch_args, &rom_path, disc_path.as_deref(), disc_playlist.as_deref());
            let mut args = build_emulator_args(&launch_args, &boot_path);
            if let Some(session) = &save_session {
                args = session.apply_args(args);
            }
            // Emulator instances already running before this launch are
            // never mistaken for it (game_sessions::exclude_preexisting).
            let emulator_matcher = crate::game_sessions::ProcessMatcher::executable(&PathBuf::from(&executable_path));
            let preexisting = crate::game_sessions::snapshot_matching_pids(&emulator_matcher);
            let mut child = std::process::Command::new(&executable_path)
                .args(&args)
                .spawn()
                .map_err(|e| format!("Failed to launch emulator: {}", e))?;
            // Snapshot the emulator's capture folders now, before it can
            // write anything; every capture from here on moves to Metadea's.
            let capture_watcher = start_emulator_capture_watcher(&app_handle, &platform_id, &rom_path, &capture_title);

            // The session registry owns playtime: it records it in SQLite when
            // the emulator exits, even when no page is listening.
            let registration = crate::game_sessions::register(&app_handle, crate::game_sessions::NewSession {
                external_id: external_id.unwrap_or_default(),
                title: capture_title.clone(),
                cover_url,
                platform: Some(platform_id.clone()),
                launcher: launcher.clone(),
                app_id: app_id.clone(),
                install_path: Some(rom_path.clone()),
                exe_path: Some(executable_path.clone()),
                pids: vec![child.id()],
                running: true,
            });
            let session_id = match registration {
                crate::game_sessions::Registration::New(id) => Some(id),
                // Already tracked: that session's watcher follows this
                // instance too, by name, once its own child exits.
                crate::game_sessions::Registration::Duplicate => None,
            };

            let handle = app_handle.clone();

            tokio::spawn(async move {
                let _ = tokio::task::spawn_blocking(move || {
                    let _ = child.wait();
                }).await;

                // Launcher-wrapper emulators hand off to another process of
                // the same executable: follow it, without a time cap.
                let ended_unix = match &session_id {
                    Some(id) => crate::game_sessions::follow_until_exit(&handle, id, &emulator_matcher, &preexisting).await,
                    None => crate::game_sessions::now_unix(),
                };

                // The session is over: final sweep, then the watcher stops.
                if let Some(watcher) = capture_watcher {
                    watcher.stop().await;
                }
                // Then the session's saves are copied to the central folder.
                if let Some(session) = save_session {
                    crate::saves::end_session(&handle, session).await;
                }

                if let Some(id) = session_id {
                    crate::game_sessions::finish(&handle, &id, ended_unix);
                }
            });

            return Ok(());
        }
    }
    match launcher.as_str() {
        "steam" => {
            let id = app_id.ok_or("No app_id for Steam game")?;
            app_handle.opener().open_url(format!("steam://run/{}", id), None::<String>)
                .str_err()
        }
        "epic" => {
            if let Some(id) = app_id {
                app_handle.opener()
                    .open_url(format!("com.epicgames.launcher://apps/{}?action=launch&silent=true", id), None::<String>)
                    .str_err()
            } else if let Some(path) = install_path {
                app_handle.opener().open_path(path, None::<String>).str_err()
            } else {
                Err("No launch target for Epic game".into())
            }
        }
        "gog" => {
            launch_gog_game(app_id, install_path)
        }
        _ => {
            if let Some(path) = install_path {
                app_handle.opener().open_path(path, None::<String>).str_err()
            } else {
                Err(format!("No launch target for {} game", launcher))
            }
        }
    }
}

#[cfg(windows)]
fn find_gog_galaxy_client() -> Option<PathBuf> {
    use winreg::enums::*;
    use winreg::RegKey;

    let subkey = "SOFTWARE\\GOG.com\\GalaxyClient\\paths";
    for hive in [HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE] {
        for view in [KEY_WOW64_64KEY, KEY_WOW64_32KEY] {
            if let Ok(key) = RegKey::predef(hive).open_subkey_with_flags(subkey, KEY_READ | view) {
                if let Ok(client) = key.get_value::<String, _>("client") {
                    let path = PathBuf::from(client.trim_matches('"'));
                    if path.is_file() {
                        return Some(path);
                    }
                }
            }
        }
    }

    [
        r"C:\Program Files (x86)\GOG Galaxy\GalaxyClient.exe",
        r"C:\Program Files\GOG Galaxy\GalaxyClient.exe",
    ]
    .iter()
    .map(PathBuf::from)
    .find(|path| path.is_file())
}

#[cfg(windows)]
fn launch_gog_game(app_id: Option<String>, install_path: Option<String>) -> Result<(), String> {
    let id = app_id.ok_or("No GOG game ID")?;
    let client = find_gog_galaxy_client().ok_or(crate::error_codes::GOG_GALAXY_NOT_FOUND)?;
    let mut command = std::process::Command::new(client);
    command.arg("/command=runGame").arg(format!("/gameId={}", id));
    if let Some(path) = install_path {
        command.arg(format!("/path={}", path));
    }
    command.spawn().map(|_| ()).map_err(|e| crate::error_codes::with_detail(crate::error_codes::GOG_LAUNCH, e))
}

#[cfg(not(windows))]
fn launch_gog_game(_app_id: Option<String>, _install_path: Option<String>) -> Result<(), String> {
    Err(crate::error_codes::GOG_WINDOWS_ONLY.into())
}
