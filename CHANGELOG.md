# Changelog

All notable changes to Metadea are documented in this file — it is the single
source of truth for the in-app "What's new" window and for the GitHub release
notes. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and versions follow [Semantic Versioning](https://semver.org/).

Format rules (checked by `frontend/src/lib/changelog/changelog-content.test.ts`):

- One `## [X.Y.Z] - YYYY-MM-DD` section per version, newest first, with any of
  `### Highlights`, `### Added`, `### Improved`, `### Removed`, `### Fixed`
  (`Removed` reaches the GitHub release notes only; the in-app window skips it).
- Added/Improved bullets start with a bold area: `- **Area:** short list`.
- Every Fixed bullet states its cause: `- <summary> — Cause: <cause>`.
- English, for end users: one short line per bullet, related items merged.

## [Unreleased]

## [0.7.2] - 2026-09-24

### Highlights

- Interface scales proportionally on smaller screens.
- Cleaner themes, filler as one checkbox, fixed metadata downloads.

### Improved

- **Interface:** scales proportionally on smaller screens (Settings › Preferences › Interface scale).
- **Themes:** readable text in Nebula and other themes, dark native controls, theme accents no longer overridden.
- **Filler:** one "Watched with filler" checkbox in the editor; unchecked, totals and progress count canon episodes only.
- **Unified seasons:** a planned season stays its own card; taste compatibility shows one entry per anime.
- **Local:** "Duration" block restyled; no scrollbar on the game panel or the AniList users list.
- **Discord and sharing:** others always see the work's main cover, not your custom one.

### Fixed

- Metadata download in Local stuck or silent — Cause: errors were swallowed and the batch overwrote its index.
- Games listed twice in Local — Cause: stale entries restored and paths compared with different spellings.
- Google sign-in replaced your chosen name — Cause: the server's Google-derived name overwrote the session name.
- Media page partly in English — Cause: it used the build-time language instead of yours.
- Synopsis cut off when opening achievements — Cause: the panel shrank it to fit.

## [0.7.1] - 2026-09-23

### Highlights

- Anime, manga and light novel search works again for everyone.

### Fixed

- Search found nothing on anime, manga and light novels with adult content enabled — Cause: AniList returns no results for an explicit `isAdult: null` filter; adult works are now simply added to the results.
- Search empty with an expired or revoked AniList token — Cause: the token was sent with every search; it now retries without it.
- "General" release calendar empty with adult content enabled — Cause: same `isAdult: null` filter.
- Parts of the app in English for Spanish users after updating — Cause: search and the library editor used the build-time language; installs that never picked a language now keep Spanish.

## [0.7.0] - 2026-09-23

### Highlights

- Built-in video player with OP/ED skip and exact resume.
- EPUB reader, jukebox, RetroAchievements and Big Picture mode.
- Company pages, tier lists, public web profile, Yearly Bingo.
- Faster pages everywhere.

### Added

- **Player:** built-in libmpv, overlay/docked controls, exact resume, auto-mark with undo.
- **Skip:** openings, endings and recaps via AniSkip and MKV chapters.
- **Player extras:** frame previews on the seek bar; smart audio/subtitle picks per series; instant 3–10 s MP4/GIF clips (scissors) copied ready to paste in Discord.
- **Discord:** activity types, time remaining, "Open in Metadea" button.
- **Links:** `metadea://` deep links; share links with preview cards.
- **Reading & music:** EPUB reader; OP/ED jukebox mini player.
- **Night reading:** E-Ink paper mode for comics and EPUBs, with warmth and brightness (E).
- **Games:** RetroAchievements, ROM scanner with clean names and auto-rename, emulator screenshots.
- **Emulator saves:** battery saves and save states in one central folder, with labels, version history, import, included in full backups and optionally synced to Google Drive.
- **Multi-disc games:** discs of one game (Disc 1/2/3, CD1, Disk A, Side B…) show as one entry with a disc picker; Metadea writes the `.m3u` and boots it in emulators that support it; old per-disc entries merge automatically.
- **Controller pause menu:** hold Select/Back + Start for 1.5 s in a game launched from Metadea to freeze it and open Continue / Save state (RetroArch) / Quit game.
- **Accessibility:** new Settings tab with a break reminder ("time for a short break?" every N hours of play) and clock alerts like 23:00.
- **Game presence:** console logo for ROMs, live achievement counts (RetroAchievements and Steam), sessions count and last played in the game panel.
- **How long to beat:** main story, extras and completionist times (IGDB, VNDB for visual novels) with your progress.
- **Big Picture:** full-screen controller mode (Ctrl+Shift+B).
- **Ambient TV mode:** after a few idle minutes in full screen or Big Picture, a slideshow of wallpapers from your library with a clock and the jukebox playing softly.
- **Look:** UI themes/skins, optional textless covers, genre icons.
- **Help:** keyboard shortcuts with `?` sheet, user guide, welcome flow.
- **Creators:** company pages with a career timeline; creator and saga completion bars.
- **Tier lists:** TierMaker-style boards for any media, exportable as PNG.
- **Story arcs:** import arcs with chapter ranges from ComicVine.
- **Stores:** GG.deals price link on game pages.
- **Social:** taste compatibility; character reactions (like, interested, dislike); optional public web profile with a copy-link button on profiles.
- **Goals:** Yearly Bingo on Home (pick any number of works, results in December, PNG export), backlog calculator, rewatch counter.
- **Home:** continue watching, airing today, anniversaries.
- **Backups:** full `.7z` backup and restore; automatic Google Drive backups.
- **Plugins:** new Settings tab; UI themes live there.
- **What's new:** this window, also in Settings › Environment.
- **Spoiler shield:** blurs later episodes, arcs, unreached seasons and character spoilers based on your progress; reveal per item or per saga.
- **Anime filler:** filler (red) and mixed (blue) episodes from AnimeFillerList, "Hide filler", and "Filler: Skipped" to count only canon episodes.

### Improved

- **Performance:** shared caches and virtualised grids on every page.
- **Activity:** paginated feed; friends list loads on demand.
- **Language:** English as reference; follows system language by default.
- **Profiles:** public profiles use the same layout as yours.
- **Settings:** compact Preferences and Emulators tabs; updates moved into the Environment tab.
- **Google Drive:** linking opens on your Metadea account.

### Removed

- External VLC playback; the built-in player handles all local video.

### Fixed

- Scroll locked app-wide — Cause: player overlay CSS set `overflow: hidden` on `html`.
- "Multimedia" favourites list wiped — Cause: a failed read was saved back as empty.
- Empty library after update — Cause: new commands missing from the permission list.
- Theme videos failing — Cause: AnimeThemes rate limit plus partial cache files.
- Discord time remaining stuck at 0:00 — Cause: presence sent before duration was known.
- Share previews without images — Cause: AniList blocks the preview server.
- Share link score 0.8 instead of 7.9 — Cause: 0–10 score scaled as 0–100.
- Release build failing — Cause: libmpv DLL missing on the build machine.
- Public libraries frozen since Aug 20 — Cause: server discarded the library in daily sync.
- ROMs with spaces in the path failed to launch — Cause: path split into several arguments.
- Empty pages after auto-update until F5 — Cause: pages ran before the backend was ready.
- Friend's profile showed an empty library — Cause: tags read as text, not a list.
- Removed character appearances came back — Cause: stale rows were never deleted.
- Fast page switches mixed two works' data — Cause: old page saved under the new id.
- AniList errors after hovering big casts — Cause: all cast pages prefetched at once.
- Blank images in the installed app — Cause: CSS background images failed in production builds.
- Game playtime not saved and Discord presence lost mid-game — Cause: only the Local page recorded sessions and each page reload forgot the running game.
