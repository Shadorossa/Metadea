// CharacterPrEditorModal's handleSubmit I/O sequence, split out to mirror
// PrEditorModal's own load/submit split (see pr-editor-load.ts,
// pr-editor-submit.ts): persists locally, then (always, unlike media's
// 'local' mode) submits the GitHub PR. Takes precomputed diff values instead
// of the component's own closures.
import { saveCharacter, saveCharacterAppearances, type CharacterEntry } from '../tauri/characters';
import { saveCharacterMerges } from '../tauri/characters';
import { saveCharacterActors } from '../tauri/actors';
import { markSynced } from '../tauri';
import { submitCollaborativeProposal, type CharacterProposalBundle, type ProposalFileEntry, type SubmittedProposal } from '../github/submit-collaborative-proposal';
import { buildBiographyHtml, type ParsedCharacteristic } from './biography-parser';
import { uploadImageToSharedCatalog } from './shared-image-storage';
import { normField } from '../shared/text/string-utils';
import { getT } from '../../i18n/runtime';
import {
  appearancesChanged, isFieldChanged, mergedCharactersChanged, sortedMergedCharacterIds, voiceActorsChanged,
} from './character-editor-diff';
import type { CharacterDraft } from './character-editor-state';

// Reverses the Gender/Age/Blood Type/Birthday synthesis in the load effect,
// so a save actually writes these back to their own DB columns instead of
// leaving save_character's gender/age/blood_type/dob_* params undefined —
// which, since that command does a plain INSERT OR REPLACE with no COALESCE
// against the existing row, silently nulled all 4 columns on every single
// editor save regardless of whether the user touched them.
function extractNativeFields(list: ParsedCharacteristic[]) {
  let gender: string | null = null;
  let age: string | null = null;
  let bloodType: string | null = null;
  let dobDay: number | null = null;
  let dobMonth: number | null = null;
  let dobYear: number | null = null;

  for (const c of list) {
    const label = c.label.toLowerCase();
    if (label === 'gender' || label === 'género') gender = c.value || null;
    else if (label === 'age' || label === 'edad') age = c.value || null;
    else if (label === 'blood type' || label === 'bloodtype' || label === 'grupo sanguíneo') bloodType = c.value || null;
    else if (label === 'birthday' || label === 'cumpleaños') {
      const [d, m, y] = c.value.split('/');
      dobDay = d && d !== '?' ? parseInt(d, 10) || null : null;
      dobMonth = m && m !== '?' ? parseInt(m, 10) || null : null;
      dobYear = y ? parseInt(y, 10) || null : null;
    }
  }
  return { gender, age, bloodType, dobDay, dobMonth, dobYear };
}

export interface SubmitCharacterEditorParams {
  currentId: string;
  // baseline.character typed nullable (empty editor state) — callers guard,
  // so the loaded entry is passed explicitly rather than re-checked here.
  originalCharacter: CharacterEntry;
  baseline: CharacterDraft;
  draft: CharacterDraft;
  changeSummary: string;
  setStatusMsg: (msg: string) => void;
  statusSavingLocal: string;
  statusPreparingProposal: string;
  prepareOnly?: boolean;
}

export interface PreparedCharacterProposal {
  entries: ProposalFileEntry[];
  changeSummary: string;
}

export async function submitCharacterProposal(p: SubmitCharacterEditorParams & { prepareOnly: true }): Promise<PreparedCharacterProposal>;
export async function submitCharacterProposal(p: SubmitCharacterEditorParams & { prepareOnly?: false }): Promise<SubmittedProposal | null>;
export async function submitCharacterProposal(p: SubmitCharacterEditorParams): Promise<SubmittedProposal | PreparedCharacterProposal | null> {
  const { baseline, draft } = p;
  const mergedCharacterIds = sortedMergedCharacterIds(draft.mergedCharacters);
  const originalMergedCharacterIds = sortedMergedCharacterIds(baseline.mergedCharacters);

  p.setStatusMsg(p.statusSavingLocal);

  const reassembledBiography = buildBiographyHtml(draft.characteristics, draft.cleanBiography);

  const updatedCharacter: CharacterEntry = {
    ...p.originalCharacter,
    name: draft.name,
    name_native: normField(draft.nameNative) as string | null | undefined,
    aliases_csv: normField(draft.aliases.join(',')) as string | null | undefined,
    biography: normField(reassembledBiography) as string | null | undefined,
    image_url: normField(draft.imageUrl) as string | null | undefined,
  };

  const nativeFields = extractNativeFields(draft.characteristics);
  await saveCharacter(
    p.currentId, updatedCharacter.name, updatedCharacter.image_url,
    updatedCharacter.name_native, updatedCharacter.aliases_csv, updatedCharacter.biography,
    nativeFields.gender, nativeFields.age, nativeFields.bloodType,
    nativeFields.dobYear, nativeFields.dobMonth, nativeFields.dobDay,
  );
  markSynced(p.currentId).catch(() => {});

  // Local persistence just succeeded — announce it regardless of whatever
  // the GitHub proposal step further down does (missing token, network
  // failure, etc.). PrEditorModal listens for this to attach a character
  // created from its own "+ Crear personaje" button straight into the media
  // entry's cast list, without waiting on (or depending on) a GitHub round
  // trip that may never happen.
  window.dispatchEvent(new CustomEvent('metadea:character-saved', {
    detail: { externalId: p.currentId, name: updatedCharacter.name, imageUrl: updatedCharacter.image_url ?? null },
  }));
  if (appearancesChanged(draft.appearances, baseline.appearances)) {
    await saveCharacterAppearances(p.currentId, draft.appearances.map(a => ({
      media_external_id: a.media_external_id,
      relation_type: a.relation_type,
    })));
  }
  if (mergedCharactersChanged(baseline, draft)) {
    await saveCharacterMerges(p.currentId, mergedCharacterIds);
  }
  if (voiceActorsChanged(draft.voiceActors, baseline.voiceActors)) {
    await saveCharacterActors(p.currentId, draft.voiceActors.map(v => ({
      external_id: v.externalId || `va:${encodeURIComponent(v.name)}`,
      name: v.name,
      name_native: v.native || null,
      image_url: v.image || null,
      role: v.role || 'voice',
      language: v.language || null,
    })));
  }

  p.setStatusMsg(p.statusPreparingProposal);

  const imageWasChanged = isFieldChanged(draft.imageUrl, p.originalCharacter.image_url);
  let proposalImageUrl = updatedCharacter.image_url;
  if (imageWasChanged && draft.imageUrl) {
    p.setStatusMsg(getT().character_editor.uploading_shared_image);
    proposalImageUrl = await uploadImageToSharedCatalog(draft.imageUrl, 'character', updatedCharacter.external_id);
  }

  // Only the fields this session actually edited — same reasoning as
  // minimalProposalCatalogEntry (media proposals): a proposal whose only
  // real change is "added a voice actor" shouldn't also re-propose the
  // name/bio/aliases/image as if the user had touched those too.
  const characterFields: CharacterProposalBundle['character'] = { external_id: updatedCharacter.external_id };
  if (isFieldChanged(draft.name, p.originalCharacter.name)) characterFields.name = updatedCharacter.name;
  if (isFieldChanged(draft.nameNative, p.originalCharacter.name_native)) characterFields.name_native = updatedCharacter.name_native;
  if (draft.aliases.join(',') !== (p.originalCharacter.aliases_csv || '')) characterFields.aliases_csv = updatedCharacter.aliases_csv;
  if (isFieldChanged(draft.cleanBiography, baseline.cleanBiography)) characterFields.biography = updatedCharacter.biography;
  if (imageWasChanged) characterFields.image_url = proposalImageUrl;

  const bundle: CharacterProposalBundle = {
    character: characterFields,
    appearances: draft.appearances.map(a => ({
      media_external_id: a.media_external_id,
      relation_type: a.relation_type,
    })),
    merged_character_external_ids: mergedCharacterIds,
    // AniList-sourced actors (real external_id from the search picker) only
    // propose the relation itself (role/language) — name/native/image are
    // AniList's data, not this proposal's; a legacy row with no real
    // external_id (typed in manually, before the picker existed) has no
    // other way to be identified/displayed, so keeps its fields.
    actors: draft.voiceActors.map(v => v.externalId?.startsWith('person:a') ? {
      external_id: v.externalId,
      role: v.role || 'voice',
      language: v.language || null,
    } : {
      external_id: v.externalId || `va:${encodeURIComponent(v.name)}`,
      name: v.name,
      name_native: v.native || null,
      image_url: v.image || null,
      role: v.role || 'voice',
      language: v.language || null,
    }),
  };

  // Explicit removals from *this* editing session — lets the merge against
  // whatever's upstream tell "the user removed this" apart from "this
  // session never even loaded it" (see mergeListByKey), instead of the
  // submitted appearances/actors list blindly overwriting upstream's.
  const removedAppearanceIds = baseline.appearances
    .filter(orig => !draft.appearances.some(a => a.media_external_id === orig.media_external_id))
    .map(orig => orig.media_external_id);
  const removedActorIds = baseline.voiceActors
    .filter(orig => orig.externalId && !draft.voiceActors.some(v => v.externalId === orig.externalId))
    .map(orig => orig.externalId as string);
  const removedMergedCharacterIds = originalMergedCharacterIds
    .filter(id => !mergedCharacterIds.includes(id));

  const entries: ProposalFileEntry[] = [{ kind: 'character', externalId: p.currentId, bundle, removedAppearanceIds, removedActorIds, removedMergedCharacterIds }];
  if (p.prepareOnly) return { entries, changeSummary: p.changeSummary };
  return submitCollaborativeProposal(p.currentId, entries, `- ${p.changeSummary}`, p.setStatusMsg);
}
