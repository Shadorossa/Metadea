// Tipos de relación usados por la cadena de sagas (PrEditorModal).
// Centralizados aquí para que filtros y escritores nunca diverjan.

// New bundled-in relations are always saved as PART_OF now (PrEditorModal no
// longer distinguishes episode/update) — EPISODE/UPDATE stay in this filter
// so relations saved before that change still load into the Bundled In list.
export const BUNDLE_RELATION_TYPES: string[] = ['EPISODE', 'UPDATE', 'PART_OF'];

// Split of BUNDLE_RELATION_TYPES by direction — "this entry belongs to
// something else" (Bundled In, PART_OF — UPDATE kept for pre-existing rows
// saved under the old episode/update picker) vs. "something else belongs to
// this entry" (Contains, EPISODE). Both used to load into the same "Bundled
// In" bucket regardless of direction, which made a container's own editor
// show its contents as if *it* were bundled into them.
export const PART_OF_RELATION_TYPES: string[] = ['PART_OF', 'UPDATE'];
export const CONTAINS_RELATION_TYPES: string[] = ['EPISODE'];

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

const SAGA_RELATION_TYPE_OPTIONS: Array<{ value: SagaRelationType; label: string }> = [
  { value: 'main', label: 'Main' },
  { value: 'source', label: 'Source Material' },
  { value: 'episode', label: 'Episode' },
  { value: 'update', label: 'Update' },
];

// REL_SOURCE / REL_ADAPTATION / REL_ALTERNATIVE llevan prefijo para no
// colisionar con los strings que el saga-chain escribe internamente
// (SOURCE/ADAPTATION/ALTERNATIVE). Reutilizarlos haría que una relación
// plain quedara dentro del saga walk.
export const EDITABLE_RELATION_OPTIONS: string[] = [
  'REL_ADAPTATION', 'REL_SOURCE', 'SPIN_OFF', 'REL_ALTERNATIVE', 'PARENT', 'BASE_EDITION', 'SIDE_STORY', 'SUMMARY', 'REMASTER', 'REMAKE', 'EXPANDED_GAME', 'REL_UPDATE',
  'DLC', 'EXPANSION', 'STANDALONE', 'FORK', 'SEASON',
];

export interface RelationOptionGroup {
  /** Canonical label of the reciprocal type this group's options all share
   *  (e.g. picking any option under "Source Material" makes the OTHER work
   *  show that label pointing back here) — empty for the trailing ungrouped
   *  bucket, whose options have no defined reciprocal at all. */
  header: string;
  options: string[];
}

// Buckets `options` by RELATION_TYPE_RECIPROCAL so PrEditorModal's Relations
// dropdown can show, as each group's own title, what the OTHER work will
// display once you pick something from it — rather than a flat list where
// that connection isn't visible at all. Options with no reciprocal defined
// (BASE_EDITION, CHARACTER, ...) land in one trailing ungrouped bucket
// instead of being silently dropped.
export function groupRelationOptions(
  options: string[],
  reciprocalMap: Record<string, string>,
  labels: Record<string, string>,
): RelationOptionGroup[] {
  const byReciprocal = new Map<string, string[]>();
  const ungrouped: string[] = [];

  for (const opt of options) {
    const reciprocal = reciprocalMap[opt];
    if (!reciprocal) {
      ungrouped.push(opt);
      continue;
    }
    const bucket = byReciprocal.get(reciprocal);
    if (bucket) bucket.push(opt);
    else byReciprocal.set(reciprocal, [opt]);
  }

  const groups: RelationOptionGroup[] = [...byReciprocal.entries()].map(([reciprocal, opts]) => ({
    header: labels[reciprocal] || reciprocal,
    options: opts,
  }));
  if (ungrouped.length > 0) groups.push({ header: '', options: ungrouped });
  return groups;
}

export function isSagaRelationType(value: string): value is SagaRelationType {
  return SAGA_RELATION_TYPE_OPTIONS.some(o => o.value === value);
}

// Relaciones de juegos guardadas con la etiqueta display antes de usar keys —
// incluye tanto las variantes en inglés (canónicas) como en español, ya que
// hubo un periodo en que type_label se guardaba en el idioma activo de la UI
// en vez de en la clave canónica (ver el fix de persistencia en
// igdb-mapper.ts/anilist-mapper.ts/etc.) — filas de esa época pueden llevar
// cualquiera de las dos. Usado en mediaService (resync) y PrEditorModal
// (normaliza en render).
const LEGACY_RELATION_TYPE_LABELS: Record<string, string> = {
  'Remake': 'REMAKE', 'Remaster': 'REMASTER', 'DLC': 'DLC',
  'Expansion': 'EXPANSION', 'Standalone': 'STANDALONE',
  'Expanded Edition': 'EXPANDED_GAME', 'Fork': 'FORK',
  // Variantes en español que difieren del literal inglés.
  'Expansión': 'EXPANSION',
  'Expansión de contenido': 'EXPANSION',
  'Expansión autónoma': 'STANDALONE',
  'Edición expandida': 'EXPANDED_GAME',
};

export function normalizeLegacyRelationType(relationType: string): string {
  return LEGACY_RELATION_TYPE_LABELS[relationType] ?? relationType;
}
