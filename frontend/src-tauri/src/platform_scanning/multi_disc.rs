// Multi-disc sets in the ROM scan: "Final Fantasy VII (USA) (Disc 1).chd",
// "(Disc 2 of 3)", "(CD1)", "[Disc 1]", "- Disc 1", "(Disk A)", "(Side B)"...
// become ONE library entry per game instead of one card per disc.
//
// What happens to a folder's files, in order:
//   1. Every .cue/.gdi claims the track files it references (and a same-stem
//      .bin), so a cue+bin dump is one disc whose file is the .cue.
//   2. Every .m3u claims the scanned discs it lists; those form a set in the
//      playlist's order and the playlist is reused as-is (never rewritten).
//   3. The remaining disc-tagged files group by (folder, title without the
//      disc tag). Discs of one game may also live in sibling folders named
//      after the disc ("Game (Disc 1)/game.cue"); the set then belongs to
//      the parent folder. A group needs two distinct discs to be a set.
//   4. A new set gets "<title>.m3u" (relative paths, disc order) next to its
//      discs, only when no file of that name exists and the folder accepts
//      a new file. A user's own .m3u is never overwritten.
//
// A set's identity (app_id) is its first disc's path, so the old Disc 1
// card keeps its links, covers and playtime; every path that used to be a
// card of its own (other discs, a claimed .bin, the playlist) is reported
// in `replaced` for rom_disc_merge.rs to fold into it.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

use super::rom_library::RomFile;

/// Disc-image formats a set can be made of (plus the playlist itself).
pub const DISC_EXTENSIONS: &[&str] = &[
    "chd", "iso", "cue", "bin", "pbp", "gdi", "cso", "zso", "rvz", "img", "ccd", "mds", "gcz", "gcm", "wbfs", "ecm",
];

/// When two dumps of the same disc sit side by side, the first format here wins.
const EXTENSION_PREFERENCE: &[&str] = &[
    "cue", "gdi", "chd", "pbp", "rvz", "iso", "cso", "zso", "gcz", "gcm", "wbfs", "ccd", "mds", "img", "ecm", "bin",
];

const MAX_TEXT_BYTES: u64 = 256 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct DiscNumber {
    /// 1-based ("Disk A" = 1).
    pub number: u32,
    /// Flippy-disk side, A = 0.
    pub side: u32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DiscTag {
    /// The name with the disc tag removed: "Final Fantasy VII (USA)". Empty
    /// when the whole name was the tag (a folder called "Disc 1").
    pub base: String,
    pub disc: DiscNumber,
    pub total: Option<u32>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Designator {
    Disc { number: u32, total: Option<u32>, side: Option<u32> },
    Side(u32),
}

fn side_letter(text: &str) -> Option<u32> {
    let text = text.trim();
    let mut chars = text.chars();
    let letter = chars.next()?;
    if chars.next().is_some() {
        return None;
    }
    match letter.to_ascii_lowercase() {
        c @ 'a'..='d' => Some(c as u32 - 'a' as u32),
        _ => None,
    }
}

fn leading_digits(text: &str) -> Option<(u32, &str)> {
    let end = text.find(|c: char| !c.is_ascii_digit()).unwrap_or(text.len());
    if end == 0 || end > 2 {
        return None;
    }
    Some((text[..end].parse().ok()?, &text[end..]))
}

// "Disc 1", "disk 2 of 3", "CD1", "Disc A", "Disk 1 Side B", "Side A".
fn parse_designator(text: &str) -> Option<Designator> {
    let lower = text.trim().to_ascii_lowercase();
    if let Some(rest) = lower.strip_prefix("side") {
        let rest = rest.strip_prefix([' ', '_', '-'])?;
        return side_letter(rest).map(Designator::Side);
    }
    let (rest, letters_allowed) = match lower.strip_prefix("disc").or_else(|| lower.strip_prefix("disk")) {
        Some(rest) => (rest, true),
        None => (lower.strip_prefix("cd")?, false),
    };
    let separated = rest.starts_with([' ', '_', '-', '.']);
    let rest = rest.trim_start_matches([' ', '_', '-', '.']);
    let (number, rest) = if let Some((number, rest)) = leading_digits(rest) {
        (number, rest)
    } else if letters_allowed && separated {
        // "Disk A" — only with a separator, so "Disco" is never disc O.
        let letter = rest.chars().next()?;
        let after = &rest[letter.len_utf8()..];
        if !after.is_empty() && !after.starts_with(' ') {
            return None;
        }
        (side_letter(&letter.to_string())? + 1, after)
    } else {
        return None;
    };
    if number == 0 {
        return None;
    }
    let mut rest = rest.trim_start();
    let mut total = None;
    if let Some(after) = rest.strip_prefix("of").or_else(|| rest.strip_prefix('/')) {
        let (n, after) = leading_digits(after.trim_start())?;
        total = Some(n);
        rest = after.trim_start();
    }
    let mut side = None;
    if let Some(after) = rest.strip_prefix("side") {
        side = Some(side_letter(after.trim_start_matches([' ', '_', '-']))?);
        rest = "";
    }
    rest.trim().is_empty().then_some(Designator::Disc { number, total, side })
}

// "Final Fantasy VIII - Disc 1", "Game_Disc2", "Game CD1": a designator at
// the very end of the untagged part of a name, after a separator.
fn trailing_designator(head: &str) -> Option<(String, Designator)> {
    let trimmed = head.trim_end();
    if let Some(found @ Designator::Disc { .. }) = parse_designator(trimmed) {
        return Some((String::new(), found));
    }
    let lower = trimmed.to_ascii_lowercase();
    let bytes = lower.as_bytes();
    let mut best = None;
    for keyword in ["disc", "disk", "cd"] {
        for (at, _) in lower.match_indices(keyword) {
            if at == 0 || !matches!(bytes[at - 1], b' ' | b'-' | b'_' | b'.') {
                continue;
            }
            if let Some(found @ Designator::Disc { .. }) = parse_designator(&trimmed[at..]) {
                match &best {
                    Some((prev, _)) if *prev >= at => {}
                    _ => best = Some((at, found)),
                }
            }
        }
    }
    best.map(|(at, found)| (trimmed[..at].trim_end_matches([' ', '-', '_', '.']).to_string(), found))
}

fn tidy(name: &str) -> String {
    let collapsed = name.replace("()", " ").replace("[]", " ").split_whitespace().collect::<Vec<_>>().join(" ");
    collapsed.trim_matches([' ', '-', '_', '.', ',']).to_string()
}

/// The disc tag in a file or folder name, if it has one.
pub fn parse_disc_tag(name: &str) -> Option<DiscTag> {
    let mut number: Option<(u32, Option<u32>)> = None;
    let mut side: Option<u32> = None;
    let mut kept = String::with_capacity(name.len());
    let mut rest = name;
    while let Some(open) = rest.find(['(', '[']) {
        let close_char = if rest.as_bytes()[open] == b'(' { ')' } else { ']' };
        let Some(close) = rest[open + 1..].find(close_char).map(|i| open + 1 + i) else { break };
        kept.push_str(&rest[..open]);
        let inner = &rest[open + 1..close];
        match parse_designator(inner) {
            Some(Designator::Disc { number: n, total, side: s }) if number.is_none() => {
                number = Some((n, total));
                if s.is_some() {
                    side = s;
                }
                kept.push(' ');
            }
            Some(Designator::Side(s)) if side.is_none() => {
                side = Some(s);
                kept.push(' ');
            }
            _ => kept.push_str(&rest[open..=close]),
        }
        rest = &rest[close + 1..];
    }
    kept.push_str(rest);

    if number.is_none() {
        let split = kept.find(['(', '[']).unwrap_or(kept.len());
        let (head, tail) = kept.split_at(split);
        if let Some((prefix, Designator::Disc { number: n, total, side: s })) = trailing_designator(head) {
            number = Some((n, total));
            if s.is_some() {
                side = s;
            }
            kept = format!("{prefix} {tail}");
        }
    }
    let (number, total) = match (number, side) {
        (Some(found), _) => found,
        (None, Some(_)) => (1, None),
        (None, None) => return None,
    };
    Some(DiscTag { base: tidy(&kept), disc: DiscNumber { number, side: side.unwrap_or(0) }, total })
}

// ─── Playlists and cue sheets ────────────────────────────────────────────────

/// File access the stacking needs, so tests can run on an in-memory folder.
pub trait DiscFs {
    fn read_text(&self, path: &Path) -> Option<String>;
    fn exists(&self, path: &Path) -> bool;
    /// Creates `path` with `content`; false when it already exists or the
    /// folder does not accept new files.
    fn create_new(&self, path: &Path, content: &str) -> bool;
}

pub struct RealFs;

impl DiscFs for RealFs {
    fn read_text(&self, path: &Path) -> Option<String> {
        let meta = std::fs::metadata(path).ok()?;
        if !meta.is_file() || meta.len() > MAX_TEXT_BYTES {
            return None;
        }
        let bytes = std::fs::read(path).ok()?;
        Some(String::from_utf8_lossy(&bytes).into_owned())
    }

    fn exists(&self, path: &Path) -> bool {
        path.exists()
    }

    fn create_new(&self, path: &Path, content: &str) -> bool {
        use std::io::Write;
        let Ok(mut file) = std::fs::OpenOptions::new().write(true).create_new(true).open(path) else { return false };
        if file.write_all(content.as_bytes()).is_ok() {
            return true;
        }
        drop(file);
        let _ = std::fs::remove_file(path);
        false
    }
}

pub fn path_key(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/").to_lowercase()
}

fn resolve_entry(dir: &Path, entry: &str) -> PathBuf {
    let entry = entry.trim().trim_matches('"');
    let candidate = Path::new(entry);
    if candidate.is_absolute() || entry.starts_with(['/', '\\']) || entry.get(1..2) == Some(":") {
        candidate.to_path_buf()
    } else {
        dir.join(entry.replace('\\', "/"))
    }
}

/// The entries of an .m3u playlist, in order (comments and blanks skipped).
pub fn parse_m3u(content: &str) -> Vec<String> {
    content
        .lines()
        .map(|line| line.trim().trim_start_matches('\u{feff}').trim())
        .filter(|line| !line.is_empty() && !line.starts_with('#'))
        .map(str::to_string)
        .collect()
}

/// The .m3u Metadea writes: one relative path per disc, forward slashes
/// (every emulator on every OS reads them), in disc order.
pub fn build_m3u(dir: &Path, discs: &[PathBuf]) -> String {
    let mut out = String::new();
    for disc in discs {
        let relative = disc.strip_prefix(dir).unwrap_or(disc);
        out.push_str(&relative.to_string_lossy().replace('\\', "/"));
        out.push('\n');
    }
    out
}

/// Track files a .cue (FILE "x.bin" BINARY) or .gdi (N lba type size file off) references.
pub fn parse_track_files(extension: &str, content: &str) -> Vec<String> {
    let mut out = Vec::new();
    for line in content.lines() {
        let line = line.trim();
        if extension.eq_ignore_ascii_case("cue") {
            let Some(rest) = line.get(..5).filter(|p| p.eq_ignore_ascii_case("file ")).map(|_| line[5..].trim()) else { continue };
            if let Some(quoted) = rest.strip_prefix('"') {
                if let Some(end) = quoted.find('"') {
                    out.push(quoted[..end].to_string());
                }
            } else if let Some((name, _kind)) = rest.rsplit_once(char::is_whitespace) {
                out.push(name.trim().to_string());
            }
        } else if let (Some(start), Some(end)) = (line.find('"'), line.rfind('"')) {
            if end > start {
                out.push(line[start + 1..end].to_string());
            }
        } else if let Some(name) = line.split_whitespace().nth(4) {
            out.push(name.to_string());
        }
    }
    out
}

// ─── Stacking ────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DiscSet {
    /// The name the entry shows and matches IGDB with, disc tag removed.
    pub title_stem: String,
    pub discs: Vec<RomFile>,
    pub playlist: Option<String>,
    /// Paths that used to be library entries of their own and now belong
    /// to this set (other discs, claimed .bin tracks, the playlist...).
    pub replaced: Vec<String>,
}

#[derive(Debug, Default)]
pub struct StackResult {
    pub sets: Vec<DiscSet>,
    /// Files that are not part of a set, for the regular grouping.
    pub singles: Vec<RomFile>,
    /// For a single .cue/.gdi: the track files it absorbed.
    pub absorbed: HashMap<String, Vec<String>>,
}

fn extension_of(file: &RomFile) -> String {
    file.extension.to_ascii_lowercase()
}

fn is_disc_file(file: &RomFile) -> bool {
    DISC_EXTENSIONS.contains(&extension_of(file).as_str())
}

fn extension_rank(file: &RomFile) -> usize {
    let ext = extension_of(file);
    EXTENSION_PREFERENCE.iter().position(|e| *e == ext).unwrap_or(EXTENSION_PREFERENCE.len())
}

// Where a disc's set lives and what it is called: the file's own tag first,
// else the tag of the folder it sits in (then the set belongs to the parent
// of that folder).
fn disc_identity(file: &RomFile) -> Option<(PathBuf, String, DiscNumber)> {
    let path = Path::new(&file.path);
    let parent = path.parent()?;
    let folder_tag = parent.file_name().and_then(|n| n.to_str()).and_then(parse_disc_tag);
    let own = parse_disc_tag(&file.stem);
    let group_dir = match (&folder_tag, parent.parent()) {
        (Some(_), Some(grandparent)) => grandparent.to_path_buf(),
        _ => parent.to_path_buf(),
    };
    let (base, disc) = match (own, folder_tag) {
        (Some(tag), _) if !tag.base.is_empty() => (tag.base, tag.disc),
        (_, Some(folder)) if !folder.base.is_empty() => (folder.base, folder.disc),
        (Some(tag), _) => (tag.base, tag.disc),
        (None, Some(folder)) => (tidy(&file.stem), folder.disc),
        (None, None) => return None,
    };
    if base.is_empty() {
        return None;
    }
    Some((group_dir, base, disc))
}

fn group_key(dir: &Path, base: &str) -> String {
    format!("{}|{}", path_key(dir), base.to_lowercase())
}

/// (set folder, title without the disc tag, its discs).
type TagGroup = (PathBuf, String, Vec<(DiscNumber, RomFile)>);

struct PendingSet {
    dir: PathBuf,
    title_stem: String,
    playlist: Option<PathBuf>,
    /// The scanned playlist file itself, given back as a game of its own
    /// when it turns out to list a single disc.
    playlist_file: Option<RomFile>,
    /// Existing playlist whose order is kept (claimed discs first).
    discs: Vec<(Option<DiscNumber>, RomFile)>,
    replaced: Vec<String>,
}

impl PendingSet {
    fn push(&mut self, disc: Option<DiscNumber>, file: RomFile) {
        self.discs.push((disc, file));
    }
}

/// Splits a folder's scanned files into multi-disc sets and everything else.
/// `files` is one emulator's scan (rom_library::scan_rom_folder_files).
pub fn stack_multi_disc(files: Vec<RomFile>, fs: &dyn DiscFs) -> StackResult {
    let mut result = StackResult::default();
    let order: HashMap<String, usize> = files.iter().enumerate().map(|(i, f)| (f.path.clone(), i)).collect();

    // 1. Cue sheets / GDI claim their track files.
    let mut claimed_by: HashMap<String, String> = HashMap::new();
    for file in files.iter().filter(|f| matches!(extension_of(f).as_str(), "cue" | "gdi")) {
        let path = Path::new(&file.path);
        let dir = path.parent().unwrap_or(Path::new(""));
        let mut tracks: Vec<String> = fs
            .read_text(path)
            .map(|content| parse_track_files(&file.extension, &content))
            .unwrap_or_default()
            .into_iter()
            .map(|entry| path_key(&resolve_entry(dir, &entry)))
            .collect();
        tracks.push(path_key(&dir.join(format!("{}.bin", file.stem))));
        for track in tracks {
            if track != path_key(path) {
                claimed_by.entry(track).or_insert_with(|| file.path.clone());
            }
        }
    }
    let mut pool: Vec<RomFile> = Vec::with_capacity(files.len());
    for file in files {
        match claimed_by.get(&path_key(Path::new(&file.path))) {
            Some(owner) if extension_of(&file) != "cue" && extension_of(&file) != "gdi" => {
                result.absorbed.entry(owner.clone()).or_default().push(file.path);
            }
            _ => pool.push(file),
        }
    }

    // 2. Existing playlists claim the discs they list.
    let (playlists, rest): (Vec<RomFile>, Vec<RomFile>) = pool.into_iter().partition(|f| extension_of(f) == "m3u");
    let mut by_key: HashMap<String, usize> = rest.iter().enumerate().map(|(i, f)| (path_key(Path::new(&f.path)), i)).collect();
    let mut taken: HashSet<usize> = HashSet::new();
    let mut pending: Vec<PendingSet> = Vec::new();
    let mut pending_by_key: HashMap<String, usize> = HashMap::new();
    let mut unused_playlists: Vec<RomFile> = Vec::new();
    for playlist in playlists {
        let path = PathBuf::from(&playlist.path);
        let dir = path.parent().unwrap_or(Path::new("")).to_path_buf();
        let entries = fs.read_text(&path).map(|c| parse_m3u(&c)).unwrap_or_default();
        let listed: Vec<usize> = entries
            .iter()
            .filter_map(|entry| by_key.get(&path_key(&resolve_entry(&dir, entry))).copied())
            .filter(|i| !taken.contains(i))
            .collect();
        if listed.is_empty() {
            unused_playlists.push(playlist);
            continue;
        }
        let mut set = PendingSet {
            dir: dir.clone(),
            title_stem: playlist.stem.clone(),
            playlist: Some(path.clone()),
            playlist_file: None,
            discs: Vec::new(),
            replaced: vec![playlist.path.clone()],
        };
        let mut seen = HashSet::new();
        for i in listed {
            if seen.insert(i) {
                taken.insert(i);
                set.push(disc_identity(&rest[i]).map(|(_, _, d)| d), rest[i].clone());
            }
        }
        pending_by_key.insert(group_key(&dir, &playlist.stem), pending.len());
        set.playlist_file = Some(playlist);
        pending.push(set);
    }
    by_key.clear();

    // 3. Tag-based groups from what no playlist claimed.
    let mut groups: Vec<TagGroup> = Vec::new();
    let mut group_index: HashMap<String, usize> = HashMap::new();
    let mut singles: Vec<RomFile> = Vec::new();
    for (i, file) in rest.into_iter().enumerate() {
        if taken.contains(&i) {
            continue;
        }
        let identity = if is_disc_file(&file) { disc_identity(&file) } else { None };
        let Some((dir, base, disc)) = identity else {
            singles.push(file);
            continue;
        };
        let key = group_key(&dir, &base);
        let index = *group_index.entry(key).or_insert_with(|| {
            groups.push((dir, base, Vec::new()));
            groups.len() - 1
        });
        groups[index].2.push((disc, file));
    }

    for (dir, base, mut discs) in groups {
        // Two dumps of the same disc: keep the preferred format, fold the other.
        discs.sort_by(|a, b| a.0.cmp(&b.0).then(extension_rank(&a.1).cmp(&extension_rank(&b.1))).then(a.1.path.cmp(&b.1.path)));
        let mut unique: Vec<(DiscNumber, RomFile)> = Vec::new();
        let mut alternates: Vec<String> = Vec::new();
        for (disc, file) in discs {
            if unique.last().is_some_and(|(last, _)| *last == disc) {
                alternates.push(file.path);
            } else {
                unique.push((disc, file));
            }
        }
        if let Some(&index) = pending_by_key.get(&group_key(&dir, &base)) {
            let set = &mut pending[index];
            for (disc, file) in unique {
                set.push(Some(disc), file);
            }
            set.replaced.extend(alternates);
            continue;
        }
        if unique.len() < 2 {
            // One disc of a set on its own is just a game.
            let (_, file) = unique.remove(0);
            singles.push(file);
            // An alternate dump of it stays a candidate for the stem dedupe.
            continue;
        }
        pending.push(PendingSet {
            dir,
            title_stem: base,
            playlist: None,
            playlist_file: None,
            discs: unique.into_iter().map(|(d, f)| (Some(d), f)).collect(),
            replaced: alternates,
        });
    }

    // 4. Playlists for sets that have none.
    for mut set in pending {
        if set.playlist.is_none() && set.discs.len() >= 2 {
            let candidate = set.dir.join(format!("{}.m3u", set.title_stem));
            let disc_paths: Vec<PathBuf> = set.discs.iter().map(|(_, f)| PathBuf::from(&f.path)).collect();
            if fs.exists(&candidate) {
                // Someone else's file: used only when it lists these discs.
                let entries = fs.read_text(&candidate).map(|c| parse_m3u(&c)).unwrap_or_default();
                let keys: HashSet<String> = disc_paths.iter().map(|p| path_key(p)).collect();
                if entries.iter().any(|e| keys.contains(&path_key(&resolve_entry(&set.dir, e)))) {
                    set.playlist = Some(candidate);
                }
            } else if fs.create_new(&candidate, &build_m3u(&set.dir, &disc_paths)) {
                set.playlist = Some(candidate);
            }
        }
        let mut replaced = set.replaced;
        let discs: Vec<RomFile> = set.discs.into_iter().map(|(_, f)| f).collect();
        for disc in discs.iter().skip(1) {
            replaced.push(disc.path.clone());
        }
        for disc in &discs {
            if let Some(tracks) = result.absorbed.remove(&disc.path) {
                replaced.extend(tracks);
            }
        }
        if discs.len() < 2 {
            // A playlist listing a single scanned disc: both stay what they
            // were, two plain entries.
            singles.extend(discs);
            singles.extend(set.playlist_file);
            continue;
        }
        result.sets.push(DiscSet {
            title_stem: set.title_stem,
            discs,
            playlist: set.playlist.map(|p| p.to_string_lossy().to_string()),
            replaced,
        });
    }
    singles.extend(unused_playlists);
    // Scan order, so the stem dedupe after this keeps the same file it did
    // before stacking existed.
    singles.sort_by_key(|f| order.get(&f.path).copied().unwrap_or(usize::MAX));
    result.singles = singles;
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;

    fn tag(name: &str) -> Option<(String, u32, u32)> {
        parse_disc_tag(name).map(|t| (t.base, t.disc.number, t.disc.side))
    }

    #[test]
    fn parses_real_world_disc_tags() {
        let cases: &[(&str, &str, u32, u32)] = &[
            ("Final Fantasy VII (USA) (Disc 1)", "Final Fantasy VII (USA)", 1, 0),
            ("Final Fantasy VII (USA) (Disc 2)", "Final Fantasy VII (USA)", 2, 0),
            ("Metal Gear Solid (USA) (Disc 2) (Rev 1)", "Metal Gear Solid (USA) (Rev 1)", 2, 0),
            ("Chrono Cross (USA) (Disc 2 of 2)", "Chrono Cross (USA)", 2, 0),
            ("Parasite Eve (CD1)", "Parasite Eve", 1, 0),
            ("Parasite Eve (CD 2)", "Parasite Eve", 2, 0),
            ("Xenogears [Disc 1]", "Xenogears", 1, 0),
            ("Xenogears [Disc2]", "Xenogears", 2, 0),
            ("Final Fantasy VIII - Disc 3", "Final Fantasy VIII", 3, 0),
            ("Final Fantasy IX - Disc 4 (USA)", "Final Fantasy IX (USA)", 4, 0),
            ("Legend of Dragoon_Disc1", "Legend of Dragoon", 1, 0),
            ("Shenmue CD2", "Shenmue", 2, 0),
            ("Monkey Island (Disk A)", "Monkey Island", 1, 0),
            ("Monkey Island (Disk B)", "Monkey Island", 2, 0),
            ("Zelda no Densetsu (Japan) (Side B)", "Zelda no Densetsu (Japan)", 1, 1),
            ("Lemmings (1991)(Psygnosis)(Disk 1 of 2)(Side A)", "Lemmings (1991)(Psygnosis)", 1, 0),
            ("Lemmings (1991)(Psygnosis)(Disk 2 of 2)(Side B)", "Lemmings (1991)(Psygnosis)", 2, 1),
            ("Riven (Disc 5 of 5) [!]", "Riven [!]", 5, 0),
            ("Disc 1", "", 1, 0),
            ("Resident Evil 2 (Leon) (disc 1)", "Resident Evil 2 (Leon)", 1, 0),
        ];
        for (name, base, number, side) in cases {
            assert_eq!(tag(name), Some((base.to_string(), *number, *side)), "{name}");
        }
    }

    #[test]
    fn titles_that_merely_contain_disc_words_are_not_tags() {
        for name in [
            "Disco Elysium",
            "Disco Elysium - The Final Cut",
            "CD Projekt Collection",
            "Discworld",
            "Discworld II - Missing Presumed (Europe)",
            "Disc Room",
            "Night Trap (Sega CD)",
            "Snatcher (USA) (Disco)",
            "Diskworld (Disk)",
            "Side Pocket",
            "Tekken 3 (USA)",
            "The Discovery (Disc Golf)",
            "Game (Side Story)",
            "Disc Jockey 100",
        ] {
            assert_eq!(tag(name), None, "{name}");
        }
    }

    #[test]
    fn parses_cue_and_gdi_track_references() {
        let cue = "FILE \"Final Fantasy VII (USA) (Disc 1) (Track 1).bin\" BINARY\n  TRACK 01 MODE2/2352\nfile track02.bin BINARY\n";
        assert_eq!(parse_track_files("cue", cue), vec!["Final Fantasy VII (USA) (Disc 1) (Track 1).bin", "track02.bin"]);
        let gdi = "3\n1 0 4 2352 track01.bin 0\n2 756 0 2352 \"track 02.raw\" 0\n3 45000 4 2352 track03.bin 0\n";
        assert_eq!(parse_track_files("gdi", gdi), vec!["track01.bin", "track 02.raw", "track03.bin"]);
    }

    #[test]
    fn m3u_is_relative_ordered_and_round_trips() {
        let dir = Path::new("/roms/psx");
        let discs = vec![dir.join("FF7 (Disc 1).chd"), dir.join("FF7 (Disc 2).chd"), dir.join("FF7 (Disc 3)").join("ff7.cue")];
        let content = build_m3u(dir, &discs);
        assert_eq!(content, "FF7 (Disc 1).chd\nFF7 (Disc 2).chd\nFF7 (Disc 3)/ff7.cue\n");
        assert_eq!(parse_m3u(&format!("\u{feff}#EXTM3U\n\n{content}")), vec!["FF7 (Disc 1).chd", "FF7 (Disc 2).chd", "FF7 (Disc 3)/ff7.cue"]);
    }

    // ── In-memory folder ─────────────────────────────────────────────────────

    #[derive(Default)]
    struct MemFs {
        files: RefCell<HashMap<String, String>>,
        read_only: bool,
    }

    impl MemFs {
        fn with(files: &[(&str, &str)]) -> Self {
            let fs = MemFs::default();
            for (path, content) in files {
                fs.files.borrow_mut().insert(path_key(Path::new(path)), content.to_string());
            }
            fs
        }
        fn content(&self, path: &str) -> Option<String> {
            self.files.borrow().get(&path_key(Path::new(path))).cloned()
        }
    }

    impl DiscFs for MemFs {
        fn read_text(&self, path: &Path) -> Option<String> {
            self.files.borrow().get(&path_key(path)).cloned()
        }
        fn exists(&self, path: &Path) -> bool {
            self.files.borrow().contains_key(&path_key(path))
        }
        fn create_new(&self, path: &Path, content: &str) -> bool {
            if self.read_only || self.exists(path) {
                return false;
            }
            self.files.borrow_mut().insert(path_key(path), content.to_string());
            true
        }
    }

    fn rom(path: &str) -> RomFile {
        let p = Path::new(path);
        RomFile {
            path: path.to_string(),
            file_name: p.file_name().unwrap().to_string_lossy().to_string(),
            stem: p.file_stem().unwrap().to_string_lossy().to_string(),
            extension: p.extension().map(|e| e.to_string_lossy().to_string()).unwrap_or_default(),
            title_id: None,
            kind: "base".into(),
            sidecars: Vec::new(),
            header_id: None,
            header_title: None,
        }
    }

    fn names(files: &[RomFile]) -> Vec<String> {
        files.iter().map(|f| f.file_name.clone()).collect()
    }

    #[test]
    fn groups_discs_in_order_and_writes_a_playlist() {
        let fs = MemFs::default();
        let files = vec![
            rom("/r/Final Fantasy VII (USA) (Disc 3).chd"),
            rom("/r/Final Fantasy VII (USA) (Disc 1).chd"),
            rom("/r/Final Fantasy VII (USA) (Disc 2).chd"),
            rom("/r/Final Fantasy VII (Europe) (Disc 1).chd"),
            rom("/r/Crash Bandicoot (USA).chd"),
        ];
        let result = stack_multi_disc(files, &fs);
        assert_eq!(result.sets.len(), 1);
        let set = &result.sets[0];
        assert_eq!(set.title_stem, "Final Fantasy VII (USA)");
        assert_eq!(names(&set.discs), vec![
            "Final Fantasy VII (USA) (Disc 1).chd", "Final Fantasy VII (USA) (Disc 2).chd", "Final Fantasy VII (USA) (Disc 3).chd",
        ]);
        let playlist = set.playlist.clone().unwrap();
        assert_eq!(path_key(Path::new(&playlist)), path_key(Path::new("/r/Final Fantasy VII (USA).m3u")));
        assert_eq!(
            fs.content("/r/Final Fantasy VII (USA).m3u").unwrap(),
            "Final Fantasy VII (USA) (Disc 1).chd\nFinal Fantasy VII (USA) (Disc 2).chd\nFinal Fantasy VII (USA) (Disc 3).chd\n",
        );
        assert_eq!(set.replaced, vec!["/r/Final Fantasy VII (USA) (Disc 2).chd", "/r/Final Fantasy VII (USA) (Disc 3).chd"]);
        // A different region is a different game; a lone disc stays a game.
        assert_eq!(names(&result.singles), vec!["Final Fantasy VII (Europe) (Disc 1).chd", "Crash Bandicoot (USA).chd"]);
    }

    #[test]
    fn cue_bin_sets_use_the_cue_and_absorb_their_tracks() {
        let fs = MemFs::with(&[
            ("/r/MGS (Disc 1).cue", "FILE \"MGS (Disc 1).bin\" BINARY\n"),
            ("/r/MGS (Disc 2).cue", "FILE \"MGS (Disc 2) (Track 1).bin\" BINARY\nFILE \"MGS (Disc 2) (Track 2).bin\" BINARY\n"),
            ("/r/Spyro.cue", "FILE \"Spyro.bin\" BINARY\n"),
        ]);
        let files = vec![
            rom("/r/MGS (Disc 1).bin"),
            rom("/r/MGS (Disc 1).cue"),
            rom("/r/MGS (Disc 2) (Track 1).bin"),
            rom("/r/MGS (Disc 2) (Track 2).bin"),
            rom("/r/MGS (Disc 2).cue"),
            rom("/r/Spyro.bin"),
            rom("/r/Spyro.cue"),
        ];
        let result = stack_multi_disc(files, &fs);
        assert_eq!(result.sets.len(), 1);
        assert_eq!(names(&result.sets[0].discs), vec!["MGS (Disc 1).cue", "MGS (Disc 2).cue"]);
        let mut replaced = result.sets[0].replaced.clone();
        replaced.sort();
        assert_eq!(replaced, vec!["/r/MGS (Disc 1).bin", "/r/MGS (Disc 2) (Track 1).bin", "/r/MGS (Disc 2) (Track 2).bin", "/r/MGS (Disc 2).cue"]);
        assert_eq!(fs.content("/r/MGS.m3u").unwrap(), "MGS (Disc 1).cue\nMGS (Disc 2).cue\n");
        assert_eq!(names(&result.singles), vec!["Spyro.cue"]);
        assert_eq!(result.absorbed.get("/r/Spyro.cue").unwrap(), &vec!["/r/Spyro.bin".to_string()]);
    }

    #[test]
    fn an_existing_playlist_is_used_as_is_and_never_rewritten() {
        let original = "# mine\nGame (Disc 2).chd\nGame (Disc 1).chd\n";
        let fs = MemFs::with(&[("/r/Game.m3u", original)]);
        let files = vec![rom("/r/Game (Disc 1).chd"), rom("/r/Game (Disc 2).chd"), rom("/r/Game.m3u")];
        let result = stack_multi_disc(files, &fs);
        assert_eq!(result.sets.len(), 1);
        let set = &result.sets[0];
        // The user's order wins.
        assert_eq!(names(&set.discs), vec!["Game (Disc 2).chd", "Game (Disc 1).chd"]);
        assert_eq!(set.playlist.as_deref(), Some("/r/Game.m3u"));
        assert_eq!(fs.content("/r/Game.m3u").unwrap(), original);
        assert!(result.singles.is_empty());
        assert!(set.replaced.contains(&"/r/Game.m3u".to_string()));
    }

    #[test]
    fn a_playlist_listing_a_subset_gets_the_remaining_discs_appended_in_memory_only() {
        let fs = MemFs::with(&[("/r/Game.m3u", "Game (Disc 1).chd\n")]);
        let files = vec![rom("/r/Game (Disc 1).chd"), rom("/r/Game (Disc 2).chd"), rom("/r/Game.m3u")];
        let result = stack_multi_disc(files, &fs);
        assert_eq!(result.sets.len(), 1);
        assert_eq!(names(&result.sets[0].discs), vec!["Game (Disc 1).chd", "Game (Disc 2).chd"]);
        assert_eq!(fs.content("/r/Game.m3u").unwrap(), "Game (Disc 1).chd\n");
    }

    #[test]
    fn a_foreign_file_with_the_playlist_name_is_left_alone() {
        let fs = MemFs::with(&[("/r/Game.m3u", "something else.chd\n")]);
        // m3u not among the scanned extensions (a GameCube folder, say).
        let files = vec![rom("/r/Game (Disc 1).iso"), rom("/r/Game (Disc 2).iso")];
        let result = stack_multi_disc(files, &fs);
        assert_eq!(result.sets[0].playlist, None);
        assert_eq!(fs.content("/r/Game.m3u").unwrap(), "something else.chd\n");
    }

    #[test]
    fn an_unscanned_playlist_that_lists_the_discs_is_picked_up() {
        let fs = MemFs::with(&[("/r/Tales (USA).m3u", "Tales (USA) (Disc 1).rvz\nTales (USA) (Disc 2).rvz\n")]);
        let files = vec![rom("/r/Tales (USA) (Disc 1).rvz"), rom("/r/Tales (USA) (Disc 2).rvz")];
        let result = stack_multi_disc(files, &fs);
        assert_eq!(result.sets[0].playlist.as_deref().map(|p| path_key(Path::new(p))), Some(path_key(Path::new("/r/Tales (USA).m3u"))));
    }

    #[test]
    fn a_read_only_folder_still_groups_without_a_playlist() {
        let fs = MemFs { read_only: true, ..MemFs::default() };
        let result = stack_multi_disc(vec![rom("/r/A (CD1).iso"), rom("/r/A (CD2).iso")], &fs);
        assert_eq!(result.sets.len(), 1);
        assert_eq!(result.sets[0].playlist, None);
    }

    #[test]
    fn sibling_folders_named_after_the_disc_form_one_set_in_the_parent() {
        let fs = MemFs::with(&[
            ("/r/Grandia (Disc 1)/grandia.cue", "FILE \"grandia.bin\" BINARY\n"),
            ("/r/Grandia (Disc 2)/grandia.cue", "FILE \"grandia.bin\" BINARY\n"),
        ]);
        let files = vec![
            rom("/r/Grandia (Disc 1)/grandia.bin"),
            rom("/r/Grandia (Disc 1)/grandia.cue"),
            rom("/r/Grandia (Disc 2)/grandia.bin"),
            rom("/r/Grandia (Disc 2)/grandia.cue"),
        ];
        let result = stack_multi_disc(files, &fs);
        assert_eq!(result.sets.len(), 1);
        assert_eq!(result.sets[0].title_stem, "Grandia");
        assert_eq!(fs.content("/r/Grandia.m3u").unwrap(), "Grandia (Disc 1)/grandia.cue\nGrandia (Disc 2)/grandia.cue\n");
    }

    #[test]
    fn duplicate_dumps_of_one_disc_keep_the_preferred_format() {
        let fs = MemFs::default();
        let files = vec![rom("/r/G (Disc 1).iso"), rom("/r/G (Disc 1).chd"), rom("/r/G (Disc 2).chd")];
        let result = stack_multi_disc(files, &fs);
        assert_eq!(names(&result.sets[0].discs), vec!["G (Disc 1).chd", "G (Disc 2).chd"]);
        assert!(result.sets[0].replaced.contains(&"/r/G (Disc 1).iso".to_string()));
    }

    #[test]
    fn false_positive_titles_stay_separate_games() {
        let fs = MemFs::default();
        let files = vec![rom("/r/Disco Elysium.iso"), rom("/r/Discworld (USA).chd"), rom("/r/Discworld II (USA).chd")];
        let result = stack_multi_disc(files, &fs);
        assert!(result.sets.is_empty());
        assert_eq!(result.singles.len(), 3);
        assert!(fs.files.borrow().is_empty(), "no playlist written");
    }
}
