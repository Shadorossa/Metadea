// Fixed English vocabulary persisted to media_relations.type_label,
// independent of the UI's active locale — not derived from i18n/en.ts so it
// doesn't depend on any one locale file existing. Display-time translation
// happens separately (see media-relations.ts's sortRelationsForDisplay).
export const CANONICAL_RELATION_LABELS: Record<string, string> = {
  SEQUEL: 'Sequel', PREQUEL: 'Prequel', SIDE_STORY: 'Side story',
  ALTERNATIVE: 'Alternative', ADAPTATION: 'Adaptation', PARENT: 'Source',
  SUMMARY: 'Summary', SPIN_OFF: 'Spin-off', OTHER: 'Other',
  CHARACTER: 'Character', CONTAINS: 'Contains', RECOMMENDATION: 'Recommended',
  EDITIONS: 'Editions',
  ISSUE: 'Issue',
  EPISODE: 'Episode',
  REL_ADAPTATION: 'Adaptation',
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
