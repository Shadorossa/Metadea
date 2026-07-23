# Metadea — Architecture

**Status:** Active development (v0.3.64, shipping `.msi` releases)
**Architecture:** Tauri v2 desktop app — Astro + React frontend, Rust core, local SQLite — plus a small Cloudflare Workers service for account linking and an IGDB proxy
**Model:** Local-first. Personal library data never leaves the machine; a separate GitHub-based flow lets users propose shared catalog metadata (characters, relations, sagas).

---

## Overview

Metadea is a personal media library manager for anime, manga, light novels, games, visual novels, movies, series, comics and books. Almost everything — library entries, ratings, favorites, tier lists, the local metadata catalog — lives in a SQLite database inside the user's app-data folder, owned and read by the Rust side of the Tauri app. The web-looking frontend (Astro + React) is compiled into the native window; there is no separate web deployment.

A much smaller Cloudflare Workers service (`backend/`) exists alongside it, used for exactly two things today: proxying IGDB search (so regular users don't need their own IGDB/Twitch app credentials) and an optional Google account link. It is **not** where library data is stored.

---

## Architecture

```
┌───────────────────────────────────────────────────────────────────┐
│  Tauri window (Astro + React, compiled into the native app)       │
│  • Search UI, library management, settings, admin/catalog panel   │
└───────────────────────────────────────────────────────────────────┘
        │ tauri invoke()                    │ fetch() (search, auth)
        ▼                                    ▼
┌──────────────────────────────┐   ┌──────────────────────────────────┐
│  Rust core (src-tauri)       │   │  External services                │
│  • SQLite (metadea.db)       │   │  • AniList GraphQL (public)        │
│  • Platform game scanning    │   │  • TMDB REST (user's bearer token) │
│    (Steam/Epic/GOG/Xbox/EA)  │   │  • OpenLibrary REST (public)       │
│  • Local anime folder scan   │   │  • ComicVine REST (local key,      │
│  • IGDB / ComicVine calls    │   │    called from Rust)               │
│    for catalog moderation    │   │  • Cloudflare Worker (backend/):   │
│  • GitHub device-flow auth   │   │    - GET /api/search/games (IGDB   │
│    + PR creation for the     │   │      proxy, shared app creds)      │
│    community catalog         │   │    - Google OAuth (optional link)  │
│  • Discord rich presence     │   │  • GitHub REST API (branch/PR      │
└──────────────────────────────┘   │    creation for catalog proposals) │
                                    └──────────────────────────────────┘
```

The community catalog itself is distributed through git, not a database server — see [colaboracion_catalogo_git.md](./colaboracion_catalogo_git.md). In short: a user's proposed edit becomes a PR that writes one JSON bundle under `database/*.json`; once merged, CI runs [scripts/build-database.js](../scripts/build-database.js) to rebuild `database.db` at the repo root, and every installed app downloads that file and merges in rows it doesn't already have (`sync_community_catalog` in `media_catalog.rs`).

---

## Directory Structure

```
metadea/
├── frontend/                       # The Tauri project (UI + native shell)
│   ├── src/
│   │   ├── pages/                  # Astro routes: home, search, media, character,
│   │   │                           #   author, local, tier(/new), settings, profile,
│   │   │                           #   admin/catalog, auth/callback, login
│   │   ├── components/             # local/, media/, search/, settings/, tier/,
│   │   │                           #   character/, profile/, admin/, shared/, home/
│   │   ├── lib/
│   │   │   ├── tauri/              # invoke() wrappers, one file per Rust module
│   │   │   ├── search/providers/   # anilist, igdb, tmdb, openlibrary, comicvine
│   │   │   ├── local/, anilist/, github/, character/, profile/, settings/, cache/
│   │   │   └── config.ts           # PUBLIC_API_URL → the Cloudflare Worker
│   │   ├── i18n/                   # es.ts / en.ts, useTranslations()
│   │   └── styles/                 # core/ (tokens, themes), components/, pages/
│   ├── src-tauri/src/              # Rust core — see module table below
│   ├── astro.config.mjs
│   └── package.json
│
├── backend/                         # Cloudflare Workers — auth + IGDB proxy only
│   ├── src/
│   │   ├── routes/
│   │   │   ├── auth.ts             # Google OAuth (redirect/callback/exchange/me)
│   │   │   ├── search.ts           # GET /api/search/games — actively used, NOT
│   │   │                           #   obsolete (called from lib/search/providers/igdb.ts)
│   │   │   └── library.ts          # POST /api/library/sync — no known caller in
│   │   │                           #   frontend/src; looks like dead code, see below
│   │   ├── services/               # auth.ts (JWT/Google), database.ts (Turso), igdb.ts
│   │   └── middleware/             # cors.ts, auth.ts
│   └── wrangler.jsonc
│
├── database/                        # One JSON "bundle" per merged catalog PR
│                                    #   (media_catalog + relations + characters + authors)
├── database.db                      # Built from database/*.json by the script below
├── scripts/build-database.js        # Rebuilds database.db; run by CI on push to main
│
└── docs/
    ├── CLAUDE.md                    # Frontend dev rules: CSS location, i18n
    ├── CLAUDE2.md                   # This file — architecture
    └── colaboracion_catalogo_git.md # Design doc for the GitHub-based catalog flow
```

---

## Data Flow

### 1. Search (hybrid: live API + local catalog merge)

```
User types query
  → search() dispatcher in lib/search/index.ts
  → per mediaType, calls one provider in lib/search/providers/*:
      anime/manga/lnovel → AniList GraphQL (direct, public)
      game/vnovel        → IGDB, via Cloudflare Worker GET /api/search/games
      movie/series       → TMDB REST (direct, user's bearer token)
      book               → OpenLibrary REST (direct, public)
      comic              → ComicVine REST (direct)
      character          → fans out to AniList + ComicVine character search
  → in parallel, searchLocalCatalog() queries the local SQLite catalog
    (search_catalog Tauri command) and merges in local-only hits
  → results deduped by externalId, blocked entries filtered out
  → rendered as MediaCard grid
```

`game`/`vnovel` search is deliberately proxied through the Worker so ordinary users don't need their own IGDB/Twitch app credentials. The native Rust IGDB client (`igdb.rs`, `igdb_env.rs`) still exists and is used for catalog **moderation** (unfiltered search, candidate matching, forcing an IGDB id) in the admin panel, which does read locally-configured credentials.

### 2. Library Save (fully local)

```
User rates/favorites/tracks progress on a media
  → invoke('save_library_entry', { ... }) (lib/tauri/library.ts → user_library.rs)
  → INSERT/UPDATE into metadea.db, no network call
```

There is no cloud library sync in the current build — `POST /api/library/sync` in `backend/src/routes/library.ts` exists but nothing in `frontend/src` calls it (confirmed by grep). Treat it as legacy/dead code rather than an active sync path.

### 3. Community Catalog Contribution (GitHub-mediated)

```
User edits a catalog entry (characters, relations, saga) in the admin/catalog panel
  → GitHub device-flow auth (github.rs) for a PAT-equivalent token
  → App creates a branch + writes database/<external_id>.json + opens a PR
  → Repo owner reviews/merges from the same admin panel
  → CI (GitHub Actions) runs build-database.js on push to main → database.db
  → Every client's sync_community_catalog downloads and merges the new rows
```

---

## API Integration Details

### AniList (GraphQL)
- **Endpoint:** `https://graphql.anilist.co`, no auth required
- **Media types:** anime, manga, light novels (`format: NOVEL` filter), characters

### IGDB (REST)
- **Default search path:** Cloudflare Worker (`backend/src/routes/search.ts` + `services/igdb.ts`), Twitch OAuth app credentials held server-side, token cached per warm isolate
- **Catalog moderation path:** native Rust (`igdb.rs`, `igdb_matching.rs`, `igdb_env.rs`), reads locally-configured credentials, used by the admin/catalog panel for unfiltered search, candidate matching, relation graphs

### TMDB (REST)
- **Endpoint:** `https://api.themoviedb.org/3`, bearer token supplied by the user
- **Media types:** movies (`search/movie`), series (`search/tv`)

### OpenLibrary (REST)
- **Endpoint:** `https://openlibrary.org/search.json`, no auth
- **ID format:** `/works/OL1234W`

### ComicVine (REST)
- Called from Rust (`comicvine.rs`); covers comic search, volumes, issues, issue cast/characters

### GitHub
- Device-flow OAuth for community catalog contributions (`github.rs`) — separate from the Cloudflare Worker's Google OAuth, and from the app's own local login
- README also mentions GitHub for "data backup"; not yet reflected in the reviewed code paths

### Steam / Epic / GOG / Xbox / EA (local platform scanning)
- `platform_scanning.rs` + `steam.rs` detect installed games and can launch them; Steam additionally supports achievements and owned-games lookups via the Steam Web API

### Discord
- `discord.rs` runs a background rich-presence updater

---

## Auth (three independent mechanisms, not one system)

1. **Local login** (`login.astro`): username only, stored as `offline_token` in the local SQLite via `auth.rs`. This is what actually gates the app today.
2. **Google OAuth** (`home.astro` → Cloudflare Worker `backend/src/routes/auth.ts` → Turso `users` table, JWT): optional "Vincular con Google" link surfaced only when the session is still the local `offline_token`. Independent of the Rust-side local login.
3. **GitHub device flow** (`github.rs`): scoped to the community catalog proposal/moderation flow, not general app auth.

Worth double-checking against current product intent: it's not obvious from the code alone why local login, Google linking, and GitHub auth are three separate token stores rather than one identity.

---

## Type System

### SearchResult (frontend, `lib/search/index.ts`)
```typescript
type MediaType = 'all' | 'anime' | 'manga' | 'lnovel' | 'game' | 'vnovel'
  | 'movie' | 'series' | 'book' | 'comic' | 'character';

interface SearchResult {
  externalId:   string;   // e.g. "anime:918" — matches media_catalog.external_id
  type:         MediaType;
  format:       string;   // "TV", "OVA", "MANGA", "base_game", ...
  source:       'anilist' | 'igdb' | 'tmdb' | 'openlibrary' | 'comicvine';
  titleMain:    string;
  titleRomaji:  string | null;
  titleNative:  string | null;
  coverUrl:     string | null;
  releaseYear:  number | null;
  releaseMonth: number | null;
  releaseDay:   number | null;
  scoreGlobal:  number | null;
  authorNames?: string[] | null;  // OpenLibrary only
  authorKey?:   string | null;    // OpenLibrary only
}
```

### Local catalog schema
The canonical schema lives in `src-tauri/src/db.rs` (`media_catalog`, `characters`, `character_appearances`, `media_relations`, `media_author`, `media_by_author`, `sagas`, `saga_relations`, plus per-user tables like `user_library`, `user_lists`, `tier_lists`). `scripts/build-database.js` maintains a hand-kept mirror of the catalog-side tables for the community database build — the two are documented as needing to be kept in sync manually, so a schema change in `db.rs` requires a matching change there.

---

## Rust Core Modules (`frontend/src-tauri/src/`)

| Module | Responsibility |
|---|---|
| `db.rs` | SQLite schema + migrations, connection handling |
| `media_catalog.rs` | Catalog CRUD, health checks, community sync merge |
| `media_relations.rs`, `sagas.rs` | Prequel/sequel/adaptation graph, saga grouping |
| `characters.rs`, `staff.rs`, `media_authors.rs` | Character/staff/author records and appearances |
| `igdb.rs`, `igdb_matching.rs`, `igdb_env.rs` | IGDB client, candidate matching, local credential config |
| `comicvine.rs` | ComicVine client |
| `anilist.rs` | AniList token storage + profile lookup |
| `platform_scanning.rs`, `steam.rs` | Installed-game detection, Steam achievements/owned games |
| `folders.rs` | Folder picking, local anime scanning, launching games/VLC |
| `user_library.rs`, `user_lists.rs`, `user_metadata.rs`, `favorite_images.rs` | Per-user data: library entries, custom lists, favorites, profile images |
| `tier_lists.rs` | Tier list CRUD and placements |
| `episode_history.rs` | Local anime watch history |
| `community_sync.rs`, `proposal_bundle.rs` | Pulls/merges the community `database.db`, builds proposal bundles for PRs |
| `github.rs` | Device-flow auth + PR creation for catalog proposals |
| `auth.rs` | Local username/token storage |
| `discord.rs` | Rich presence |
| `utils.rs`, `vestigial_cleanup.rs` | Shared helpers; one-off cleanup of stale data |

---

## Known Issues & TODO

### Likely dead code
- `backend/src/routes/library.ts` (`POST /api/library/sync`) — no caller found in `frontend/src`; either wire it up or remove it
- `vestigial_cleanup.rs` — named and scoped as one-off cleanup; confirm it isn't still needed before assuming it's safe to delete

### Medium priority
- Three separate auth mechanisms (local, Google, GitHub) with no shared identity — worth a deliberate decision rather than accretion
- No automated tests found in `frontend/` or `backend/` beyond `vitest` being a backend devDependency (no test files located)

### Documentation debt
- `docs/CLAUDE2.md` (this file) previously described an early Cloudflare-Workers-only prototype that no longer matches the shipped app — now updated (2026-07-23)
- `docs/DEVELOPMENT_RULES.md` / `docs/30_DAY_ROADMAP.md` describe a test-coverage and CI process not currently observed in the repo; worth reconciling or marking aspirational

---

## Useful Commands

**Frontend / Tauri app**
```bash
cd frontend
npm run dev          # Astro dev server only (localhost:3000, no native shell)
npm run tauri:dev     # Full Tauri dev app (native window + Rust core)
npm run tauri:build   # Production .msi build
```

**Cloudflare Worker (auth + IGDB proxy)**
```bash
cd backend
npm run dev          # Wrangler dev server (localhost:8787)
```

**Community database rebuild**
```bash
node --experimental-sqlite scripts/build-database.js
```

---

Last updated: 2026-07-23
