# Metadea plugins — API reference (v1)

Plugins add features to Metadea without changing the app: reading sources,
buttons and cards on media pages, and read-only activity events (for example,
to sync progress to another service). Metadea itself ships **no content
sources, repositories or site-specific code**; it is a neutral host. Plugins
are installed by the user from a `.zip` file or an `https` URL.

- Example plugin: [`plugins/examples/hello-source/`](../plugins/examples/hello-source/)
  (not bundled; used by the tests).
- Code: Rust `frontend/src-tauri/src/plugins/`, runtime `frontend/src/lib/plugins/`,
  UI `frontend/src/components/plugins/`.

## 1. Package

A package is a `.zip` (or, for development, a folder) with:

```
manifest.json
main.js          # the entry named by "main"
icon.svg         # optional, named by "icon" (png/svg/webp/jpg, ≤ 256 KB)
```

Everything may also sit inside one top-level folder (what zipping a folder
produces); it is stripped. Limits: 25 MB compressed download, 2,000 entries,
20 MB per file, 50 MB uncompressed, entry script ≤ 5 MB. Entries with `..`,
absolute paths, drive letters, `:` or symlinks make the whole package invalid.

Installed packages live in `<app data>/plugins/<id>/<version>/`
(Settings › Plugins › Open plugins folder).

### The entry script

`main` is a **classic worker script** (not an ES module): no `import`/`export`,
one file. Bundle dependencies into it, e.g. `esbuild src/index.ts --bundle
--format=iife --outfile=main.js`. It runs inside a function that receives the
SDK as `metadea` (also reachable as `self.metadea`). The app's CSP applies:
`eval` and `new Function` are not available.

## 2. `manifest.json`

```json
{
  "id": "com.example.my-source",
  "name": "My Source",
  "version": "1.2.0",
  "apiVersion": 1,
  "author": "Me",
  "description": "What it does (≤ 500 chars).",
  "icon": "icon.svg",
  "main": "main.js",
  "permissions": {
    "hosts": ["api.example.com", "*.cdn.example.com"],
    "settingsHosts": ["serverUrl"],
    "capabilities": ["notifications", "openUrl"]
  },
  "settings": [
    { "key": "serverUrl", "type": "url", "label": "Server", "required": true, "placeholder": "http://192.168.1.10:4567" },
    { "key": "password", "type": "secret", "label": "Password" }
  ],
  "contributes": {
    "sources": [{ "id": "main", "name": "My Source", "types": ["manga", "comic"], "language": "en" }],
    "workActions": [{ "id": "open", "label": "Open in My Source", "types": ["manga"] }],
    "workPanels": [{ "id": "stats", "label": "My Source", "types": [] }],
    "events": ["progress.changed"]
  }
}
```

Validation is strict (unknown fields are errors) and runs on install and on
every load, in Rust (`plugins/manifest.rs`) and mirrored in TypeScript
(`lib/plugins/manifest.ts`); both run the case table
`src-tauri/src/fixtures/plugins/manifest-cases.json`.

| Field | Rule |
|---|---|
| `id` | reverse-DNS, lower case: `[a-z][a-z0-9-]*(\.[a-z0-9-]+)+`, ≤ 100 chars. Never changes between versions. |
| `version` | `MAJOR.MINOR.PATCH[-prerelease]` |
| `apiVersion` | `1`. Other values: `E_PLUGIN_API_UNSUPPORTED`. |
| `name`, `author` | 1–64 chars |
| `main`, `icon` | relative paths inside the package |
| `settings` | ≤ 32 fields, keys `[A-Za-z][A-Za-z0-9_]*` |
| `contributes.*` ids | `[a-z0-9][a-z0-9-]*`, unique per kind, ≤ 16 per kind |

### Settings schema

| `type` | Value | Extra fields |
|---|---|---|
| `string` | string | `placeholder` |
| `secret` | string, never shown again; encrypted with Windows DPAPI (user scope) before it is stored (base64 only on other platforms). No `default`. | |
| `number` | number | `min`, `max` |
| `boolean` | `true`/`false` | |
| `select` | one of `options[].value` | `options: [{ value, label }]` |
| `url` | `http(s)://…`, no credentials | |

Common fields: `label` (required), `description`, `default`, `required`.
Settings are edited in Settings › Plugins; a save restarts the plugin's worker.

## 3. Permissions and consent

| Manifest | Token | Grants |
|---|---|---|
| `hosts: ["api.example.com"]` | `host:api.example.com` | `metadea.http.fetch` to that host |
| `settingsHosts: ["serverUrl"]` | `settingsHost:serverUrl` | the exact host:port of the URL the **user** types into that `url` setting |
| `capabilities: ["notifications"]` | `cap:notifications` | `metadea.notify` |
| `capabilities: ["openUrl"]` | `cap:openUrl` | `workActions` results of type `openUrl` |

The user sees every token before install. An update whose tokens are not a
subset of the previous grant shows the prompt again (new items highlighted);
an update that asks for the same or less installs silently. A package edited
on disk to ask for more does not run until the user accepts
("Review permissions"). Storage needs no permission.

### Hosts

Patterns: `example.com`, `example.com:8443`, `example.com:*` (any port),
`*.example.com` (any subdomain depth, **not** `example.com` itself),
`*.example.com:8443`, IPv4 (`192.168.1.10:4567`) and `[IPv6]:port`. A pattern
without a port matches only the scheme's default port. Rejected: schemes,
paths, `*`, `*.com`, wildcards on IPs or `localhost`.

Scheme rule: `https` everywhere; plain `http` only to local hosts —
`localhost`, loopback, private/link-local/CGNAT (`100.64/10`) addresses,
`fc00::/7`, `fe80::/10`, single-label names (`nas`) and `.local`, `.lan`,
`.home.arpa`, `.internal` — and only when the host is also granted.
Redirects are followed by hand (≤ 5) and every hop is checked again;
`Authorization`/`Cookie` are dropped on a cross-origin redirect.

## 4. Runtime

Each enabled plugin runs in its **own dedicated Web Worker**, created from a
Blob URL the first time something needs it (an extension-point call or an
event). The worker has no DOM, no Tauri access, and before the plugin runs the
SDK removes `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`,
`importScripts`, `Worker`, `SharedWorker`, `BroadcastChannel`, `indexedDB`
and `caches` from its global scope — `metadea.http.fetch` is the only way out.

Calls are request/response messages with ids and timeouts (search/details
30 s, pages/latest 60 s, actions 20 s, panels 15 s). A call that times out
triggers a ping; a worker that does not answer it (a busy loop) is terminated.
A worker that throws while loading, reports an error or stops answering is
**isolated**: its pending calls fail, it restarts on the next demand after
1, 2, 4… s (max 60 s), and after 5 crashes in a row it stays stopped (badge
"Stopped after repeated crashes") until it is disabled/enabled or updated.
A disabled plugin never starts (Rust also refuses to hand out its code).

Results are validated and capped by the host (`lib/plugins/plugin-results.ts`);
nothing a plugin returns is ever rendered as HTML.

## 5. SDK (`metadea`)

```js
metadea.apiVersion            // 1
metadea.plugin                // { id, version }
metadea.register({ sources, workActions, workPanels, events })  // once
await metadea.http.fetch(url, {
  method,        // GET (default), HEAD, POST, PUT, PATCH, DELETE
  headers,       // { name: value }, ≤ 32; Host, Content-Length, Connection,
                 // Transfer-Encoding, Upgrade, TE, Trailer, Expect, Proxy-*, Sec-* refused
  body,          // string, or bodyBase64 for bytes (≤ 4 MB; not with GET/HEAD)
  responseType,  // 'text' (default) or 'base64'
  timeoutMs,     // 1,000–60,000 (default 20,000)
})               // → { status, ok, url, headers, body, bodyEncoding, json() }; body ≤ 32 MB
await metadea.storage.get(key)          // JSON value or null
await metadea.storage.set(key, value)   // JSON-serialisable; null deletes. Keys ≤ 256 chars,
                                        // values ≤ 1 MB, 10 MB per plugin
await metadea.settings.get()            // effective values (defaults applied, secrets decrypted)
metadea.log.info(...args) / .warn / .error
await metadea.notify(title, body)       // needs "notifications"; 3 at once, then 1 per minute;
                                        // shown as "<plugin name>: <title>"
```

Host errors reject with an `Error` whose message starts with the code, e.g.
`E_PLUGIN_HOST_NOT_ALLOWED: cdn.example.org`.

## 6. Extension points

Every handler receives JSON-serialisable arguments and may return a value or
a promise. Contributions must be declared in the manifest **and** registered
in code; undeclared ids are never called.

### `sources`

```js
metadea.register({ sources: { main: {
  async search(query, page) {            // page starts at 1
    return { items: [{ id, title, cover, type, anilistId, malId, year }], hasMore: false };
  },
  async details(id) {
    return { id, title, description, cover,
             chapters: [{ id, number, title, volume, date, scanlator }] };
  },
  async pages(chapterId) {
    return { kind: 'images', pages: [{ url, headers }] };      // or plain URL strings
    // or: { kind: 'archive', url, format: 'cbz' | 'zip' | 'epub' | 'pdf', headers }
  },
  async latest() {                       // optional
    return { items: [{ itemId, chapterNumber }] };
  },
} } });
```

- `type`: `manga`, `comic`, `lnovel` or `book`; `cover`/page `url`: `http(s)`
  or `data:image/…`. Remote covers and pages are fetched through
  `plugin_http_fetch` (the plugin's hosts and page `headers` apply) and handed
  to the UI as `data:` URLs. Archives are downloaded to the app cache (≤ 300 MB)
  and opened by the regular CBZ/EPUB/PDF readers.
- Caps: 100 search items, 5,000 chapters, 1,000 pages per chapter.

**The "Read" tab.** On a manga/comic/light-novel page with an enabled source
for that type, Metadea searches each source by the work's titles and picks
the item with the same AniList id, else the same MAL id, else an exact
normalised title (same type preferred, release year within ±1); otherwise the
user picks from the results. The match is remembered per work. Chapters show
read markers from library progress; opening one uses the built-in reader, and
finishing it writes the chapter number to library progress (never backwards)
and syncs to AniList/MAL like any other reading.

### `workActions`

```js
workActions: { open: async (work) => ({ type: 'openUrl', url: 'https://…' }) }
```

`work` = `{ externalId, type, titles, anilistId, malId, year }`. Results:
`{ type: 'toast', message, level?: 'success' | 'error' }`,
`{ type: 'openUrl', url }` (https, needs `openUrl`),
`{ type: 'notify', title, body }` (needs `notifications`), or nothing.

### `workPanels`

```js
workPanels: { stats: async (work) => ({
  title: 'My Source', badges: ['Ongoing'],
  rows: [{ label: 'Chapters', value: '120', href: 'https://…' }],
}) }
```

Return `null` to hide the card. Limits: 30 rows, 10 badges; `href` must be https.

### `events`

Read-only notifications with minimal payloads:

| Event | Payload |
|---|---|
| `library.changed` | `{}` (debounced to one per second) |
| `progress.changed` | `{ externalId, type, number }` — an episode/chapter marked watched/read |
| `session.ended` | `{ externalId, type, kind: 'read' \| 'watch' \| 'play' }` |

```js
events: { 'progress.changed': async ({ externalId, number }) => { /* sync */ } }
```

Subscribing starts the plugin's worker when the event fires.

### Adding an extension point (Metadea developers)

Add an entry to `EXTENSION_CALLS` (`lib/plugins/extension-points.ts`) with its
contribution kind, method, timeout and result sanitiser; add the kind to
`Contributions` in `manifest.rs`/`manifest.ts` and to the case table; document
it here. The worker SDK dispatches any registered kind unchanged.

## 7. Rust commands (for reference)

`plugin_list`, `plugin_install_from_file(path?)`, `plugin_install_from_url(url)`
(both stage the package and return a preview), `plugin_install_confirm(token)`,
`plugin_install_cancel(token)`, `plugin_grant_permissions`, `plugin_set_enabled`,
`plugin_uninstall`, `plugin_get_settings(id, includeSecrets?)`,
`plugin_set_settings`, `plugin_read_entry`, `plugin_http_fetch`,
`plugin_http_download`, `plugin_storage_get/set`, `plugin_get/set_work_link`,
`plugin_open_folder`. SQLite: `plugins` (id, version, enabled, installed_at,
updated_at, granted_permissions JSON, settings JSON), `plugin_storage`,
`plugin_work_links` (migration 89).

## 8. Security notes

- CSP: the only change is `worker-src 'self' blob:` (workers otherwise fall
  back to `script-src 'self'`, which forbids Blob URLs). `script-src` stays
  `'self'` — no `eval` in the page or in workers.
- Workers share the page's origin; removing the network/storage globals is
  what keeps a plugin away from the app's IndexedDB and from unlisted hosts.
  DNS names are not re-resolved: a public host name the user granted could
  still point at a LAN address.
- Only install plugins you trust: a plugin can send what it is given to the
  hosts it was granted.
