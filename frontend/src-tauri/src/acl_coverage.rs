// Every command registered in lib.rs's `generate_handler!` must also be
// allowed by a permission file, or Tauri's ACL rejects the invoke at runtime
// and the frontend only sees a generic error (which callers often swallow —
// the profile once rendered an empty library because a new catalog command
// was missing here). This test keeps the two lists in sync at `cargo test`
// time instead of at first click.
#[cfg(test)]
mod tests {
    use std::collections::BTreeSet;

    const LIB_RS: &str = include_str!("lib.rs");
    const PERMISSION_FILES: &[&str] = &[
        include_str!("../permissions/default.toml"),
        include_str!("../permissions/player.toml"),
    ];

    fn registered_commands() -> BTreeSet<String> {
        let start = LIB_RS.find("generate_handler![").expect("generate_handler! in lib.rs");
        let body = &LIB_RS[start + "generate_handler![".len()..];
        let end = body.find(']').expect("closing bracket of generate_handler!");
        body[..end]
            .lines()
            .map(|line| line.split("//").next().unwrap_or("").trim().trim_end_matches(','))
            .filter(|entry| !entry.is_empty())
            .map(|entry| entry.rsplit("::").next().unwrap_or(entry).to_string())
            .collect()
    }

    fn allowed_commands() -> BTreeSet<String> {
        PERMISSION_FILES
            .iter()
            .flat_map(|file| file.lines())
            .filter_map(|line| {
                let line = line.trim().trim_end_matches(',');
                line.strip_prefix('"')?.strip_suffix('"').map(str::to_string)
            })
            .collect()
    }

    #[test]
    fn every_registered_command_is_allowed_by_a_permission() {
        let missing: Vec<String> = registered_commands()
            .difference(&allowed_commands())
            .cloned()
            .collect();
        assert!(
            missing.is_empty(),
            "commands registered in lib.rs but absent from permissions/*.toml: {missing:?}"
        );
    }

    #[test]
    fn every_allowed_command_is_registered() {
        let stale: Vec<String> = allowed_commands()
            .difference(&registered_commands())
            .cloned()
            .collect();
        assert!(
            stale.is_empty(),
            "commands allowed in permissions/*.toml but not registered in lib.rs: {stale:?}"
        );
    }
}
