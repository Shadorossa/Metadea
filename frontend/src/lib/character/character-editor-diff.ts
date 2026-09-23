import type { ParsedCharacteristic } from './biography-parser';
import type { CharacterMerge } from '../tauri/characters';
import type { CharacterDraft } from './character-editor-state';

// Pure diff/change-tracking helpers extracted out of CharacterPrEditorModal
// — no JSX, no component state, just "does the edited draft differ from
// the loaded baseline" so they're independently readable/testable instead of
// living as closures over ~10 pieces of component state.

export interface AppearanceRow {
  media_external_id: string;
  relation_type: string | null;
  title: string;
  cover: string | null;
  release_year?: number | null;
  release_month?: number | null;
  release_day?: number | null;
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

export const voiceActorsChanged = (voiceActors: VoiceActorRow[], originalVoiceActors: VoiceActorRow[]) =>
  JSON.stringify(voiceActors) !== JSON.stringify(originalVoiceActors);

export const aliasesChanged = (aliases: string[], originalAliases: string[]) =>
  JSON.stringify(aliases) !== JSON.stringify(originalAliases);

export const sortedMergedCharacterIds = (list: CharacterMerge[]) =>
  list.map(item => item.external_id).sort();

export const mergedCharactersChanged = (baseline: CharacterDraft, draft: CharacterDraft) =>
  JSON.stringify(sortedMergedCharacterIds(draft.mergedCharacters)) !== JSON.stringify(sortedMergedCharacterIds(baseline.mergedCharacters));

// Field-only diff — deliberately excludes the merge list (see
// mergedCharactersChanged / character-editor-state's hasChanges), since a
// merges-only proposal carries its own fixed change summary.
export const hasChanged = (baseline: CharacterDraft, draft: CharacterDraft): boolean => {
  return (
    isFieldChanged(draft.name, baseline.name) ||
    isFieldChanged(draft.nameNative, baseline.nameNative) ||
    aliasesChanged(draft.aliases, baseline.aliases) ||
    isFieldChanged(draft.imageUrl, baseline.imageUrl) ||
    isFieldChanged(draft.cleanBiography, baseline.cleanBiography) ||
    characteristicsChanged(draft.characteristics, baseline.characteristics) ||
    appearancesChanged(draft.appearances, baseline.appearances) ||
    voiceActorsChanged(draft.voiceActors, baseline.voiceActors)
  );
};

export const buildChangeSummary = (baseline: CharacterDraft, f: CharacterDraft): string => {
  const changes: string[] = [];
  if (isFieldChanged(f.name, baseline.name)) changes.push(`Nombre: ${f.name}`);
  if (isFieldChanged(f.nameNative, baseline.nameNative)) changes.push(`Nombre nativo: ${f.nameNative || '(vacío)'}`);
  if (aliasesChanged(f.aliases, baseline.aliases)) changes.push(`Aliases: ${f.aliases.length ? f.aliases.join(', ') : '(vacío)'}`);
  if (isFieldChanged(f.imageUrl, baseline.imageUrl)) {
    const displayImg = f.imageUrl?.startsWith('data:')
      ? '(imagen en base64 actualizada)'
      : (f.imageUrl && f.imageUrl.length > 100 ? `${f.imageUrl.slice(0, 100)}...` : (f.imageUrl || '(vacío)'));
    changes.push(`Imagen: ${displayImg}`);
  }
  if (isFieldChanged(f.cleanBiography, baseline.cleanBiography)) changes.push('Biografía: Actualizada');
  if (characteristicsChanged(f.characteristics, baseline.characteristics)) changes.push(`Características: ${f.characteristics.length} campo(s)`);
  if (appearancesChanged(f.appearances, baseline.appearances)) changes.push(`Apariciones: ${f.appearances.length} obra(s)`);
  if (voiceActorsChanged(f.voiceActors, baseline.voiceActors)) changes.push(`Actores de voz: ${f.voiceActors.length} actor(es)`);
  return changes.length > 0 ? changes.join('\n- ') : 'Sin cambios detectados';
};

// The proposal's human-readable summary: a merges-only change gets the
// caller's fixed label, anything else the per-field list.
export const buildProposalChangeSummary = (baseline: CharacterDraft, draft: CharacterDraft, mergeOnlySummary: string): string =>
  mergedCharactersChanged(baseline, draft) && !hasChanged(baseline, draft)
    ? mergeOnlySummary
    : buildChangeSummary(baseline, draft);
