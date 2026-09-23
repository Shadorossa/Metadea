# Emulator saves

Code: `frontend/src-tauri/src/saves/` (layout, manifest, per-emulator table, mirror, RetroArch
redirect, Drive sync) and the launch hook in `src/folders/emulator_launch.rs`. UI: the "Saves"
section of the game detail panel (`components/local/details/GameSavesSection.tsx`), Settings ›
Emulators › Saves and Settings › Backup › "Sync emulator saves to Google Drive"
(`components/settings/mount/saves-settings.ts`). IPC: `lib/tauri/saves.ts`.

## Central folder

Default `%USERPROFILE%\Documents\Metadea\Saves`, configurable in Settings › Emulators (it must be
an absolute folder, not a drive root and not inside the app data folder). Changing it does not
move saves already there. The settings live in `saves-settings.json` in the app data folder; it is
machine-local (the path only makes sense on this PC), so it is left out of backups and kept
across a restore.

```text
<root>\<Platform>\<Game title>\
    metadea-saves.json                     game key, labels, source emulator, hashes, archive records
    battery\<native name>                  .srm/.sav/.mcd/.gci… or a whole save folder
    battery\.history\<name>\<YYYY-MM-DD HH-MM-SS>\<name>   last N versions (default 5)
    states\<native name>                   save states, plus RetroArch/PPSSPP screenshots
    .archive\<stamp>\<kind>\<name>         archived saves (never hard-deleted)
    .native-backups\<stamp>\…              emulator save folders replaced by a restore
<root>\<Platform>\Shared memory cards\     cards every game of a platform shares
<root>\.metadea-sync.json                  Drive sync state (hash of each file when last in sync)
```

Names are human-readable and Windows-safe (`Zelda: Twilight Princess` → `Zelda - Twilight
Princess`, reserved names/characters removed, 80 chars max). A game is found again by the
**game key** in its manifest, not by its folder name: `<platform>:id-<id>` when the ROM carries
an id (Switch title id in the file name, GameCube/Wii/DS/3DS header id, PlayStation serial in the
file name), else `<platform>:<normalized ROM file name>`. Two games whose titles collide get a
stable suffix: `Title [1a2b3c]`. Renaming a ROM without an id starts a new folder (the old one
stays).

## Per-emulator support

| Emulator | Strategy | Battery saves (native) | Save states (native) |
|---|---|---|---|
| RetroArch | **Redirect** | central `battery\` | central `states\` (+ `.png` thumbnails) |
| DuckStation | Mirror | `memcards\` (`shared_card_*` → shared folder) | `savestates\` |
| PCSX2 | Mirror | `memcards\` (shared by every game → shared folder) | `sstates\` |
| PPSSPP | Mirror | `PSP\SAVEDATA\<folder>` | `PSP\PPSSPP_STATE\` (+ `.jpg`) |
| Dolphin | Mirror | `GC\…\*.gci` (`*.raw` cards → shared), `Wii\title\00010000\<id>` | `StateSaves\` |
| melonDS | Mirror | `<ROM folder>\<rom>.sav` | `<ROM folder>\<rom>.mlN` |
| DeSmuME | Mirror | `Battery\*.dsv` | `States\` |
| Citra / Lime3DS / Azahar | Mirror | `sdmc\Nintendo 3DS\…\title\…\<id>\data` | `states\` |
| Ryujinx / Ryubing | Mirror | `bis\user\save\<n>` | — |
| Yuzu / Suyu / Citron / Eden / Sudachi | Mirror | `nand\user\save\0…0\<user>\<title id>` | — |
| Cemu | Mirror | `mlc01\usr\save\00050000\<id>` | — |
| RPCS3 | Mirror | `dev_hdd0\home\00000001\savedata\<folder>` | `savestates\` |
| Vita3K | Mirror | `ux0\user\00\savedata\<id>` | — |
| shadPS4 | Mirror | `savedata\<user>\<id>` | — |
| Xenia / Xenia Edge | Mirror | `content\<profile>\<title id>\00000001` | — |
| ePSXe, PCSXR-PGXP | Mirror | `memcards\` (shared) | `sstates\` |
| xemu | not supported | saves live inside the HDD image | — |

Each path is tried under the portable layout first (next to the executable; DuckStation,
PCSX2, Dolphin and Xenia only when their portable marker file exists) and then the per-user one
(`Documents\…`, `%APPDATA%\…`, `%LOCALAPPDATA%\DuckStation`). The table lives in
`saves/native.rs`.

**Redirect** is only used when the emulator accepts a per-launch override that leaves the
user's configuration untouched. RetroArch gets `--appendconfig <file>` (chained with `|` after a
user's own `--appendconfig`) setting `savefile_directory`/`savestate_directory` to the game's
central folders, turning off `sort_*` and `*_in_content_dir`, and `config_save_on_exit = "false"`
so the override is never written back into `retroarch.cfg` (menu changes made during a
Metadea-launched session are therefore not auto-saved). The others were not redirected:
DuckStation's `-settings` replaces the whole settings file, Dolphin's `-u`/PCSX2/PPSSPP/Citra
portable switches move every setting, and Dolphin's `-C` can only point memory cards (not
states), which would hide a user's existing raw card.

**Mirror** (`saves/mirror.rs`):

- *Before launch* (inside `launch_game`, before the process starts): every save the manifest
  knows is compared with the emulator's copy (SHA-256, then modification time with 2 s of
  slack). Central newer or native missing → copied back; the replaced native file is kept as
  `<file>.metadea-bak` (a folder is copied to `.native-backups`). Native newer (played outside
  Metadea) → captured first.
- *After exit* (the launcher's existing process wait): every native save written during the
  session — plus anything named after the game or already recorded — is copied in. The previous
  central battery save moves to `.history` (the last N versions are kept); states are replaced
  as-is. Shared cards go to `Shared memory cards` only when the session wrote them.
- Native files are never deleted; archived saves are not re-captured unless they change again.

**Import existing saves** (Settings › Emulators) runs the attribution by name/id only (no session)
for every game of the ROM library, plus each platform's shared cards once. It copies, never
moves, and is idempotent.

Matching by name is strict: `Game.sav`, `Game_1.mcd`, `Game.state3`, `Game_resume.sav` belong to
`Game`; `Game 2.sav`, `Game Kart.sav` and `Game_Bros.sav` do not. Ids match as a prefix
(`GALE01.s01`, `SLUS-20312 (…).01.p2s`, `ULUS10041DATA00`, Wii NAND hex folders) or as a whole
word (`01-GALE-…gci`).

## Full backup

With "Include game saves" (Settings › Backup, on by default, with a size estimate) the `.7z`
backup — local export and the Drive upload alike — carries the saves root under `saves/`:
each game folder's manifest, `battery\` and `states\` (not `.history`/`.archive`), plus
`saves/.metadea-backup-index.json` with every file's modification time (7z extraction does not
restore it). `inspect_backup` reports the saves count and size; the restore confirmation shows
them. Restore merges them straight into this PC's configured root while the restore is prepared
(they live outside the data folder the restart swaps). Game folders are matched by game key;
per file: same content → nothing; missing → placed; backup newer → the local copy goes to
`.history` first; local newer (or as new) → it stays and the backup's copy goes to `.history`.
Manifests are merged. Code: `saves/backup.rs`.

## Google Drive

Saves reach Drive twice: inside every full backup upload (above), and through this optional
incremental sync that keeps them current between backups (Settings › Backup, only while a Google
account is linked). It reuses the backup link: same token refresh, retries with backoff on
429/5xx, plus a short pause between files. The link's scope stays `drive.appdata` (no relink),
so saves live in Metadea's private app folder next to the backups — not visible in
drive.google.com, restored from Metadea — as files named `Saves/<Platform>/<Game>/<path>` with
properties
`metadea=save`, `game=<hash of the game key>`, `sha256`, `mtime`. `.history`, `.archive` and temp
files are not uploaded.

When: after each session (the game and its platform's shared cards), before a launch (download
only, 20 s max, so a new PC gets its saves before the game starts), on "Sync now" (one game
from its panel, everything from Settings) and right after restoring a Drive backup (download
only, 2 min max): the backup's saves are merged first, then anything synced since then that is
newer. Games only on Drive are created locally under their
remote folder name (or matched by game key).

Per file, with `last` = its hash when last in sync (`.metadea-sync.json`, reset when the linked
account changes):

| Local | Remote | Action |
|---|---|---|
| present | missing | upload |
| missing | present | download (unless archived locally and unchanged remotely) |
| equal | equal | nothing |
| = last | changed | download (local copy → history) |
| changed | = last | upload |
| changed | changed | conflict: newer mtime stays active, the other goes to that save's history |

`metadea-saves.json` is merged instead (entries unioned, newer label wins, this PC's native paths
kept).

## Safety

Every path from the webview or Drive goes through `layout::safe_relative` (no `..`, roots, drive
letters, empty/dot/reserved segments) and stays under the game folder; native paths are resolved
from the table and checked to stay under their root. Copies go through a temp name + rename and
keep the source's modification time. Errors are `E_SAVES_*` codes (`error_codes.rs`,
`errors.*` in every locale). Save handling never blocks a launch: failures are logged and the
game runs.
