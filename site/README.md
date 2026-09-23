# Metadea static site

Plain HTML, no build step. Currently holds only the deep-link redirect page.

Links copied from the app ("Copy link", `l`) and the Discord "Open in Metadea"
button now use the rich share links served by the `metadea` Worker (repo
`metadea-web`, route `src/routes/share.ts`), whose Discord/Open Graph preview
shows the work:

```
https://metadea.metadea.workers.dev/g/2136/bayonetta-2009/hsac-86-co9xp1
```

The format is defined by `frontend/src/lib/deep-link/share-link-codec.ts`,
duplicated byte-for-byte as `metadea-web/src/services/share-codec.ts`; both
repos test their copy against the same `share-link-fixtures.json`, so change
the two codecs and the two fixture files together. `open/` stays as the
fallback: links without enough catalog data, and malformed share links (the
Worker redirects those here).

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

GitHub Pages "deploy from a branch" only serves `/` or `/docs`, so this
folder is published by the `.github/workflows/pages.yml` workflow instead:

1. Repository **Settings → Pages**.
2. **Source**: "GitHub Actions". Save (nothing else to pick).
3. Push `main` (the workflow runs on changes under `site/`, or start it by
   hand from **Actions → Publish site (GitHub Pages) → Run workflow**).
4. After the first deploy the page is served at
   `https://shadorossa.github.io/Metadea/open/`.

`SHARE_URL_BASE` in `frontend/src/lib/deep-link/deep-link-routes.ts` must
match that URL; change both if the site ever moves (custom domain, etc.).
