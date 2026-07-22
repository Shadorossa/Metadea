#!/usr/bin/env node
// Rebuilds database.db (repo root) from every database/*.json a merged
// collaborative-catalog PR (see PrEditorModal.tsx's handleSubmit) has added.
// Run by .github/workflows/update-database.yml on every push to main that
// touches database/**; the desktop app downloads the resulting file (see
// media_catalog.rs's sync_community_catalog) and merges rows it doesn't
// already have locally into its own tables.
//
// Each database/*.json is a *bundle*, not a bare media_catalog row:
//   { media_catalog: {...}, media_relations: [...], characters: [...],
//     media_authors: [...], saga_groups: {...}, saga_name: "..." }
// media_relations already includes both "Bundled In" (EPISODE/UPDATE) and
// saga-derived PREQUEL/SEQUEL entries — PrEditorModal resolves those before
// writing the file, so this script only has to fan them out into tables.
//
// node:sqlite is experimental — run with `node --experimental-sqlite`.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');

const REPO_ROOT = path.join(__dirname, '..');
const DATABASE_DIR = path.join(REPO_ROOT, 'database');
const DB_PATH = path.join(REPO_ROOT, 'database.db');

// Table shapes mirror frontend/src-tauri/src/db.rs's METADEA_SCHEMA — keep
// both in sync by hand. media_catalog's column order matches the *fresh*
// CREATE TABLE text (authors_csv inline); the app's merge query addresses
// columns by name specifically so it doesn't care that some existing local
// DBs have authors_csv appended last after an ALTER TABLE migration.
const CREATE_TABLES_SQL = `
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
    shop_links_csv       TEXT DEFAULT '',
    companies_cache_csv  TEXT DEFAULT '',
    authors_csv          TEXT DEFAULT '',
    last_synced_at       TEXT,
    sync_failed_count    INTEGER DEFAULT 0,
    last_sync_error      TEXT,
    manually_edited_at   TEXT,
    created_at           TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at           TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE characters (
    id          TEXT PRIMARY KEY,
    external_id TEXT UNIQUE NOT NULL,
    name        TEXT NOT NULL DEFAULT '',
    name_native TEXT,
    aliases_csv TEXT DEFAULT '',
    biography   TEXT,
    image_url   TEXT,
    reaction    TEXT,
    created_at  TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at  TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE character_appearances (
    character_external_id TEXT NOT NULL,
    media_external_id     TEXT NOT NULL,
    relation_type         TEXT,
    character_name        TEXT,
    added_at              TEXT DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (character_external_id, media_external_id)
);

-- relation_type is deliberately NOT part of the primary key — matches
-- db.rs's live media_relations table (migration 5). A 3-column PK here let
-- the same (media, related_media) pair accumulate more than one row (e.g.
-- once under a raw display label and again under a canonical key), and
-- since sync_community_catalog's INSERT OR IGNORE targets the user's
-- 2-column-PK table, a stray duplicate row here could silently win over the
-- canonical one depending on insertion order.
CREATE TABLE media_relations (
    media_external_id         TEXT NOT NULL,
    related_media_external_id TEXT NOT NULL,
    relation_type              TEXT NOT NULL,
    type_label                 TEXT NOT NULL,
    PRIMARY KEY (media_external_id, related_media_external_id)
);

CREATE TABLE media_author (
    external_id      TEXT PRIMARY KEY,
    name             TEXT NOT NULL,
    author_image_url TEXT,
    author_url       TEXT,
    created_at       TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at       TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE media_by_author (
    media_external_id  TEXT NOT NULL,
    author_external_id TEXT NOT NULL,
    role               TEXT,
    PRIMARY KEY (media_external_id, author_external_id)
);

CREATE TABLE media_saga_groups (
    media_external_id TEXT NOT NULL PRIMARY KEY,
    group_name         TEXT NOT NULL
);

CREATE TABLE sagas (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL DEFAULT '',
    description TEXT,
    created_at  TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at  TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE saga_relations (
    media_external_id TEXT NOT NULL,
    saga_id           TEXT NOT NULL,
    PRIMARY KEY (media_external_id, saga_id)
);
`;

// Mirrors reciprocal_relation() in media_catalog.rs — PrEditorModal already
// writes both sides of PREQUEL/SEQUEL and the REL_TYPE_TO_PAIR types by hand,
// so this is only a safety net for any bundle that (now or in the future)
// doesn't go through that exact save path.
const RECIPROCAL_RELATION = {
  SEQUEL: ['PREQUEL', 'Prequel'],
  PREQUEL: ['SEQUEL', 'Sequel'],
  SOURCE: ['ADAPTATION', 'Adaptation'],
  ADAPTATION: ['SOURCE', 'Source Material'],
  EPISODE: ['PART_OF', 'Part of'],
  UPDATE: ['PART_OF', 'Part of'],
};

const CATALOG_COLUMNS = [
  'id', 'external_id', 'parent_id', 'type', 'format', 'source',
  'title_main', 'title_romaji', 'title_native', 'synopsis', 'cover_url', 'banners_csv',
  'release_year', 'release_month', 'release_day', 'time_length', 'status', 'score_global',
  'favorites_count', 'ratings_count', 'total_count', 'total_count_2',
  'genres_csv', 'genres_tag_csv', 'platforms_csv', 'shop_links_csv', 'companies_cache_csv', 'authors_csv',
  'last_synced_at', 'sync_failed_count', 'last_sync_error', 'manually_edited_at', 'created_at', 'updated_at',
];

function readBundles() {
  if (!fs.existsSync(DATABASE_DIR)) {
    console.log(`No ${DATABASE_DIR} directory found — nothing to build.`);
    return [];
  }
  const files = fs.readdirSync(DATABASE_DIR).filter(f => f.endsWith('.json'));
  const bundles = [];
  for (const file of files) {
    try {
      const raw = fs.readFileSync(path.join(DATABASE_DIR, file), 'utf-8');
      const bundle = JSON.parse(raw);
      if (!bundle.media_catalog?.external_id) {
        console.warn(`Skipping ${file}: missing media_catalog.external_id`);
        continue;
      }
      bundles.push(bundle);
    } catch (e) {
      console.warn(`Skipping ${file}: ${e.message}`);
    }
  }
  return bundles;
}

function buildDatabase(bundles) {
  if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH);
  const db = new DatabaseSync(DB_PATH);
  db.exec(CREATE_TABLES_SQL);

  const now = new Date().toISOString();

  const catalogPlaceholders = CATALOG_COLUMNS.map(() => '?').join(', ');
  const catalogStmt = db.prepare(`INSERT OR REPLACE INTO media_catalog (${CATALOG_COLUMNS.join(', ')}) VALUES (${catalogPlaceholders})`);

  // name_native/aliases_csv/biography have no source in the bundle today —
  // ProposalBundle.characters is a Vec<SkeletonCharacter> (external_id, name,
  // image_url, relation_type, character_name only, see characters.rs), so
  // these three columns exist for schema parity with db.rs but are always
  // written NULL/'' until the collaborative editor starts submitting them.
  const characterStmt = db.prepare(
    'INSERT OR REPLACE INTO characters (id, external_id, name, name_native, aliases_csv, biography, image_url, reaction, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  );
  const appearanceStmt = db.prepare(
    'INSERT OR REPLACE INTO character_appearances (character_external_id, media_external_id, relation_type, character_name, added_at) VALUES (?, ?, ?, ?, ?)'
  );
  const relationStmt = db.prepare(
    'INSERT OR REPLACE INTO media_relations (media_external_id, related_media_external_id, relation_type, type_label) VALUES (?, ?, ?, ?)'
  );
  const reciprocalRelationStmt = db.prepare(
    'INSERT OR IGNORE INTO media_relations (media_external_id, related_media_external_id, relation_type, type_label) VALUES (?, ?, ?, ?)'
  );
  const authorStmt = db.prepare(
    'INSERT OR REPLACE INTO media_author (external_id, name, author_image_url, author_url, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
  );
  const byAuthorStmt = db.prepare(
    'INSERT OR REPLACE INTO media_by_author (media_external_id, author_external_id, role) VALUES (?, ?, ?)'
  );
  const sagaGroupStmt = db.prepare(
    'INSERT OR REPLACE INTO media_saga_groups (media_external_id, group_name) VALUES (?, ?)'
  );
  const sagaStmt = db.prepare(
    'INSERT OR REPLACE INTO sagas (id, name) VALUES (?, ?)'
  );
  const sagaRelationStmt = db.prepare(
    'INSERT OR REPLACE INTO saga_relations (media_external_id, saga_id) VALUES (?, ?)'
  );

  let catalogCount = 0;
  const sagaNameById = new Map();
  for (const bundle of bundles) {
    const entry = bundle.media_catalog;
    const externalId = entry.external_id;

    const row = CATALOG_COLUMNS.map(col => {
      if (col === 'id') return entry.id || crypto.randomUUID();
      if (col === 'created_at') return entry.created_at || now;
      if (col === 'updated_at') return entry.updated_at || now;
      const v = entry[col];
      return v === undefined ? null : v;
    });
    catalogStmt.run(...row);
    catalogCount++;

    const owners = new Set();
    for (const rel of bundle.media_relations || []) {
      if (!rel.related_media_external_id || !rel.relation_type) continue;
      // media_external_id is explicit per row (not assumed to be this file's
      // own entry) — a saga PR carries prequel/sequel edges for every entry
      // in the chain, not just the one this file's media_catalog describes.
      const owner = rel.media_external_id || externalId;
      owners.add(owner);
      relationStmt.run(owner, rel.related_media_external_id, rel.relation_type, rel.type_label || rel.relation_type);

      const reciprocal = RECIPROCAL_RELATION[rel.relation_type];
      if (reciprocal) {
        reciprocalRelationStmt.run(rel.related_media_external_id, owner, reciprocal[0], reciprocal[1]);
      }
    }

    for (const [mediaId, groupName] of Object.entries(bundle.saga_groups || {})) {
      if (mediaId && groupName) sagaGroupStmt.run(mediaId, groupName);
    }

    if (bundle.saga_name) {
      // NOT written to sagas/saga_relations here — see the post-loop pass
      // below for why. A "saga member" proposal file's own media_relations
      // only ever carries *that member's* outgoing edges (see
      // buildRelatedProposalBundle in pr-editor-submit.ts), so `owners` here
      // is really just {externalId} for those files — anchoring a
      // standalone single-member saga per file instead of joining the real,
      // multi-member one. Just remember the proposed name against every id
      // this file actually touches; the real chain gets reconstructed from
      // media_relations once every bundle has been inserted.
      const sagaOwners = owners.size > 0 ? [...owners] : [externalId];
      for (const owner of sagaOwners) {
        if (!sagaNameById.has(owner)) sagaNameById.set(owner, bundle.saga_name);
      }
    }

    for (const char of bundle.characters || []) {
      if (!char.external_id) continue;
      characterStmt.run(char.id || crypto.randomUUID(), char.external_id, char.name || '', null, '', null, char.image_url ?? null, null, now, now);
      appearanceStmt.run(char.external_id, externalId, char.relation_type ?? null, char.character_name ?? null, now);
    }

    for (const author of bundle.media_authors || []) {
      if (!author.external_id) continue;
      authorStmt.run(author.external_id, author.name || '', author.image ?? null, author.url ?? null, now, now);
      byAuthorStmt.run(externalId, author.external_id, author.role ?? null);
    }
  }

  buildSagasFromRelationGraph(db, sagaStmt, sagaRelationStmt, sagaNameById);

  db.close();
  return catalogCount;
}

// Rebuilds sagas/saga_relations from the real, always-reciprocal PREQUEL/
// SEQUEL/ALTERNATIVE graph in media_relations (now fully populated by the
// loop above) instead of the per-file "owners" set — connected components
// there are the actual sagas, regardless of which single file first
// mentioned a saga_name. Mirrors merge_fragmented_sagas in db.rs (the
// desktop app's own fallback for a database.db built before this fix).
function buildSagasFromRelationGraph(db, sagaStmt, sagaRelationStmt, sagaNameById) {
  const parent = new Map();
  const find = id => {
    let root = id;
    while (parent.has(root) && parent.get(root) !== root) root = parent.get(root);
    let cur = id;
    while (parent.has(cur) && parent.get(cur) !== root) {
      const next = parent.get(cur);
      parent.set(cur, root);
      cur = next;
    }
    return root;
  };
  const union = (a, b) => {
    if (!parent.has(a)) parent.set(a, a);
    if (!parent.has(b)) parent.set(b, b);
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };

  const edges = db.prepare(
    "SELECT media_external_id, related_media_external_id FROM media_relations WHERE relation_type IN ('PREQUEL', 'SEQUEL', 'ALTERNATIVE')"
  ).all();
  for (const { media_external_id, related_media_external_id } of edges) {
    union(media_external_id, related_media_external_id);
  }

  const components = new Map();
  for (const id of parent.keys()) {
    const root = find(id);
    if (!components.has(root)) components.set(root, []);
    components.get(root).push(id);
  }

  for (const members of components.values()) {
    if (members.length < 2) continue;
    // Same anchoring convention as save_cached_saga (TS/Rust): the
    // lexicographically-smallest member.
    const sagaId = members.slice().sort()[0];
    const name = members.map(id => sagaNameById.get(id)).find(Boolean) || '';
    sagaStmt.run(sagaId, name);
    for (const member of members) {
      sagaRelationStmt.run(member, sagaId);
    }
  }
}

const bundles = readBundles();
const count = buildDatabase(bundles);
console.log(`Built ${DB_PATH} with ${count} entries from ${bundles.length} source files.`);
