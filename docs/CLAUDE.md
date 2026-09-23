# Metadea — Development Rules

## CSS

**No inline `<style>` blocks in `.astro` files.**
Todo el CSS va en archivos `.css` dentro de `frontend/src/styles/`.

| Archivo | Contenido |
|---|---|
| `global.css` | Tokens CSS, reset, base (`body`, `*`) |
| `components.css` | Clases reutilizables (cards, modal, inputs, placeholders…) |
| `navbar.css` | Estilos del Navbar |
| `search.css` | Estilos de la página `/search` |

Páginas con estilos propios crean su archivo (e.g. `profile.css`) e importan en el frontmatter:
```astro
---
import '../styles/profile.css';
---
```

Las clases compartidas entre varias páginas van en `components.css`, no se duplican.

## i18n

**No hardcodear texto visible al usuario.**
Todo string que el usuario ve pasa por el sistema i18n (`frontend/src/i18n/`).

- Añadir la clave en `en.ts` (idioma de referencia) y en los otros 7 locales manteniendo la misma estructura.
- En páginas Astro: `const t = useTranslations(lang)` → `{t.seccion.clave}`, **y** el elemento lleva el
  marcador con la misma clave (`data-i18n="seccion.clave"`, `data-i18n-title|-aria-label|-placeholder|-alt`,
  `data-i18n-html` solo para markup estático de confianza, `data-i18n-vars='{"n":3}'` para `{n}`). El build
  estático se renderiza en inglés; `lib/i18n-dom/` re-traduce esos marcadores en cliente al idioma resuelto
  (Ajustes → idioma del sistema → inglés). Título de pestaña: `<BaseLayout titleKey="seccion.clave">`.
  `tests/i18n-dom-keys.test.ts` comprueba que cada clave existe.
- En islands React: recibir `i18n` como prop desde la página Astro.
- Nunca usar `useTranslations` dentro de un componente React (se ejecuta en cliente).

## Componentes

- `.astro` para estructura estática y layouts.
- React (`client:load`) solo cuando hay interactividad real (estado, eventos dinámicos).
- Un `.astro` es estructura: la lógica de página va en `lib/` (pura) o en una isla React, nunca
  en un `<script>` inline largo. Esa regla anterior produjo `character.astro` con 992 líneas de
  script y 13 `innerHTML` escapados a mano; el patrón correcto es `media.astro` (16 líneas).
- Puntos de montaje imperativos (`createRoot(...)` llamados desde un `.astro`) viven en
  `components/<área>/mount/`, no en `lib/`.

## Mapa de `frontend/src`

| Carpeta | Qué contiene | Convención de nombre |
|---|---|---|
| `pages/` | Un `.astro` por ruta; estructura, sin lógica larga | kebab-case |
| `layouts/` | `BaseLayout.astro` | PascalCase |
| `components/<área>/` | Componentes React/Astro del área (`media`, `character`, `author`, `company`, `local`, `profile`, `search`, `settings`, `admin`, `home`, `reader`, `player`, `notifications`, `tier`, `social`, `bingo`, `spoilers`) | `PascalCase.tsx` |
| `components/<área>/hooks/` | Hooks de esa área | `useX.ts` |
| `components/<área>/mount/` | Montajes imperativos desde `.astro` (`createRoot`, wiring DOM de settings) | kebab-case |
| `components/media/{media-page,media-editor,pr-editor}/` | Secciones, hooks y estado de cada componente grande | mezcla: `PascalCase.tsx` para vistas, kebab-case para lógica |
| `components/search-popups/` | Popups de búsqueda compartidos por los editores | PascalCase |
| `components/shared/` (+`hooks/`) | Piezas transversales (`ModalShell`, `RichTextEditor`, `useExternalStore`…) | PascalCase / `useX` |
| `lib/tauri/` | Capa IPC: un módulo por dominio de comandos Rust (`bridge.ts` es el `invoke`) | kebab-case |
| `lib/errors/` | `error-codes.ts` (espejo de `src-tauri/src/error_codes.rs`) y `formatAppError` — traduce los códigos `E_*` que devuelven los comandos Rust | kebab-case |
| `lib/player/` | Reproductor integrado (libmpv): cola, reglas de progreso, keymap, estado del modal, presencia | kebab-case |
| `lib/deep-link/` | Rutas `metadea://` (`deep-link-routes`), listener, copia de enlaces y enlaces con vista previa (`share-link` + `share-link-codec`, códec duplicado en el repo `metadea-web` con `share-link-fixtures.json` como tabla de paridad) | kebab-case |
| `lib/media/` | Dominio de obras; subcarpetas `mappers/`, `saga/`, `editions/`, `episodes/`, `themes/`, `editor/` | kebab-case |
| `lib/local/` | Biblioteca local: `folder-match`, `season-resolve`, `playback-service`, `discord-presence`, `platforms` | kebab-case |
| `lib/character/`, `lib/author/`, `lib/company/`, `lib/profile/`, `lib/bingo/`, `lib/github/`, `lib/search/`, `lib/anilist/`, `lib/social/`, `lib/reader/`, `lib/anime/` | Un dominio por carpeta (`lib/anime/filler*.ts`: relleno de AnimeFillerList, totales/progreso efectivos, `nextCanonEpisode`); un provider grande se parte en carpeta (`lib/search/providers/anilist/`: `queries`, `types`, `mappers`, `client`, `detail`, `search`, con `index.ts` como única superficie pública) | kebab-case |
| `lib/api/` | HTTP, endpoints, rate limiter, `urls.ts` | kebab-case |
| `lib/storage/` | localStorage/IndexedDB: `storage-keys`, `preferences`, `images` | kebab-case |
| `lib/dom/` | Helpers de DOM sin React: `toast`, `modal-utils`, `global-loading`, `icon-strings` | kebab-case |
| `lib/notifications/` | Notificaciones del SO | kebab-case |
| `lib/spoilers/` | Escudo antispoilers: franquicias protegidas (biblioteca + relaciones de la caché de visita), comparación de progreso, líneas de stats sensibles, late debuts, ajustes y reveals (sesión / franquicia en localStorage); la UI común en `components/spoilers/` | kebab-case |
| `lib/shared/{text,collections,state}/` | Utilidades puras por familia | kebab-case |
| `lib/i18n-dom/` | Re-traducción en cliente de los marcadores `data-i18n*` y el script inline de `<head>` que resuelve el idioma antes de pintar (lo monta `components/i18n/LocaleBootstrap.astro`) | kebab-case |
| `i18n/` | `en.ts` es la fuente de verdad (idioma de referencia; fallback en runtime); `runtime.ts` (`getT`) para cliente, `index.ts` para `.astro` | — |

Reglas: `lib/` no importa React ni nada de `components/`; nada de nombres genéricos (`utils.ts`, `misc-*.ts`, `core.ts`) — el nombre dice qué hay dentro; nada de nombres en español en archivos.

## Mapa de `frontend/src-tauri/src`

| Ruta | Qué contiene |
|---|---|
| `lib.rs` | Plugins, `setup` y el `generate_handler!` con todos los comandos |
| `error_codes.rs` | Códigos `E_*` que devuelven los comandos (+ `with_detail`); test de paridad con el crate |
| `acl_coverage.rs` | Test: cada comando de `generate_handler!` está en `permissions/*.toml` y viceversa |
| `db.rs`, `migrations/` | Apertura de SQLite, vistas, índices; migraciones por versión |
| `player/` | Motor libmpv (FFI, event loop, ventana de vídeo, comandos `player_*`) |
| `folders/` | Diálogos, rutas, lanzamiento de juegos/emuladores, capturas, toast de episodio |
| `platform_scanning/`, `igdb/` | Escaneo de Steam/Epic/GOG/EA/Xbox/ROMs (juegos multidisco y `.m3u` en `multi_disc.rs`; fusión de entradas antiguas por disco en `rom_disc_merge.rs`); cliente y caché de IGDB |
| `game_pause/` | Menú de pausa con mando (Select/Back + Start 1,5 s): XInput, suspender/reanudar el emulador de la sesión (`game_sessions.rs`), Continuar / Guardar estado / Salir |
| `saves/` | Gestor de partidas de emuladores: carpeta central, tabla por emulador (redirect RetroArch / mirror), historial, sync con Drive (ver `docs/SAVES.md`) |
| `deep_link.rs` | Esquema `metadea://` (validación de rutas, foco de ventana) |
| `company_catalog/` | Páginas de compañía (`/company?id=igdb:…`, `anilist-studio:…`, `tmdb-company:…`, `tmdb-network:…`, `comicvine:…`): IGDB/AniList/TMDB con las claves del usuario, caché `company_cache` (TTL 7 días) y fallback al catálogo local (`media_by_company`) |
| `anime_filler/` | Relleno de anime desde AnimeFillerList.com (HTML, sin API): índice semanal, episodios por serie (en emisión: semanal; terminada: solo manual), 1 petición/s, backoff de un día ante 403/429; tablas `filler_*` |
| `<dominio>.rs` | Un archivo por dominio de comandos (`user_library`, `media_catalog`, `characters`, `backup`, …) |

Reglas: **todo `#[tauri::command]` nuevo se añade a `permissions/*.toml`** (lo exige
`acl_coverage.rs` en `cargo test`); **un comando devuelve `Err(código)` de `error_codes.rs`,
nunca texto** — el frontend lo traduce con `formatAppError` (ver `DEVELOPMENT_RULES.md`, 1.3 y 1.4).

## Otras carpetas del repositorio

| Carpeta | Qué contiene |
|---|---|
| `site/` | Sitio estático sin build (GitHub Pages): `open/` redirige `https://…/open/?to=…` a `metadea://` para enlaces compartidos |
| (repo `metadea-web`) | Worker `metadea` (`https://metadea.metadea.workers.dev`): API, imágenes y la ruta `/<t>/<id>/<slug>/<packed>` de enlaces compartidos con vista previa Open Graph (`src/routes/share.ts`); `open/` queda como fallback |
| `docs/` | Este mapa y `DEVELOPMENT_RULES.md` |
| `catalog/`, `scripts/`, `workers/` | Propuestas del catálogo comunitario, scripts de build de la base de datos y workers |

## Dirección de dependencias

`pages → components → lib`. `lib/` no importa nada de `components/`. Los tipos compartidos entre
un componente grande y sus helpers van en un módulo hoja (`pr-editor-types.ts`,
`lib/search/types.ts`), no en el componente. Los providers importan del módulo concreto
(`lib/tauri/igdb`), nunca del barrel `lib/tauri`.

## Escrituras

Toda escritura de datos de usuario propaga su error; `.catch(() => fallback)` solo en lecturas
cuya ausencia la UI ya representa. Ver `docs/DEVELOPMENT_RULES.md`, Nivel 0.
