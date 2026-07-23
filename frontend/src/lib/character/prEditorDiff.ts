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

const appearanceKey = (a: { media_external_id: string; relation_type: string | null }) =>
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

export interface VoiceActorRow {
  /** e.g. "person:a12345" (AniList Staff) — undefined for a not-yet-persisted
   *  legacy row created before the search picker existed. */
  externalId?: string;
  name: string;
  native: string;
  language: string;
  image: string;
  role?: string;
}

export interface CharacterDiffFields {
  name: string;
  originalName: string;
  nameNative: string;
  originalNameNative: string;
  aliases: string[];
  originalAliases: string[];
  imageUrl: string;
  originalImageUrl: string;
  cleanBiography: string;
  originalCleanBiography: string;
  characteristics: ParsedCharacteristic[];
  originalCharacteristics: ParsedCharacteristic[];
  appearances: AppearanceRow[];
  originalAppearances: AppearanceRow[];
  voiceActors: VoiceActorRow[];
  originalVoiceActors: VoiceActorRow[];
}

export const voiceActorsChanged = (voiceActors: VoiceActorRow[], originalVoiceActors: VoiceActorRow[]) =>
  JSON.stringify(voiceActors) !== JSON.stringify(originalVoiceActors);

export const aliasesChanged = (aliases: string[], originalAliases: string[]) =>
  JSON.stringify(aliases) !== JSON.stringify(originalAliases);

export const hasChanged = (originalCharacter: CharacterEntry | null, f: CharacterDiffFields): boolean => {
  return (
    isFieldChanged(f.name, f.originalName) ||
    isFieldChanged(f.nameNative, f.originalNameNative) ||
    aliasesChanged(f.aliases, f.originalAliases) ||
    isFieldChanged(f.imageUrl, f.originalImageUrl) ||
    isFieldChanged(f.cleanBiography, f.originalCleanBiography) ||
    characteristicsChanged(f.characteristics, f.originalCharacteristics) ||
    appearancesChanged(f.appearances, f.originalAppearances) ||
    voiceActorsChanged(f.voiceActors, f.originalVoiceActors)
  );
};

export const buildChangeSummary = (originalCharacter: CharacterEntry | null, f: CharacterDiffFields): string => {
  const changes: string[] = [];
  if (isFieldChanged(f.name, f.originalName)) changes.push(`Nombre: ${f.name}`);
  if (isFieldChanged(f.nameNative, f.originalNameNative)) changes.push(`Nombre nativo: ${f.nameNative || '(vacío)'}`);
  if (aliasesChanged(f.aliases, f.originalAliases)) changes.push(`Aliases: ${f.aliases.length ? f.aliases.join(', ') : '(vacío)'}`);
  if (isFieldChanged(f.imageUrl, f.originalImageUrl)) changes.push(`Imagen: ${f.imageUrl || '(vacío)'}`);
  if (isFieldChanged(f.cleanBiography, f.originalCleanBiography)) changes.push('Biografía: Actualizada');
  if (characteristicsChanged(f.characteristics, f.originalCharacteristics)) changes.push(`Características: ${f.characteristics.length} campo(s)`);
  if (appearancesChanged(f.appearances, f.originalAppearances)) changes.push(`Apariciones: ${f.appearances.length} obra(s)`);
  if (voiceActorsChanged(f.voiceActors, f.originalVoiceActors)) changes.push(`Actores de voz: ${f.voiceActors.length} actor(es)`);
  return changes.length > 0 ? changes.join('\n- ') : 'Sin cambios detectados';
};
