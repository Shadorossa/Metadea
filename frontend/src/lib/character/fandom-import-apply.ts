// Merges a Fandom import into the editor draft: chosen scalar fields
// overwrite, list fields union with what's already there (aliases by value,
// characteristics/voice actors by case-insensitive label/name). Pure — the
// modal dispatches the returned patch in one edit.
import type { CharacterDraft } from './character-editor-state';
import type { FandomCharacterData } from './fandom-importer';
import type { VoiceActorRow } from './character-editor-diff';

export interface SelectedImportFields {
  name: boolean;
  nativeName: boolean;
  image: boolean;
  aliases: boolean;
  characteristics: boolean;
  biography: boolean;
  voiceActors: boolean;
}

export function applyFandomImport(draft: CharacterDraft, data: FandomCharacterData, fields: SelectedImportFields): Partial<CharacterDraft> {
  const patch: Partial<CharacterDraft> = {};
  if (fields.name && data.name) {
    patch.name = data.name;
  }
  if (fields.nativeName && data.nativeName) {
    patch.nameNative = data.nativeName;
  }
  if (fields.image && data.imageUrl) {
    patch.imageUrl = data.imageUrl;
  }
  if (fields.aliases && data.aliases.length > 0) {
    patch.aliases = Array.from(new Set([...draft.aliases, ...data.aliases]));
  }
  if (fields.characteristics && data.characteristics.length > 0) {
    const prev = draft.characteristics;
    if (prev.length === 0) patch.characteristics = data.characteristics;
    else {
      const existingLabels = new Set(prev.map(c => c.label.toLowerCase().trim()));
      const toAdd = data.characteristics.filter(c => !existingLabels.has(c.label.toLowerCase().trim()));
      patch.characteristics = [...prev, ...toAdd];
    }
  }
  if (fields.biography && data.cleanBiography) {
    patch.cleanBiography = data.cleanBiography;
  }
  if (fields.voiceActors && data.voiceActors.length > 0) {
    const newVas: VoiceActorRow[] = data.voiceActors.map(va => ({
      externalId: va.externalId || `va:${va.name}`,
      name: va.name,
      native: va.native || '',
      language: va.language,
      image: va.image || '',
      role: 'voice',
    }));
    const prev = draft.voiceActors;
    const existingNames = new Set(prev.map(v => v.name.toLowerCase().trim()));
    const toAdd = newVas.filter(v => !existingNames.has(v.name.toLowerCase().trim()));
    patch.voiceActors = [...prev, ...toAdd];
  }
  return patch;
}
