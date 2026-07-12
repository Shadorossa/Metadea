// Tipos de relación usados por la cadena de sagas (PrEditorModal).
// Centralizados aquí para que filtros y escritores nunca diverjan.

export const BUNDLE_RELATION_TYPES: string[] = ['EPISODE', 'UPDATE'];

export const SAGA_DIRECT_RELATION_TYPES: string[] = ['PREQUEL', 'SEQUEL'];

// Todos los relation_type que la saga-chain puede generar o leer.
// Más amplio que los tipos que hacen a una obra miembro de saga
// (el walker Rust solo recorre PREQUEL/SEQUEL) porque un miembro
// puede tener ALTERNATIVE/SOURCE/etc. adicionales — sin listarlos
// aquí, re-guardar los duplicaría en vez de reemplazarlos.
export const ALL_CHAIN_RELATION_TYPES: string[] = [
  'PREQUEL', 'SEQUEL', 'ALTERNATIVE', 'SOURCE', 'ADAPTATION', 'EPISODE', 'UPDATE', 'PART_OF',
];

// 'alternative' ya no es seleccionable: la agrupación la define
// compartir un Concept Group, no esta etiqueta.
export type SagaRelationType = 'main' | 'source' | 'episode' | 'update';

export const SAGA_RELATION_TYPE_OPTIONS: Array<{ value: SagaRelationType; label: string }> = [
  { value: 'main', label: 'Main' },
  { value: 'source', label: 'Source Material' },
  { value: 'episode', label: 'Episode' },
  { value: 'update', label: 'Update' },
];

// REL_ADAPTATION / REL_ALTERNATIVE llevan prefijo para no colisionar con
// los strings que el saga-chain escribe internamente (ADAPTATION/ALTERNATIVE).
// Reutilizarlos haría que una relación plain quedara dentro del saga walk.
export const EDITABLE_RELATION_OPTIONS: string[] = [
  'REL_ADAPTATION', 'SPIN_OFF', 'REL_ALTERNATIVE', 'PARENT', 'SIDE_STORY', 'SUMMARY', 'REMASTER', 'REMAKE', 'EXPANDED_GAME', 'REL_UPDATE',
  'DLC', 'EXPANSION', 'STANDALONE', 'FORK',
];

export function isSagaRelationType(value: string): value is SagaRelationType {
  return SAGA_RELATION_TYPE_OPTIONS.some(o => o.value === value);
}

// Relaciones de juegos guardadas con la etiqueta display antes de usar keys.
// Usado en mediaService (resync) y PrEditorModal (normaliza en render).
const LEGACY_RELATION_TYPE_LABELS: Record<string, string> = {
  'Remake': 'REMAKE', 'Remaster': 'REMASTER', 'DLC': 'DLC',
  'Expansion': 'EXPANSION', 'Standalone': 'STANDALONE',
  'Expanded Edition': 'EXPANDED_GAME', 'Fork': 'FORK',
};

export function normalizeLegacyRelationType(relationType: string): string {
  return LEGACY_RELATION_TYPE_LABELS[relationType] ?? relationType;
}
