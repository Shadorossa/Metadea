import type { CharacterEntry } from '../tauri/characters';
import type { ParsedCharacteristic } from './biography-parser';

// Pure diff/change-tracking helpers extracted out of CharacterPrEditorModal
// — no JSX, no component state, just "does the edited value differ from
// the original" so they're independently readable/testable instead of
// living as closures over ~10 pieces of component state.

export interface AppearanceRow {
  media_external_id: string;
  relation_type: string | null;
  title: string;
  cover: string | null;
}

export const appearanceKey = (a: { media_external_id: string; relation_type: string | null }) =>
  `${a.media_external_id}::${a.relation_type ?? ''}`;

export const isFieldChanged = (current: string, original: string | null | undefined) =>
  current !== (original || '');

export const characteristicsChanged = (
  characteristics: ParsedCharacteristic[],
  originalCharacteristics: ParsedCharacteristic[],
) => JSON.stringify(characteristics) !== JSON.stringify(originalCharacteristics);

export const appearancesChanged = (appearances: AppearanceRow[], originalAppearances: AppearanceRow[]) => {
  const a = new Set(appearances.map(appearanceKey));
  const b = new Set(originalAppearances.map(appearanceKey));
  if (a.size !== b.size) return true;
  for (const k of a) if (!b.has(k)) return true;
  return false;
};

export interface CharacterDiffFields {
  name: string;
  nameNative: string;
  aliases: string[];
  imageUrl: string;
  cleanBiography: string;
  originalCleanBiography: string;
  characteristics: ParsedCharacteristic[];
  originalCharacteristics: ParsedCharacteristic[];
  appearances: AppearanceRow[];
  originalAppearances: AppearanceRow[];
}

export const hasChanged = (originalCharacter: CharacterEntry | null, f: CharacterDiffFields): boolean => {
  if (!originalCharacter) return false;
  return (
    isFieldChanged(f.name, originalCharacter.name) ||
    isFieldChanged(f.nameNative, originalCharacter.name_native) ||
    f.aliases.join(',') !== (originalCharacter.aliases_csv || '') ||
    isFieldChanged(f.imageUrl, originalCharacter.image_url) ||
    isFieldChanged(f.cleanBiography, f.originalCleanBiography) ||
    characteristicsChanged(f.characteristics, f.originalCharacteristics) ||
    appearancesChanged(f.appearances, f.originalAppearances)
  );
};

export const buildChangeSummary = (originalCharacter: CharacterEntry | null, f: CharacterDiffFields): string => {
  const changes: string[] = [];
  if (originalCharacter) {
    if (isFieldChanged(f.name, originalCharacter.name)) changes.push(`Nombre: ${f.name}`);
    if (isFieldChanged(f.nameNative, originalCharacter.name_native)) changes.push(`Nombre nativo: ${f.nameNative || '(vacío)'}`);
    if (f.aliases.join(',') !== (originalCharacter.aliases_csv || '')) changes.push(`Aliases: ${f.aliases.length ? f.aliases.join(', ') : '(vacío)'}`);
    if (isFieldChanged(f.imageUrl, originalCharacter.image_url)) changes.push(`Imagen: ${f.imageUrl || '(vacío)'}`);
    if (isFieldChanged(f.cleanBiography, f.originalCleanBiography)) changes.push('Biografía: Actualizada');
    if (characteristicsChanged(f.characteristics, f.originalCharacteristics)) changes.push(`Características: ${f.characteristics.length} campo(s)`);
    if (appearancesChanged(f.appearances, f.originalAppearances)) changes.push(`Apariciones: ${f.appearances.length} obra(s)`);
  }
  return changes.length > 0 ? changes.join('\n- ') : 'Sin cambios detectados';
};
