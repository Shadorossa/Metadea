// Plugins (src/plugins, docs/PLUGINS.md).
//
// `plugins`: one row per installed plugin. `version` names the folder under
// `<app data>/plugins/<id>/<version>/`; `granted_permissions` is the JSON
// array of permission tokens the user consented to (`host:<pattern>`,
// `settingsHost:<key>`, `cap:<capability>`); `settings` the JSON object of
// the user's values (secrets DPAPI-wrapped). Times are unix seconds.
//
// `plugin_storage`: the key/value store behind `metadea.storage`, namespaced
// by plugin id.
//
// `plugin_work_links`: the source a work's "Read" tab uses and the item it
// matched there, one per work.
use rusqlite::{Result as SqlResult, Transaction};

pub(crate) fn migrate(tx: &Transaction) -> SqlResult<()> {
    tx.execute_batch(
        "CREATE TABLE IF NOT EXISTS plugins (
            id                  TEXT PRIMARY KEY,
            version             TEXT NOT NULL,
            enabled             INTEGER NOT NULL DEFAULT 1,
            installed_at        INTEGER NOT NULL,
            updated_at          INTEGER NOT NULL,
            granted_permissions TEXT NOT NULL DEFAULT '[]',
            settings            TEXT NOT NULL DEFAULT '{}'
        );
        CREATE TABLE IF NOT EXISTS plugin_storage (
            plugin_id  TEXT NOT NULL,
            key        TEXT NOT NULL,
            value      TEXT NOT NULL,
            updated_at INTEGER NOT NULL,
            PRIMARY KEY (plugin_id, key)
        );
        CREATE TABLE IF NOT EXISTS plugin_work_links (
            external_id TEXT PRIMARY KEY,
            plugin_id   TEXT NOT NULL,
            source_id   TEXT NOT NULL,
            item_id     TEXT NOT NULL,
            item_title  TEXT NOT NULL DEFAULT '',
            updated_at  INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_plugin_work_links_plugin ON plugin_work_links(plugin_id);",
    )
}
