# Backups

Code: `frontend/src-tauri/src/backup/` (archive, restore) and `frontend/src-tauri/src/google_drive/`
(Drive link, upload, schedule). UI: Settings › Backup (`components/settings/BackupRestoreTab.astro`,
`components/settings/mount/backup-*.ts`).

## What a backup contains

A backup is one `.7z` file (LZMA2, written with the pure-Rust `sevenz-rust2` crate) of the app data
folder (`%APPDATA%\com.metadea.app` on Windows), holding only what cannot be rebuilt:

| Included | Notes |
|---|---|
| `metadea.db` | A `VACUUM INTO` snapshot taken on its own connection: one consistent state, never a copy of the live file + WAL |
| `user_metadata/**` | Avatar, banner, custom covers and images, character / story-arc images |
| `ui_themes/**` | Installed skins |
| anything else in the folder | Rules are an exclusion list, so new user data is backed up by default |

| Excluded | Why |
|---|---|
| `metadata/**` | IGDB/Steam metadata, cover cache, comic pages, continue-watching frames, theme video/preview cache: all downloaded or regenerated again |
| `metadea.db-wal`, `-shm`, `-journal`, `metadea.db.backup_*` | Live journals and pre-migration copies |
| `google-drive.json`, `backup-state.json` | Machine-local state (Drive link, last-backup facts) |
| `*.part`, `*.tmp`, `*.log`, `logs/` | Temporary files |
| `saves-settings.json`, `saves-sessions/`, `saves/` | Emulator saves: machine-local settings, temporary session files, and a name reserved for the saves the archive carries from the saves folder (see `SAVES.md`) |

Everything in the database is included (library, lists, emulator configs, reading progress,
bookmarks…). `manifest.json`, the last entry of the archive, records the app version, the schema
version (the last applied migration), the creation date, every file with its size and SHA-256, and
the excluded paths.

Saved API keys and account tokens are included, but they are encrypted with Windows DPAPI for the
Windows user that saved them. When a backup is restored on another computer or account, those values
cannot be decrypted: the restore clears them and tells the user to reconnect those accounts.

## Restore

Accepts the `.7z` format and the older `.zip` backups. The archive is checked before anything
changes: manifest format, schema version (a backup from a newer Metadea is refused with
`E_BACKUP_SCHEMA_NEWER`), that every entry is listed with the same size, no absolute paths or `..`,
size limits, the SHA-256 of every file while it is extracted, and `PRAGMA quick_check` on the
database. The files go to a staging folder, a safety backup of the current data is written next to
the data folder (`metadea-pre-restore-<date>.7z`), and the swap happens at the next start, before the
database is opened. Caches and the Drive link are carried over from the replaced install.

## Google Drive

Backups go to the account's `appDataFolder` (scope `https://www.googleapis.com/auth/drive.appdata`):
private to Metadea, not visible among the user's files, and a non-sensitive scope, so Google does not
require app verification. Sign-in is OAuth 2.0 for installed apps with PKCE (S256) and a loopback
redirect, `http://127.0.0.1:<random port>/callback`, answered by a one-shot listener in Rust (Google
does not allow custom URI schemes for new desktop clients). Tokens are stored DPAPI-encrypted and
refreshed automatically.

Automatic backups (off / daily / weekly) are checked at startup and every three hours while the app
is open. A due run hashes the data and uploads only if it changed since the last upload; afterwards
only the newest *N* backups are kept (default 5).

### Setting up the Google OAuth client (owner, once)

1. In [Google Cloud Console](https://console.cloud.google.com/), create a project (or reuse one).
2. *APIs & Services › Library*: enable the **Google Drive API**.
3. *APIs & Services › OAuth consent screen* (Google Auth Platform): user type **External**, app
   name, support email; under *Data access* add the scope `.../auth/drive.appdata`. While the app is
   in **Testing**, only the listed *test users* can sign in and refresh tokens expire after 7 days;
   **publish** it to lift both limits (the scope is non-sensitive, so no verification review).
4. *Credentials › Create credentials › OAuth client ID*, application type **Desktop app**. No
   redirect URI needs to be registered: desktop clients accept any `http://127.0.0.1:<port>` loopback.
5. Put the client ID and secret into the build environment:

   ```powershell
   $env:METADEA_GOOGLE_CLIENT_ID = "123-abc.apps.googleusercontent.com"
   $env:METADEA_GOOGLE_CLIENT_SECRET = "GOCSPX-..."
   npm run tauri build
   ```

   They are read at compile time with `option_env!`, so set them in the release workflow's
   secrets too. Users can override them in Settings › Environment › Google Drive.

The secret of a *Desktop app* client is not confidential: Google documents that it ships inside
every copy of the app. PKCE and the `state` check protect the sign-in, not the secret.
