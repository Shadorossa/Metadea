#!/usr/bin/env node
// Rebuilds database.db (repo root) from every database/*.json a merged
// collaborative-catalog PR (see PrEditorModal.tsx's handleSubmit) has added.
// Run by .github/workflows/update-database.yml on every push to main that
// touches database/**; the desktop app downloads the resulting file (see
// media_catalog.rs's sync_community_catalog) and merges rows it doesn't
// already have locally into its own media_catalog table.
//
// node:sqlite is experimental — run with `node --experimental-sqlite`.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');

const REPO_ROOT = path.join(__dirname, '..');
const DATABASE_DIR = path.join(REPO_ROOT, 'database');
const DB_PATH = path.join(REPO_ROOT, 'database.db');

// Column order mirrors media_catalog's CREATE TABLE in frontend/src-tauri/src/db.rs
// (authors_csv inline, not appended) — keep both in sync by hand.
const CREATE_TABLE_SQL = `
CREATE TABLE media_catalog (
    id                   TEXT PRIMARY KEY,
    external_id          TEXT UNIQUE NOT NULL,
    parent_id            TEXT,
    type                 TEXT,
    format               TEXT DEFAULT '',
    source               TEXT DEFAULT '',
    title_main           TEXT DEFAULT '',
    title_romaji         TEXT DEFAULT '',
    title_native         TEXT DEFAULT '',
    synopsis             TEXT,
    cover_url            TEXT,
    banners_csv          TEXT DEFAULT '',
    release_year         INTEGER,
    release_month        INTEGER,
    release_day          INTEGER,
    time_length          INTEGER,
    status               TEXT,
    score_global         REAL,
    favorites_count      INTEGER DEFAULT 0,
    ratings_count        INTEGER DEFAULT 0,
    total_count          INTEGER,
    total_count_2        INTEGER,
    genres_csv           TEXT DEFAULT '',
    genres_tag_csv       TEXT DEFAULT '',
    platforms_csv        TEXT DEFAULT '',
    companies_cache_csv  TEXT DEFAULT '',
    authors_csv          TEXT DEFAULT '',
    last_synced_at       TEXT,
    sync_failed_count    INTEGER DEFAULT 0,
    last_sync_error      TEXT,
    created_at           TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at           TEXT DEFAULT CURRENT_TIMESTAMP
);
`;

const COLUMNS = [
  'id', 'external_id', 'parent_id', 'type', 'format', 'source',
  'title_main', 'title_romaji', 'title_native', 'synopsis', 'cover_url', 'banners_csv',
  'release_year', 'release_month', 'release_day', 'time_length', 'status', 'score_global',
  'favorites_count', 'ratings_count', 'total_count', 'total_count_2',
  'genres_csv', 'genres_tag_csv', 'platforms_csv', 'companies_cache_csv', 'authors_csv',
  'last_synced_at', 'sync_failed_count', 'last_sync_error', 'created_at', 'updated_at',
];

function readEntries() {
  if (!fs.existsSync(DATABASE_DIR)) {
    console.log(`No ${DATABASE_DIR} directory found — nothing to build.`);
    return [];
  }
  const files = fs.readdirSync(DATABASE_DIR).filter(f => f.endsWith('.json'));
  const entries = [];
  for (const file of files) {
    try {
      const raw = fs.readFileSync(path.join(DATABASE_DIR, file), 'utf-8');
      const entry = JSON.parse(raw);
      if (!entry.external_id) {
        console.warn(`Skipping ${file}: missing external_id`);
        continue;
      }
      entries.push(entry);
    } catch (e) {
      console.warn(`Skipping ${file}: ${e.message}`);
    }
  }
  return entries;
}

function buildDatabase(entries) {
  if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH);
  const db = new DatabaseSync(DB_PATH);
  db.exec(CREATE_TABLE_SQL);

  const placeholders = COLUMNS.map(() => '?').join(', ');
  const stmt = db.prepare(`INSERT OR REPLACE INTO media_catalog (${COLUMNS.join(', ')}) VALUES (${placeholders})`);

  const now = new Date().toISOString();
  let count = 0;
  for (const entry of entries) {
    const row = COLUMNS.map(col => {
      if (col === 'id') return entry.id || crypto.randomUUID();
      if (col === 'created_at') return entry.created_at || now;
      if (col === 'updated_at') return entry.updated_at || now;
      const v = entry[col];
      return v === undefined ? null : v;
    });
    stmt.run(...row);
    count++;
  }

  db.close();
  return count;
}

const entries = readEntries();
const count = buildDatabase(entries);
console.log(`Built ${DB_PATH} with ${count} entries from ${entries.length} source files.`);
