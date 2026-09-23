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
| `components/<área>/` | Componentes React/Astro del área (`media`, `character`, `author`, `local`, `profile`, `search`, `settings`, `admin`, `home`, `reader`, `player`, `notifications`, `tier`, `social`) | `PascalCase.tsx` |
| `components/<área>/hooks/` | Hooks de esa área | `useX.ts` |
| `components/<área>/mount/` | Montajes imperativos desde `.astro` (`createRoot`, wiring DOM de settings) | kebab-case |
| `components/media/{media-page,media-editor,pr-editor}/` | Secciones, hooks y estado de cada componente grande | mezcla: `PascalCase.tsx` para vistas, kebab-case para lógica |
| `components/search-popups/` | Popups de búsqueda compartidos por los editores | PascalCase |
| `components/shared/` (+`hooks/`) | Piezas transversales (`ModalShell`, `RichTextEditor`, `useExternalStore`…) | PascalCase / `useX` |
| `lib/tauri/` | Capa IPC: un módulo por dominio de comandos Rust (`bridge.ts` es el `invoke`) | kebab-case |
| `lib/errors/` | `error-codes.ts` (espejo de `src-tauri/src/error_codes.rs`) y `formatAppError` — traduce los códigos `E_*` que devuelven los comandos Rust | kebab-case |
| `lib/player/` | Reproductor integrado (libmpv): cola, reglas de progreso, keymap, estado del modal, presencia | kebab-case |
| `lib/deep-link/` | Rutas `metadea://` (`deep-link-routes`), listener y copia de enlaces | kebab-case |
| `lib/media/` | Dominio de obras; subcarpetas `mappers/`, `saga/`, `editions/`, `episodes/`, `themes/`, `editor/` | kebab-case |
| `lib/local/` | Biblioteca local: `folder-match`, `season-resolve`, `playback-service`, `discord-presence`, `platforms` | kebab-case |
| `lib/character/`, `lib/author/`, `lib/profile/`, `lib/github/`, `lib/search/`, `lib/anilist/`, `lib/social/`, `lib/reader/` | Un dominio por carpeta; un provider grande se parte en carpeta (`lib/search/providers/anilist/`: `queries`, `types`, `mappers`, `client`, `detail`, `search`, con `index.ts` como única superficie pública) | kebab-case |
| `lib/api/` | HTTP, endpoints, rate limiter, `urls.ts` | kebab-case |
| `lib/storage/` | localStorage/IndexedDB: `storage-keys`, `preferences`, `images` | kebab-case |
| `lib/dom/` | Helpers de DOM sin React: `toast`, `modal-utils`, `global-loading`, `icon-strings` | kebab-case |
| `lib/notifications/` | Notificaciones del SO | kebab-case |
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
| `folders/` | Diálogos, rutas, lanzamiento de juegos/emuladores, VLC, capturas, toast de episodio |
| `platform_scanning/`, `igdb/` | Escaneo de Steam/Epic/GOG/EA/Xbox/ROMs; cliente y caché de IGDB |
| `deep_link.rs` | Esquema `metadea://` (validación de rutas, foco de ventana) |
| `<dominio>.rs` | Un archivo por dominio de comandos (`user_library`, `media_catalog`, `characters`, `backup`, …) |

Reglas: **todo `#[tauri::command]` nuevo se añade a `permissions/*.toml`** (lo exige
`acl_coverage.rs` en `cargo test`); **un comando devuelve `Err(código)` de `error_codes.rs`,
nunca texto** — el frontend lo traduce con `formatAppError` (ver `DEVELOPMENT_RULES.md`, 1.3 y 1.4).

## Otras carpetas del repositorio

| Carpeta | Qué contiene |
|---|---|
| `site/` | Sitio estático sin build (GitHub Pages): `open/` redirige `https://…/open/?to=…` a `metadea://` para enlaces compartidos |
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
