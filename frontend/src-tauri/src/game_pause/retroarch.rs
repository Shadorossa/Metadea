//! "Save state" in the pause menu: RetroArch's network command interface
//! (UDP `SAVE_STATE` to 127.0.0.1:<network_cmd_port>, 55355 by default).
//! Offered only when the running emulator is RetroArch and its config has
//! `network_cmd_enable = "true"` (portable retroarch.cfg next to the exe
//! first, then %APPDATA%\RetroArch\retroarch.cfg).

use std::path::{Path, PathBuf};

pub const DEFAULT_PORT: u16 = 55355;

fn cfg_value<'a>(cfg: &'a str, key: &str) -> Option<&'a str> {
    cfg.lines().rev().find_map(|line| {
        let (name, value) = line.split_once('=')?;
        (name.trim() == key).then(|| value.trim().trim_matches('"'))
    })
}

/// The command port when network commands are enabled in `cfg`.
pub fn network_command_port(cfg: &str) -> Option<u16> {
    if cfg_value(cfg, "network_cmd_enable")? != "true" {
        return None;
    }
    Some(cfg_value(cfg, "network_cmd_port").and_then(|port| port.parse().ok()).unwrap_or(DEFAULT_PORT))
}

fn config_candidates(exe_path: &Path, appdata: Option<PathBuf>) -> Vec<PathBuf> {
    let mut out = Vec::new();
    if let Some(dir) = exe_path.parent() {
        out.push(dir.join("retroarch.cfg"));
    }
    if let Some(appdata) = appdata {
        out.push(appdata.join("RetroArch").join("retroarch.cfg"));
    }
    out
}

/// The save-state port for the emulator at `exe_path`, if it is RetroArch
/// with network commands on.
pub fn save_state_port(exe_path: &str) -> Option<u16> {
    let exe = Path::new(exe_path);
    let name = exe.file_name()?.to_string_lossy().to_lowercase();
    if !name.contains("retroarch") {
        return None;
    }
    let appdata = std::env::var_os("APPDATA").map(PathBuf::from);
    let cfg = config_candidates(exe, appdata).into_iter().find_map(|path| std::fs::read_to_string(path).ok())?;
    network_command_port(&cfg)
}

pub fn send_command(port: u16, command: &str) -> std::io::Result<()> {
    let socket = std::net::UdpSocket::bind(("127.0.0.1", 0))?;
    socket.send_to(command.as_bytes(), ("127.0.0.1", port)).map(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn port_only_when_network_commands_are_enabled() {
        assert_eq!(network_command_port("network_cmd_enable = \"true\"\n"), Some(55355));
        assert_eq!(network_command_port("network_cmd_enable = \"true\"\nnetwork_cmd_port = \"55400\"\n"), Some(55400));
        assert_eq!(network_command_port("network_cmd_enable = \"false\"\nnetwork_cmd_port = \"55400\"\n"), None);
        assert_eq!(network_command_port("video_driver = \"vulkan\"\n"), None);
        assert_eq!(network_command_port("network_cmd_enable = \"false\"\nnetwork_cmd_enable = \"true\"\n"), Some(55355), "the last value wins");
    }

    #[test]
    fn looks_next_to_the_exe_first_then_in_appdata() {
        let candidates = config_candidates(Path::new("/emu/RetroArch/retroarch.exe"), Some(PathBuf::from("/appdata")));
        assert_eq!(candidates, vec![Path::new("/emu/RetroArch").join("retroarch.cfg"), Path::new("/appdata").join("RetroArch").join("retroarch.cfg")]);
        assert_eq!(save_state_port("/emu/duckstation.exe"), None);
    }
}
