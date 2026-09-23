# Metadea static site

Plain HTML, no build step. Currently holds only the deep-link redirect page.

## `open/` — https redirect to `metadea://`

Discord Rich Presence buttons (and most chats) only accept `https://` links, so
a shared link points here and this page forwards it to the app's own scheme:

```
https://shadorossa.github.io/Metadea/open/?to=media/anime:21610
    → metadea://media/anime:21610
```

Accepted `to` values (same validation as `frontend/src-tauri/src/deep_link.rs`
and `frontend/src/lib/deep-link/deep-link-routes.ts`):

| `to`                       | Opens                         |
|----------------------------|-------------------------------|
| `home`                     | Home                          |
| `media/<provider>:<id>`    | A work, e.g. `media/anime:21610` |
| `character/<code>:<id>`    | A character, e.g. `character/a:12345` |
| `profile/<user>`           | A public profile              |

Anything else renders "Invalid link". If the app does not pick the link up
within 1.5 s the page shows "Metadea is not installed" with the GitHub
releases link.

## Publishing with GitHub Pages (one-time, manual)

1. Repository **Settings → Pages**.
2. **Source**: "Deploy from a branch".
3. **Branch**: `main`, **Folder**: `/site`. Save.
4. After the first deploy the page is served at
   `https://shadorossa.github.io/Metadea/open/`.

`SHARE_URL_BASE` in `frontend/src/lib/deep-link/deep-link-routes.ts` must
match that URL; change both if the site ever moves (custom domain, etc.).
