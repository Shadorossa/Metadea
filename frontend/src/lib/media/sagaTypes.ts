// Central registry of the relation_type strings the collaborative-catalog
// editor (PrEditorModal) reads and writes for saga chains — kept in one
// place so a filter list can't quietly drift out of sync with the list used
// to generate those same relations (that mismatch used to let stray
// ADAPTATION/PART_OF rows leak into "untouched" pass-through relations
// instead of being recognized as saga-managed, duplicating them on re-save).

export const BUNDLE_RELATION_TYPES: string[] = ['EPISODE', 'UPDATE'];

export const SAGA_DIRECT_RELATION_TYPES: string[] = ['PREQUEL', 'SEQUEL'];

/** Every relation_type the saga-chain feature can generate or read back. */
export const ALL_CHAIN_RELATION_TYPES: string[] = [
  'PREQUEL', 'SEQUEL', 'ALTERNATIVE', 'SOURCE', 'ADAPTATION', 'EPISODE', 'UPDATE', 'PART_OF',
];

export type SagaRelationType = 'main' | 'alternative' | 'source' | 'episode' | 'update';

export const SAGA_RELATION_TYPE_OPTIONS: Array<{ value: SagaRelationType; label: string }> = [
  { value: 'main', label: 'Main' },
  { value: 'alternative', label: 'Alternative' },
  { value: 'source', label: 'Source Material' },
  { value: 'episode', label: 'Episode' },
  { value: 'update', label: 'Update' },
];

/** Relation types offered when attaching a *new* relation in the PR editor.
 *  'ADAPTATION' and 'ALTERNATIVE' are deliberately namespaced as
 *  'REL_ADAPTATION' / 'REL_ALTERNATIVE' — the plain names are also the
 *  relation_type strings the saga-chain feature writes for its own
 *  source/adaptation pair and same-group alternates, and the backend's
 *  transitive-chain walk (get_transitive_relation_ids) matches on those
 *  exact strings. Reusing them here would make a plain "this is an
 *  adaptation of X" relation silently get swept into the Saga chain the
 *  next time the editor reloads. The other options don't collide, so they
 *  keep their plain names. Pre-existing relations of any other type are
 *  still shown and stay editable; this list only curates what's offered for
 *  new additions. */
export const EDITABLE_RELATION_OPTIONS: string[] = [
  'REL_ADAPTATION', 'SPIN_OFF', 'REL_ALTERNATIVE', 'PARENT', 'SIDE_STORY', 'SUMMARY', 'REMASTER',
];

export function isSagaRelationType(value: string): value is SagaRelationType {
  return SAGA_RELATION_TYPE_OPTIONS.some(o => o.value === value);
}
