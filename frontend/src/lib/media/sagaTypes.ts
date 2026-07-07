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

export function isSagaRelationType(value: string): value is SagaRelationType {
  return SAGA_RELATION_TYPE_OPTIONS.some(o => o.value === value);
}
