#!/usr/bin/env node
// Rebuilds database.db (repo root) from every catalog/<Folder>/*.json a merged
// collaborative-catalog PR (see PrEditorModal.tsx's handleSubmit and
// CharacterPrEditorModal.tsx's handleSubmit) has added. Run by
// .github/workflows/update-database.yml on every push to main that touches
// catalog/**; the desktop app downloads the resulting file (see
// community_sync.rs's sync_community_catalog) and merges rows it doesn't
// already have locally into its own tables.
//
// catalog/ has one subfolder per media type (Anime, Games, Movies, ...) plus
// a standalone Characters/ folder — mirrors frontend/src/lib/github/
// catalogPaths.ts, kept in sync by hand. Which bucket a file belongs to is
// sniffed from its own shape rather than its folder, so this script doesn't
// need to hardcode the folder names:
//
// A *media* bundle:
//   { media_catalog: {...}, media_relations: [...], characters: [...],
//     media_authors: [...], saga_name: "..." }
// (older files may still carry a now-ignored saga_groups field — "alternate
// version" clustering is derived live from ALTERNATIVE relation edges
// instead of being persisted, see pr-editor-load.ts)
// media_relations already includes both "Bundled In" (EPISODE/UPDATE) and
// saga-derived PREQUEL/SEQUEL entries — PrEditorModal resolves those before
// writing the file, so this script only has to fan them out into tables.
//
// A *character* bundle (no owning media_catalog row of its own):
//   { character: { external_id, name, name_native, aliases_csv, biography,
//     image_url }, appearances: [{ media_external_id, relation_type }],
//     actors: [{ external_id, name, name_native, image_url, role, language }] }
// Every field but external_id (character) / external_id (actor) is optional
// and only present when this proposal actually changed it — see
// CharacterPrEditorModal's handleSubmit — so a bundle is merged onto
// whatever's already known for that id/actor rather than replacing it wholesale.
//
// node:sqlite is experimental — run with `node --experimental-sqlite`.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');

const REPO_ROOT = path.join(__dirname, '..');
const CATALOG_DIR = path.join(REPO_ROOT, 'catalog');
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

-- Shared between voice actors (role='voice', AniList Staff) and live-action
-- actors (role='actor', e.g. TMDB) — mirrors db.rs's actors/character_actors.
CREATE TABLE actors (
    id          TEXT PRIMARY KEY,
    external_id TEXT UNIQUE NOT NULL,
    name        TEXT NOT NULL DEFAULT '',
    name_native TEXT,
    image_url   TEXT,
    created_at  TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at  TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE character_actors (
    actor_external_id     TEXT NOT NULL,
    character_external_id TEXT NOT NULL,
    role                  TEXT,
    language              TEXT,
    added_at              TEXT DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (actor_external_id, character_external_id)
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

CREATE TABLE sagas (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL DEFAULT '',
    description TEXT,
    created_at  TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at  TEXT DEFAULT CURRENT_TIMESTAMP
);

-- order_index mirrors db.rs's saga_relations — always NULL here since this
-- script has no manual-order data of its own (only the desktop app's editor
-- writes it), but the column needs to exist so a client ATTACHing this file
-- can query it without a schema-mismatch error.
CREATE TABLE saga_relations (
    media_external_id TEXT NOT NULL,
    saga_id           TEXT NOT NULL,
    order_index       REAL,
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
  'genres_csv', 'genres_tag_csv', 'platforms_csv', 'shop_links_csv', 'authors_csv',
  'last_synced_at', 'sync_failed_count', 'last_sync_error', 'manually_edited_at', 'created_at', 'updated_at',
];

// One level of recursion is all catalog/ ever has (catalog/<Folder>/*.json),
// but walking generically means this script never needs its own copy of the
// folder-name list.
function walkJsonFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) out.push(...walkJsonFiles(full));
    else if (name.endsWith('.json')) out.push(full);
  }
  return out;
}

function readBundles() {
  if (!fs.existsSync(CATALOG_DIR)) {
    console.log(`No ${CATALOG_DIR} directory found — nothing to build.`);
    return { mediaBundles: [], characterBundles: [] };
  }
  const files = walkJsonFiles(CATALOG_DIR);
  const mediaBundles = [];
  const characterBundles = [];
  for (const file of files) {
    try {
      const raw = fs.readFileSync(file, 'utf-8');
      const bundle = JSON.parse(raw);
      if (bundle.character?.external_id) {
        characterBundles.push(bundle);
      } else if (bundle.media_catalog?.external_id) {
        mediaBundles.push(bundle);
      } else {
        console.warn(`Skipping ${file}: not a recognized media or character bundle`);
      }
    } catch (e) {
      console.warn(`Skipping ${file}: ${e.message}`);
    }
  }
  return { mediaBundles, characterBundles };
}

function buildDatabase({ mediaBundles, characterBundles }) {
  if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH);
  const db = new DatabaseSync(DB_PATH);
  db.exec(CREATE_TABLES_SQL);

  const now = new Date().toISOString();

  const catalogPlaceholders = CATALOG_COLUMNS.map(() => '?').join(', ');
  const catalogStmt = db.prepare(`INSERT OR REPLACE INTO media_catalog (${CATALOG_COLUMNS.join(', ')}) VALUES (${catalogPlaceholders})`);

  // A media bundle's own embedded characters[] (SkeletonCharacter, see
  // characters.rs) only ever carries external_id/name/image_url/relation_type/
  // character_name — name_native/aliases_csv/biography come from a standalone
  // character bundle instead (CharacterPrEditorModal.tsx), written NULL/'' here
  // when this row comes from the media-embedded list.
  const characterStmt = db.prepare(
    'INSERT OR REPLACE INTO characters (id, external_id, name, name_native, aliases_csv, biography, image_url, reaction, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  );
  const appearanceStmt = db.prepare(
    'INSERT OR REPLACE INTO character_appearances (character_external_id, media_external_id, relation_type, character_name, added_at) VALUES (?, ?, ?, ?, ?)'
  );
  const actorStmt = db.prepare(
    'INSERT OR REPLACE INTO actors (id, external_id, name, name_native, image_url, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  );
  const characterActorStmt = db.prepare(
    'INSERT OR REPLACE INTO character_actors (actor_external_id, character_external_id, role, language, added_at) VALUES (?, ?, ?, ?, ?)'
  );
  const selectCharacterStmt = db.prepare('SELECT * FROM characters WHERE external_id = ?');
  const selectActorStmt = db.prepare('SELECT * FROM actors WHERE external_id = ?');
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
  const sagaStmt = db.prepare(
    'INSERT OR REPLACE INTO sagas (id, name) VALUES (?, ?)'
  );
  const sagaRelationStmt = db.prepare(
    'INSERT OR REPLACE INTO saga_relations (media_external_id, saga_id) VALUES (?, ?)'
  );

  let catalogCount = 0;
  const sagaNameById = new Map();
  for (const bundle of mediaBundles) {
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

  // Standalone character bundles processed last so a dedicated character
  // proposal's own fields/appearances win over whatever a media bundle's
  // embedded skeleton (processed above) guessed for the same character.
  // A character bundle only carries the fields its own proposal actually
  // changed (see CharacterPrEditorModal's handleSubmit) — e.g. a "just added
  // a voice actor" proposal has no name/biography/image_url at all. Fall
  // back to whatever's already in the table (built from an earlier bundle,
  // media-embedded or standalone) instead of blanking it out; only a field
  // truly present in this bundle overrides it.
  let characterCount = 0;
  for (const bundle of characterBundles) {
    const char = bundle.character;
    const existing = selectCharacterStmt.get(char.external_id);
    characterStmt.run(
      existing?.id || crypto.randomUUID(),
      char.external_id,
      char.name !== undefined ? char.name : (existing?.name ?? ''),
      char.name_native !== undefined ? char.name_native : (existing?.name_native ?? null),
      char.aliases_csv !== undefined ? char.aliases_csv : (existing?.aliases_csv ?? ''),
      char.biography !== undefined ? char.biography : (existing?.biography ?? null),
      char.image_url !== undefined ? char.image_url : (existing?.image_url ?? null),
      existing?.reaction ?? null,
      existing?.created_at || now,
      now,
    );
    characterCount++;
    for (const app of bundle.appearances || []) {
      if (!app.media_external_id) continue;
      appearanceStmt.run(char.external_id, app.media_external_id, app.relation_type ?? null, null, now);
    }
    // name/name_native/image_url are commonly omitted (an AniList-sourced
    // actor's own data, not this proposal's — see CharacterProposalActor) —
    // same "don't blank out what's already known" fallback as the character
    // row above.
    for (const actor of bundle.actors || []) {
      if (!actor.external_id) continue;
      const existingActor = selectActorStmt.get(actor.external_id);
      actorStmt.run(
        existingActor?.id || crypto.randomUUID(),
        actor.external_id,
        actor.name !== undefined ? actor.name : (existingActor?.name ?? ''),
        actor.name_native !== undefined ? actor.name_native : (existingActor?.name_native ?? null),
        actor.image_url !== undefined ? actor.image_url : (existingActor?.image_url ?? null),
        existingActor?.created_at || now,
        now,
      );
      characterActorStmt.run(actor.external_id, char.external_id, actor.role ?? null, actor.language ?? null, now);
    }
  }

  db.close();
  return { catalogCount, characterCount };
}

// Rebuilds sagas/saga_relations from the real, always-reciprocal PREQUEL/
// SEQUEL graph in media_relations (now fully populated by the loop above)
// instead of the per-file "owners" set — connected components there are the
// actual sagas, regardless of which single file first mentioned a saga_name.
// Mirrors merge_fragmented_sagas in db.rs (the desktop app's own fallback for
// a database.db built before this fix). ALTERNATIVE is deliberately excluded
// — it links alternate versions/adaptations, not numbered story
// continuations, and including it merged unrelated entries into one saga.
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
    "SELECT media_external_id, related_media_external_id FROM media_relations WHERE relation_type IN ('PREQUEL', 'SEQUEL')"
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

const { mediaBundles, characterBundles } = readBundles();
const { catalogCount, characterCount } = buildDatabase({ mediaBundles, characterBundles });
console.log(
  `Built ${DB_PATH} with ${catalogCount} catalog entries from ${mediaBundles.length} media files ` +
  `and ${characterCount} characters from ${characterBundles.length} character files.`
);
