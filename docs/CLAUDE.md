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
- Los scripts de página van en `<script>` inline en el `.astro`, no en archivos `.ts` sueltos salvo que sean utilidades reutilizables.
