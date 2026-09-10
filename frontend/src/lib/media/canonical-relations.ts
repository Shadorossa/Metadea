// Fixed English vocabulary persisted to media_relations.type_label,
// independent of the UI's active locale — not derived from i18n/en.ts so it
// doesn't depend on any one locale file existing. Display-time translation
// happens separately (see media-relations.ts's sortRelationsForDisplay).
export const CANONICAL_RELATION_LABELS: Record<string, string> = {
  SEQUEL: 'Sequel', PREQUEL: 'Prequel', SIDE_STORY: 'Side story',
  // PARENT: AniList's own real relation type — the main story a side
  // story/movie/OVA is attached to (e.g. Gintama: Kanketsu-hen -> PARENT ->
  // Gintama), the inverse of SIDE_STORY. Distinct from BASE_EDITION (the
  // base game/comic volume an edition or issue belongs to — igdb-mapper.ts/
  // comicvine-mapper.ts), which used to reuse this same 'PARENT' key/label
  // for a completely unrelated games/comics-only concept, reading as a
  // near-duplicate of 'Source Material' right next to it in the editor's
  // dropdown for anime/manga.
  ALTERNATIVE: 'Alternative', ADAPTATION: 'Adaptation', PARENT: 'Parent Story',
  BASE_EDITION: 'Base Edition', SOURCE: 'Source Material',
  SUMMARY: 'Summary', SPIN_OFF: 'Spin-off', OTHER: 'Other',
  CHARACTER: 'Character', CONTAINS: 'Contains', RECOMMENDATION: 'Recommended',
  EDITIONS: 'Editions',
  ISSUE: 'Issue',
  EPISODE: 'Episode',
  REL_ADAPTATION: 'Adaptation',
  // Same concept/label as SOURCE — the generic editor's own prefixed
  // spelling (see RELATION_TYPE_RECIPROCAL below), directly selectable so a
  // curator sitting on the DERIVATIVE work's own page (the adaptation/
  // summary/fork) can mark a related title as "my original" directly,
  // instead of having to go edit that OTHER (original) title's page and
  // pick REL_ADAPTATION/SUMMARY/FORK there just to get this direction set.
  REL_SOURCE: 'Source Material',
  REL_ALTERNATIVE: 'Alternative Version',
  REMASTER: 'Remaster',
  REMAKE: 'Remake',
  EXPANDED_GAME: 'Expanded Edition',
  REL_UPDATE: 'Update',
  DLC: 'DLC',
  EXPANSION: 'Content Expansion',
  STANDALONE: 'Standalone Expansion',
  FORK: 'Fork',
  SEASON: 'Season',
  PART_OF: 'Part of',
};

// Mirrors the backend's reciprocal_relation() (media_catalog.rs) exactly —
// used to group PrEditorModal's Relations dropdown by "what label the OTHER
// work ends up showing", not to write anything itself (the actual write
// happens server-side in save_media_relations). Keep these two in sync by
// hand; there's no way to share code across the Rust/TS boundary here.
// Types with no reciprocal (CHARACTER/EDITIONS/ISSUE/RECOMMENDATION/
// BASE_EDITION — see media_catalog.rs's own comment on why BASE_EDITION has
// none) are simply absent, and render ungrouped.
export const RELATION_TYPE_RECIPROCAL: Record<string, string> = {
  SEQUEL: 'PREQUEL', PREQUEL: 'SEQUEL',
  SOURCE: 'ADAPTATION', ADAPTATION: 'SOURCE',
  EPISODE: 'PART_OF', UPDATE: 'PART_OF',
  REL_SOURCE: 'REL_ADAPTATION', REL_ADAPTATION: 'REL_SOURCE',
  SUMMARY: 'REL_SOURCE', FORK: 'REL_SOURCE',
  SIDE_STORY: 'PARENT', PARENT: 'SIDE_STORY',
  SPIN_OFF: 'SPIN_OFF', REL_ALTERNATIVE: 'REL_ALTERNATIVE',
  // Episodic content released INTO the base work (Update/Season) reuses the
  // Bundled In/Contains pair (PART_OF) instead of BASE_EDITION — it isn't a
  // separate purchasable product the way a remaster/DLC/expansion is.
  REL_UPDATE: 'PART_OF', SEASON: 'PART_OF',
  REMASTER: 'BASE_EDITION', REMAKE: 'BASE_EDITION', EXPANDED_GAME: 'BASE_EDITION',
  DLC: 'BASE_EDITION', EXPANSION: 'BASE_EDITION', STANDALONE: 'BASE_EDITION',
};
