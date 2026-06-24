# Metadea — Personal Media Manager

**Status:** Early development  
**Architecture:** Desktop app (Astro frontend + Turso backend)  
**Model:** Local-first with optional cloud sync

---

## Overview

Metadea is a personal media library manager for anime, manga, light novels, games, visual novels, movies, series, and books. Users bring their own API keys and search/manage their collection locally.

**Core principle:** User controls their own data, their own API quota, zero friction onboarding.

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│  Frontend (Astro + React)                               │
│  • Search UI (multi-source)                             │
│  • Library management                                   │
│  • Settings (API keys)                                  │
└─────────────────────────────────────────────────────────┘
           ↓ (direct to external APIs)
┌──────────────────────────────────────────────────────────────────┐
│  External APIs (user's keys)                                     │
│  • AniList (anime, manga, novels) — no key required             │
│  • IGDB (games, visual novels) — Twitch OAuth                   │
│  • TMDB (movies, series) — free API key                         │
│  • OpenLibrary (books) — no key required                        │
└──────────────────────────────────────────────────────────────────┘
           ↓ (user data only, validated)
┌─────────────────────────────────────────────────────────┐
│  Backend (Cloudflare Workers + Turso SQLite)           │
│  • Library persistence (user_library table)            │
│  • ID validation before save                           │
│  • Stats aggregation (pending)                         │
└─────────────────────────────────────────────────────────┘

---

## Directory Structure

```
metadea/
├── frontend/                    # Astro web app
│   ├── src/
│   │   ├── components/
│   │   │   ├── search/
│   │   │   │   └── SearchIsland.tsx        # Multi-source search (React island)
│   │   │   ├── Navbar.astro               # Top navigation
│   │   ├── layouts/
│   │   │   └── BaseLayout.astro           # Main layout (auth modal, navbar)
│   │   ├── pages/
│   │   │   ├── index.astro                # → /home redirect
│   │   │   ├── home.astro                 # Landing page
│   │   │   ├── search.astro               # Search page
│   │   │   ├── notifications.astro        # Placeholder
│   │   │   ├── login.astro                # Placeholder redirect
│   │   │   └── register.astro             # Placeholder redirect
│   │   ├── lib/
│   │   │   ├── search.ts                  # Search dispatcher (router)
│   │   │   ├── config.ts                  # Constants (API_URL)
│   │   │   └── api/
│   │   │       ├── anilist.ts             # AniList GraphQL (anime, manga, novels)
│   │   │       ├── igdb.ts                # IGDB frontend caller
│   │   │       ├── tmdb.ts                # TMDB REST (movies, series)
│   │   │       └── openlibrary.ts         # OpenLibrary REST (books)
│   │   ├── i18n/
│   │   │   ├── index.ts                   # i18n routing + useTranslations()
│   │   │   ├── es.ts                      # Spanish translations
│   │   │   └── en.ts                      # English translations
│   │   └── styles/
│   │       ├── global.css                 # Root variables, reset
│   │       ├── components.css             # Auth modal, buttons, dialogs
│   │       ├── search.css                 # Search tabs, results grid
│   │       └── navbar.css                 # Navigation styling
│   ├── astro.config.mjs
│   ├── tailwind.config.js
│   └── package.json
│
├── backend/                     # Cloudflare Workers (Turso data)
│   ├── src/
│   │   ├── lib/
│   │   │   ├── cors.ts                    # CORS headers, jsonResponse() helpers
│   │   │   ├── igdb.ts                    # IGDB OAuth + VN classification
│   │   │   ├── turso.ts                   # Turso client, saveLibraryItem()
│   │   │   └── validation.ts              # validateExternalId() for all sources
│   │   ├── routes/
│   │   │   ├── search.ts                  # POST /api/search/games (pending removal)
│   │   │   └── library.ts                 # POST /api/library/sync (save items)
│   │   ├── types/
│   │   │   └── index.ts                   # CloudflareEnv, LibrarySyncRequest
│   │   └── index.ts                       # Router setup, /health, /library/sync
│   ├── wrangler.jsonc
│   ├── tsconfig.json
│   └── package.json
│
└── docs/
    └── CLAUDE.md                (this file)
```

---

## Data Flow

### 1. Search (Frontend-only)

```
User types query in SearchIsland
    → search() dispatcher in lib/search.ts
    → switches on mediaType
        case 'anime' → searchAniList(query, 'ANIME', 'anime', signal)
        case 'manga' → searchAniList(query, 'MANGA', 'manga', signal)
        case 'novel' → searchAniList(query, 'MANGA', 'novel', signal, 'NOVEL')
        case 'game'  → searchGames(query, 'game', signal)
        case 'vnovel' → searchGames(query, 'vnovel', signal)
        case 'movie' → searchMovies(query, signal)
        case 'series' → searchSeries(query, signal)
        case 'book'  → searchBooks(query, signal)
    → Each API handler fetches directly using user's keys (or public APIs)
    → Returns SearchResult[] (normalized)
    → Render in grid, each card is MediaCard
```

**User keys stored in:**
- `localStorage` (frontend only, never sent to backend)
- Not yet implemented—pending Settings page

### 2. Library Save (Frontend → Backend)

```
User clicks "Add to Library" on SearchResult
    → Payload: { externalId: 'game:918', type: 'game', rating: 8, ... }
    → POST /api/library/sync
    → Backend: validateExternalId(externalId, type)
        → Checks format (source:id)
        → Validates ID is positive integer (or valid UUID for books)
        → Returns boolean
    → If valid: INSERT into user_library
    → Response: { success, saved, rejected, rejectedIds }
```

---

## API Integration Details

### AniList (GraphQL)
- **Endpoint:** `https://graphql.anilist.co`
- **Auth:** None required (public)
- **Media types:** ANIME, MANGA
- **Special:** Light novels use `format: NOVEL` filter

**Two query strategies:**
- `SEARCH_QUERY`: Without format (anime/manga)
- `SEARCH_QUERY_WITH_FORMAT`: With format (light novels, to avoid null-filter bug)

### IGDB (REST + Twitch OAuth)
- **Endpoint:** `https://api.igdb.com/v4/games`
- **Auth:** Twitch OAuth (client_id + client_secret → access_token)
- **Media types:** Game (type=0), Visual Novel (type=0 with genre ID 34)
- **Token cache:** In-isolate (Worker memory), lasts 60 days
- **VN detection:** Genre 34 in top 3 genres, NOT RPG (12) or Fighting (4)

### TMDB (REST)
- **Endpoint:** `https://api.themoviedb.org/3`
- **Auth:** Bearer token (read-only)
- **Media types:** Movies (`search/movie`), Series (`search/tv`)
- **Config:** `PUBLIC_TMDB_TOKEN` in frontend `.env.local`
- **Date parsing:** Fixed to use UTC getters (prevents off-by-one in negative timezones)

### OpenLibrary (REST)
- **Endpoint:** `https://openlibrary.org/search.json`
- **Auth:** None required (public)
- **Media type:** Books
- **ID format:** `/works/OL1234W` (not numeric)

---

## Type System

### SearchResult (frontend ↔ APIs)
```typescript
interface SearchResult {
  externalId:   string;     // e.g. "anime:918", "game:181", "book:/works/OL123W"
  type:         MediaType;  // 'anime' | 'manga' | 'novel' | 'game' | 'vnovel' | 'movie' | 'series' | 'book' | 'all' | 'user'
  format:       string;     // "TV", "OVA", "MANGA", "base_game", "remaster", etc.
  source:       string;     // "anilist" | "igdb" | "tmdb" | "openlibrary"
  titleMain:    string;
  titleRomaji:  string | null;   // AniList only
  titleNative:  string | null;   // Native script title
  coverUrl:     string | null;
  releaseYear:  number | null;
  releaseMonth: number | null;
  releaseDay:   number | null;
  scoreGlobal:  number | null;   // Normalized 0–10
}
```

### LibraryItemInput (frontend → backend)
```typescript
interface LibraryItemInput {
  externalId:       string;     // Validated before save
  type:             string;
  status?:          string;     // 'planning' | 'currently' | 'completed' | 'paused' | 'dropped'
  rating?:          number;     // 0–10
  progress?:        number;
  minutes_spent?:   number;
  is_favorite?:     boolean;
  is_platinum?:     boolean;
  tags?:            string;
  notes?:           string;
  started_at?:      string;     // ISO date
  finished_at?:     string;     // ISO date
}
```

---

## Component Inventory

### Frontend Components

| File | Type | Purpose |
|------|------|---------|
| `SearchIsland.tsx` | React (island) | Multi-source search UI, debounce, loading state |
| `Navbar.astro` | Astro | Logo, nav links, user button (opens auth modal) |
| `BaseLayout.astro` | Astro | HTML shell, global styles, auth modal dialog |

### Frontend Pages

| Route | File | Purpose | Status |
|-------|------|---------|--------|
| `/` | `index.astro` | Redirect to /home | ✅ |
| `/home` | `home.astro` | Landing page | ✅ |
| `/search` | `search.astro` | Search interface | ✅ |
| `/notifications` | `notifications.astro` | Placeholder | ⏳ |
| `/login` | `login.astro` | Redirect to /home (auth in modal) | ⏳ |
| `/register` | `register.astro` | Redirect to /home (auth in modal) | ⏳ |

### Backend Routes

| Method | Path | Purpose | Status |
|--------|------|---------|--------|
| `GET` | `/api/health` | Liveness check | ✅ |
| `POST` | `/api/library/sync` | Save items to library | ✅ Implementation, ⏳ Auth |
| `OPTIONS` | `*` | CORS preflight | ✅ |

---

## Configuration & Secrets

### Frontend `.env.local`
```env
PUBLIC_API_URL=http://localhost:8787
PUBLIC_TMDB_TOKEN=<your-tmdb-api-key>
PUBLIC_ANILIST_URL=https://graphql.anilist.co
```

### Backend `.dev.vars` (local development)
```env
TURSO_URL=libsql://...
TURSO_TOKEN=...
IGDB_CLIENT_ID=...
IGDB_CLIENT_SECRET=...
```

### Frontend Local Storage (pending)
```javascript
{
  igdb_client_id: '',
  igdb_client_secret: '',
  tmdb_api_key: '',
  // AniList and OpenLibrary don't need keys
}
```

---

## Known Issues & TODO

### Critical
- **Auth system:** Placeholder only, no real login/register
- **Settings page:** Users can't input their API keys yet (next priority)

### Medium Priority
- **Search `all` type:** Parallel queries across all sources (not implemented)
- **Search `user` type:** Query local database for user profiles (not implemented)
- **Stats dashboard:** Aggregate ratings, hours played, etc. (pending)
- **Library sync conflicts:** No conflict resolution yet

### Low Priority
- **Offline mode:** Currently requires internet for all searches
- **Image caching:** No offline cache for covers yet
- **Advanced filters:** Search results don't support filtering by format/year

### Technical Debt
- **Error logging:** Backend has no structured logging (console errors only)
- **Rate limiting:** No per-user rate limits on library sync
- **CORS:** Currently `*` (open), should whitelist frontend domain
- **Validation:** IGDB query injection vulnerable (minimal escaping only)

---

## Code Quality

**Type Safety:** 100% (no `as any`)  
**Test Coverage:** 0% (not started)  
**Documentation:** This file + JSDoc in API files

---

## Removed / Unnecessary Code

✅ **Nothing to report.** All code in `/src` is active and intentional.

### Notes on non-removal:
- `login.astro` / `register.astro` are placeholders but necessary (routing structure)
- `backend/src/routes/search.ts` is **obsolete** (searches now direct from frontend), marked for removal once full transition complete
- `backend/src/lib/igdb.ts` still exists but frontend should migrate to direct IGDB calls once key-management is implemented

---

## Next Steps (Priority Order)

1. **Settings page** — Allow users to input IGDB + TMDB keys (localStorage)
2. **Migrate IGDB search to frontend** — Move `searchGames()` from backend, remove `/api/search/games`
3. **Proper error handling** — Try-catch in all API calls, user feedback
4. **Auth system** — Real register/login (JWT + session)
5. **Stats dashboard** — Aggregation + visualization
6. **Tests** — Unit tests for search, validation, normalization

---

## Useful Commands

**Frontend Development**
```bash
cd frontend
npm run dev          # Start dev server (localhost:3000)
```

**Backend Development**
```bash
cd backend
npm run dev          # Start Wrangler dev server (localhost:8787)
```

**Both (from root)**
```bash
# In separate terminals:
cd frontend && npm run dev &
cd backend && npm run dev
```

---

Last updated: 2026-06-24
