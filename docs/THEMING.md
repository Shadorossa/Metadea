# Metadea UI themes (skins)

Metadea can be restyled end-to-end with a user-made theme: a folder of CSS
dropped into the app's data directory, Playnite-style. This document is the
contract theme authors can rely on. Anything not listed here (class names
inside a specific page, DOM structure, animation internals) may change between
releases without notice.

> Naming: in the codebase this feature is always called **UI themes / skins**
> (`ui_themes.rs`, `lib/ui-themes/`, `components/ui-themes/`). Plain "themes"
> (`media_themes`, `lib/tauri/themes.ts`) means anime OP/ED songs.

## 1. Where themes live

```
<app data>/ui_themes/
└── my-skin/            ← the folder name IS the theme id
    ├── theme.json      ← manifest (required)
    ├── theme.css       ← any number of CSS files (full-CSS tier only)
    ├── preview.png     ← optional thumbnail for Settings
    └── fonts/, img/…   ← assets the CSS refers to with relative url()
```

`<app data>` is Tauri's per-user app data directory (`%APPDATA%\com.metadea.app`
on Windows, `~/Library/Application Support/com.metadea.app` on macOS,
`~/.local/share/com.metadea.app` on Linux). **Settings › Apariencia › Temas de la
comunidad › "Abrir carpeta de temas"** opens it, and **"Crear tema de ejemplo"**
copies the bundled `example-midnight` theme into it (see
`frontend/public/ui-themes/example-midnight/` in the repo).

The theme id (folder name and manifest `id`) must match `^[a-z0-9-]+$` and be at
most 64 characters. It is used as a folder name, as the value of
`html[data-ui-theme]` and inside URLs, so nothing else is allowed.

## 2. The manifest (`theme.json`)

```json
{
  "id": "my-skin",
  "name": "My skin",
  "author": "Your name",
  "version": "1.0.0",
  "description": "One or two sentences shown in Settings.",
  "homepage": "https://…",
  "minAppVersion": "0.5.5",
  "variables": {
    "--accent": "#6ea8ff",
    "bg-card": "#111a2e"
  },
  "css": ["theme.css", "pages/media.css"],
  "preview": "preview.png"
}
```

| Field | Required | Notes |
|---|---|---|
| `id` | yes | Must equal the folder name. `^[a-z0-9-]+$`, ≤ 64 chars. |
| `name`, `author`, `version` | yes | Free text (non-empty). |
| `description`, `homepage`, `minAppVersion` | no | Informational only; `minAppVersion` is not enforced yet. |
| `variables` | no | Map of design token → value. Keys may omit the leading `--`. |
| `css` | no | Relative `.css` paths inside the folder, concatenated in this order. |
| `preview` | no | Relative `.png/.jpg/.jpeg/.webp/.gif` inside the folder. |

Rust (`frontend/src-tauri/src/ui_themes.rs`) validates every manifest when
listing; a broken theme still shows up in Settings with the error inline, so
you can always see what is wrong.

## 3. The two tiers

### Variables-only (safe, recommended)

A manifest with `variables` and no `css`. The loader turns the map into a
single `:root { … }` block. You cannot break the layout with this tier — only
colours, radii and timings change — and it keeps working across app updates
as long as the token names below exist.

Variable values are rejected when they contain `;`, `{`, `}`, `<`, `>`, a
backslash, `url(`, `expression(`, `javascript:` or `@import`, or exceed 512
characters (both in Rust and again in the frontend builder).

### Full CSS

A manifest that lists `css` files. Any selector goes, so you can move the
navbar, re-skin cards, hide sections… and also break pages. Scope every rule
to your id so nothing leaks:

```css
html[data-ui-theme="my-skin"] .navbar { … }
```

The `variables` block (if any) is injected *before* your CSS, so your files
can use `var(--accent)` and get your own value.

**Escape hatch:** `Ctrl+Shift+T` (`⌘+Shift+T` on macOS) deactivates the active
theme from anywhere — including inside text fields — so a theme that hides the
Settings page can always be turned off. It is listed in the `?` shortcut sheet.

## 4. Design tokens

Every custom property declared on `:root` in `frontend/src/styles/**`
(extracted by script; 49 tokens). "Used" is the number of `var()` references
across the app's stylesheets — a rough measure of how much a token affects.

### Surfaces

| Token | Default | Used | Affects |
|---|---|---|---|
| `--bg-base` | `#07070e` | 14 | Page background behind everything; library grid, modal scrims. |
| `--bg-primary` | `#07070e` | 92 | Main page/body background; built-in themes override it per `data-theme`. |
| `--bg-elevated` | `#13131f` | 130 | Raised panels: navbar, tier rows, settings groups, dropdowns. |
| `--bg-card` | `#191927` | 68 | Cards (media, character, settings sections). |
| `--bg-card-rgb` | `25 25 39` | 3 | Same as `--bg-card` as space-separated RGB, for `rgb(var(--bg-card-rgb) / .8)`. |

### Text

| Token | Default | Used | Affects |
|---|---|---|---|
| `--text-main` | `#e4e4f0` | 334 | Primary text colour. |
| `--text-muted` | `#5c5c80` | 205 | Secondary text: hints, metadata, labels. |
| `--text-dim` | `#31314d` | 136 | Tertiary text: placeholders, disabled, counters. |
| `--text-on-accent` | `#ffffff` | 1 | Text on accent-filled buttons/badges. |
| `--color-on-light` | `#1a1a1a` | 1 | Text on light surfaces (e.g. light badges). |

### Accent

| Token | Default | Used | Affects |
|---|---|---|---|
| `--accent` | `#c084fc` | 427 | Brand colour: primary buttons, links, active tabs, focus rings, progress. Settings › "Color personalizado" also writes this at runtime. |
| `--accent-rgb` | `192 132 252` | 5 | `--accent` as RGB triplet for alpha mixes. |
| `--accent-soft` | `rgba(192,132,252,.1)` | 28 | Accent-tinted backgrounds (hover, selected rows). |
| `--accent-border` | `rgba(192,132,252,.25)` | 35 | Accent-tinted borders. |
| `--accent-glow` | `rgba(192,132,252,.3)` | 9 | Accent box-shadows / glows. |

### Borders and radii

| Token | Default | Used | Affects |
|---|---|---|---|
| `--border-color` | `rgba(255,255,255,.06)` | 299 | Default 1px borders everywhere. |
| `--border-subtle` | `rgba(255,255,255,.05)` | 8 | Faintest separators (character lists, modals). |
| `--border-light` | `rgba(255,255,255,.08)` | 1 | Slightly stronger separators. |
| `--border-medium` | `rgba(255,255,255,.12)` | 1 | Emphasised borders (shortcut sheet). |
| `--radius-sm` | `4px` | 133 | Chips, small buttons, inputs. |
| `--radius-md` | `8px` | 83 | Cards, settings boxes. |
| `--radius-lg` | `12px` | 11 | Large panels, modals. |
| `--radius-xl` | `18px` | 0 | Reserved (unused today). |

### Motion

| Token | Default | Used | Affects |
|---|---|---|---|
| `--anim-ease` | `cubic-bezier(.25,0,.15,1)` | 73 | Default easing. |
| `--anim-fast` | `120ms` | 154 | Hover/focus transitions. |
| `--anim-base` | `220ms` | 37 | Panel/layout transitions. |

### Semantic colours

| Token | Default | Used | Affects |
|---|---|---|---|
| `--color-error` | `#f87171` | 35 | Error text and icons. |
| `--color-error-strong` | `#ef4444` | 26 | Destructive buttons, error fills. |
| `--color-error-soft` | `#ff8585` | 11 | Error highlights (notifications). |
| `--color-success` | `#10b981` | 5 | Success fills. |
| `--color-success-soft` | `#4ade80` | 4 | Success text. |
| `--color-gold` | `#f59e0b` | 5 | Ratings, achievements, warnings. |
| `--color-gold-soft` | `#fbbf24` | 1 | Lighter gold accents. |
| `--color-completed` | `#34d399` | 6 | Library status "completed". |
| `--color-watching` | `#c94a4a` | 1 | Library status "watching". |
| `--color-reading` | `#c94a4a` | 0 | Library status "reading" (reserved). |
| `--color-planning` | `#fbbf24` | 6 | Library status "planning". |
| `--color-paused` | `#60a5fa` | 2 | Library status "paused". |
| `--color-dropped` | `#9c8f80` | 1 | Library status "dropped". |
| `--opacity-40` | `0.4` | 0 | Reserved. |
| `--opacity-60` | `0.6` | 0 | Reserved. |

### Video player overlay (`player-overlay.css`)

| Token | Default | Used | Affects |
|---|---|---|---|
| `--player-fg` | `#f2f2f8` | 6 | Overlay text/icons. |
| `--player-fg-muted` | `rgba(242,242,248,.65)` | 6 | Secondary overlay text. |
| `--player-accent` | `#c084fc` | 11 | Seek bar, active controls. |
| `--player-panel` | `rgba(12,12,20,.86)` | 5 | Overlay panels (subtitles/audio menus). |
| `--player-panel-border` | `rgba(255,255,255,.1)` | 7 | Panel borders. |
| `--player-scrim` | `linear-gradient(to top, rgba(0,0,0,.85), rgba(0,0,0,0))` | 1 | Bottom controls scrim. |
| `--player-radius` | `10px` | 4 | Panel radius. |
| `--player-anim` | `180ms ease` | 12 | Overlay transitions. |

Built-in "Fondo dinámico" themes (`styles/core/themes/*.css`) override some of
these under `html[data-theme="…"]`. A user theme's `:root` block is injected
last, so it wins over `:root` defaults, but a built-in theme's more specific
`[data-theme]` rule still beats a `:root` variable. To override a built-in
theme too, use a full-CSS theme with `html[data-ui-theme="my-skin"] { --bg-primary: … }`
(same specificity, later in the cascade).

## 5. Stable layout hooks

These selectors are the supported surface for full-CSS themes. They are
marked *stable*: renaming any of them requires updating this document.

| Hook | What it is |
|---|---|
| `html[data-ui-theme="<id>"]` | Set while your theme is active. Scope every rule with it. |
| `html[data-theme="<built-in>"]` | The built-in background theme currently selected (`nebula`, `cyberpunk`, …). |
| `body[data-page="home|search|local|notifications|profile|settings|tier|admin"]` | Which top-level page is shown. |
| `#app-bg` | Full-window background layer behind the page (built-in themes paint here). |
| `#page-content` | Wrapper around the page's own content. |
| `header.navbar` | Top navigation bar. |
| `.navbar .nav-main`, `.nav-group`, `.nav-group--left` | Navbar groups. |
| `.navbar .nav-icon-btn`, `.nav-icon-btn--plain`, `.nav-symbol` | Navbar icon buttons and their SVG. |
| `.nav-arrows`, `#nav-back-btn`, `#nav-forward-btn` | History arrows. |
| `footer.app-footer`, `.footer-content`, `.footer-bottom-row` | Footer. |
| `.btn`, `.btn--primary`, `.btn--secondary`, `.btn--ghost`, `.btn--sm` | The shared button family. |
| `.input-dark` | The shared text input. |
| `.card-media-base`, `.card-media-img`, `.card-rating-badge` | Media/character card base, its cover image and rating badge. |
| `.section-label`, `.section-label--tab` | Section headings and tab-style headings. |
| `.modal-title` | Title inside modals. |
| `.auth-modal`, `.auth-modal-box` | First-run profile dialog. |
| `.global-toast`, `.metadea-runtime-toast`, `.metadea-runtime-toast--wide` | Bottom toasts. |
| `.global-loading-bar`, `.global-loading-bar-fill` | Bottom loading bar. |
| `.quick-search-backdrop`, `.quick-search-box`, `.quick-search-input`, `.quick-search-result`, `.quick-search-result--selected` | Quick search overlay (mod+K). |
| `.shortcut-sheet-overlay`, `.shortcut-sheet-panel` | The `?` shortcut sheet. |
| `.now-playing-bar`, `.now-playing-bar--game` | Global "now playing" bar. |
| `.media-page`, `.local-page`, `.profile-page`, `.settings-page`, `.tier-page`, `.onboarding-page` | Root container of each page. |
| `.settings-page .settings-section`, `.settings-section-title`, `.settings-hint`, `.settings-divider` | Settings layout blocks. |
| `.theme-grid`, `.theme-card`, `.theme-card.active` | Built-in background theme picker. |
| `[data-bp-skin="default"]`, `[data-bp-skin="ps5"]` | Big Picture style (Settings › Appearance), on the Big Picture root (`.bp-root`) and, while Big Picture is open, on `html`. The built-in PS5 skin (`styles/pages/local/big-picture-ps5.css`) is inspired by [PS5ish](https://github.com/davidkgriggs/PS5ish) (MIT), recreated in CSS. |
| `.ui-themes-section`, `.ui-theme-list`, `.ui-theme-card`, `.ui-theme-card--active` | The user themes section itself. |
| `.tooltip`-family (`[data-tooltip]`) | Hover tooltips. |

## 6. Sanitisation (what the loader removes)

Theme CSS is untrusted input rendered inside a webview with file-system
access, so `read_ui_theme_css` rewrites it before injection
(`ui_themes.rs → sanitize_css`, unit-tested):

1. `/* … */` comments are stripped first, so nothing can hide inside one.
2. CSS hex escapes that decode to ASCII letters/digits or `( : @ - / <` are
   decoded (`\75rl(` → `url(`), so escaped spellings cannot bypass the rules.
   Non-ASCII escapes (`\e900`, `\201C`) are kept.
3. Every `@import …;` statement is removed.
4. Every `url(…)` / `src(…)` argument is inspected:
   - a relative path inside the theme folder (no leading `/`, no scheme, no
     `..`) is rewritten to the asset-protocol URL Tauri uses for local files
     (`http://asset.localhost/<encoded path>` on Windows, `asset://localhost/…`
     elsewhere) — the same scheme as `wrapAssetUrl` in the frontend;
   - anything else (`http(s):`, `//host`, `data:`, `javascript:`, absolute
     paths, `..`) is replaced with `none`.
5. `expression(`, `-moz-binding`, `behavior:`, `javascript:`, `vbscript:` and
   `</style` are neutralised wherever they appear.
6. All CSS files together must be ≤ 2 MB (`E_UI_THEME_CSS_TOO_LARGE`).
7. Files are read only if they canonicalise inside the themes root, so a
   symlink pointing outside the folder is rejected.

Tauri's asset scope allows `$APPDATA/ui_themes/**`, and the CSP lets fonts
and images load from the asset protocol (`img-src`, `font-src`). Remote
resources of any kind cannot be loaded by a theme.

## 7. Developer workflow

1. Settings › Apariencia › Temas de la comunidad › **Crear tema de ejemplo**,
   then **Abrir carpeta de temas**.
2. Rename the folder and the `id` in `theme.json` (they must match).
3. Tick **Vigilar cambios**. The loader re-reads the theme every 2 s and
   re-injects only when a file's modification time changed, so edits appear
   live without restarting.
4. **Activar** your theme. Press `Ctrl/⌘+Shift+T` if you paint yourself into
   a corner.
5. The active theme id is persisted in the app database (`app_env` row
   `ui_theme_active`) and reapplied on every start.

How it is wired: `components/ui-themes/UiThemeLoader.tsx` (mounted once in
`BaseLayout.astro`) injects `<style id="metadea-ui-theme" data-theme-id="…">`
as the last child of `<head>` — after all app stylesheets, so it wins the
cascade without `!important` — and sets `data-ui-theme` on `<html>`. It
re-injects after every Astro page swap and reacts to the
`metadea:ui-theme-changed` window event (`lib/ui-themes/ui-theme-events.ts`).

## 8. Sharing a theme

Zip the theme folder (the folder itself, so the zip contains
`my-skin/theme.json`) and share it; recipients unzip it into their
`ui_themes` folder and press **Recargar**. A community index (a curated list
of theme repositories browsable from Settings) is planned; keep `homepage`
and `version` in your manifest accurate so it can pick them up.

## 9. Error codes

| Code | Meaning |
|---|---|
| `E_UI_THEME_INVALID_ID` | Folder name / manifest id violates `^[a-z0-9-]+$`. |
| `E_UI_THEME_NOT_FOUND` | No such theme folder. |
| `E_UI_THEME_MANIFEST_INVALID` | `theme.json` missing, unparsable or failing a rule above (detail says which). |
| `E_UI_THEME_CSS_TOO_LARGE` | Concatenated CSS exceeds 2 MB. |
| `E_UI_THEME_IO` | A file could not be read or is outside the themes folder. |
| `E_UI_THEME_OPEN_FOLDER` | The OS file manager could not be launched. |
