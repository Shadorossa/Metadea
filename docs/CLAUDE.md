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

- Añadir la clave en `es.ts` y `en.ts` manteniendo la misma estructura.
- En páginas Astro: `const t = useTranslations(lang)` → `{t.seccion.clave}`
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
| `components/<área>/` | Componentes React/Astro del área (`media`, `character`, `local`, `profile`, `search`, `settings`, `admin`, `home`, `reader`, `notifications`, `tier`, `social`) | `PascalCase.tsx` |
| `components/<área>/hooks/` | Hooks de esa área | `useX.ts` |
| `components/<área>/mount/` | Montajes imperativos desde `.astro` (`createRoot`, wiring DOM de settings) | kebab-case |
| `components/media/{media-page,media-editor,pr-editor}/` | Secciones, hooks y estado de cada componente grande | mezcla: `PascalCase.tsx` para vistas, kebab-case para lógica |
| `components/search-popups/` | Popups de búsqueda compartidos por los editores | PascalCase |
| `components/shared/` (+`hooks/`) | Piezas transversales (`ModalShell`, `RichTextEditor`, `useExternalStore`…) | PascalCase / `useX` |
| `lib/tauri/` | Capa IPC: un módulo por dominio de comandos Rust (`bridge.ts` es el `invoke`) | kebab-case |
| `lib/media/` | Dominio de obras; subcarpetas `mappers/`, `saga/`, `editions/`, `episodes/`, `themes/`, `editor/` | kebab-case |
| `lib/local/` | Biblioteca local: `folder-match`, `season-resolve`, `playback-service`, `discord-presence`, `platforms` | kebab-case |
| `lib/character/`, `lib/profile/`, `lib/github/`, `lib/search/`, `lib/anilist/`, `lib/social/`, `lib/reader/` | Un dominio por carpeta | kebab-case |
| `lib/api/` | HTTP, endpoints, rate limiter, `urls.ts` | kebab-case |
| `lib/storage/` | localStorage/IndexedDB: `storage-keys`, `preferences`, `images` | kebab-case |
| `lib/dom/` | Helpers de DOM sin React: `toast`, `modal-utils`, `global-loading`, `icon-strings` | kebab-case |
| `lib/notifications/` | Notificaciones del SO | kebab-case |
| `lib/shared/{text,collections,state}/` | Utilidades puras por familia | kebab-case |
| `i18n/` | `es.ts` es la fuente de verdad; `runtime.ts` (`getT`) para cliente, `index.ts` para `.astro` | — |

Reglas: `lib/` no importa React ni nada de `components/`; nada de nombres genéricos (`utils.ts`, `misc-*.ts`, `core.ts`) — el nombre dice qué hay dentro; nada de nombres en español en archivos.

## Dirección de dependencias

`pages → components → lib`. `lib/` no importa nada de `components/`. Los tipos compartidos entre
un componente grande y sus helpers van en un módulo hoja (`pr-editor-types.ts`,
`lib/search/types.ts`), no en el componente. Los providers importan del módulo concreto
(`lib/tauri/igdb`), nunca del barrel `lib/tauri`.

## Escrituras

Toda escritura de datos de usuario propaga su error; `.catch(() => fallback)` solo en lecturas
cuya ausencia la UI ya representa. Ver `docs/DEVELOPMENT_RULES.md`, Nivel 0.
