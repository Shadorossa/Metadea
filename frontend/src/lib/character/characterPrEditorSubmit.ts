// CharacterPrEditorModal's handleSubmit I/O sequence, split out to mirror
// PrEditorModal's own load/submit split (see pr-editor-load.ts,
// pr-editor-submit.ts): persists locally, then (always, unlike media's
// 'local' mode) submits the GitHub PR. Takes precomputed diff values instead
// of the component's own closures.
import { saveCharacter, saveCharacterAppearances, type CharacterEntry } from '../tauri/characters';
import { saveCharacterActors } from '../tauri/actors';
import { markSynced } from '../tauri';
import { submitCollaborativeProposal, type CharacterProposalBundle } from '../github/submitCollaborativeProposal';
import { buildBiographyHtml, type ParsedCharacteristic } from './biography-parser';
import { normField } from '../../components/shared/PrEditorField';
import { isFieldChanged, type AppearanceRow, type VoiceActorRow } from './prEditorDiff';

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
  originalCharacter: CharacterEntry;
  name: string;
  nameNative: string;
  aliases: string[];
  imageUrl: string;
  characteristics: ParsedCharacteristic[];
  cleanBiography: string;
  originalCleanBiography: string;
  appearances: AppearanceRow[];
  originalAppearances: AppearanceRow[];
  voiceActors: VoiceActorRow[];
  originalVoiceActors: VoiceActorRow[];
  appearancesChanged: boolean;
  voiceActorsChanged: boolean;
  changeSummary: string;
  setStatusMsg: (msg: string) => void;
  statusSavingLocal: string;
  statusPreparingProposal: string;
}

export async function submitCharacterProposal(p: SubmitCharacterEditorParams): Promise<string | null> {
  p.setStatusMsg(p.statusSavingLocal);

  const reassembledBiography = buildBiographyHtml(p.characteristics, p.cleanBiography);

  const updatedCharacter: CharacterEntry = {
    ...p.originalCharacter,
    name: p.name,
    name_native: normField(p.nameNative) as string | null | undefined,
    aliases_csv: normField(p.aliases.join(',')) as string | null | undefined,
    biography: normField(reassembledBiography) as string | null | undefined,
    image_url: normField(p.imageUrl) as string | null | undefined,
  };

  const nativeFields = extractNativeFields(p.characteristics);
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
  if (p.appearancesChanged) {
    await saveCharacterAppearances(p.currentId, p.appearances.map(a => ({
      media_external_id: a.media_external_id,
      relation_type: a.relation_type,
    })));
  }
  if (p.voiceActorsChanged) {
    await saveCharacterActors(p.currentId, p.voiceActors.map(v => ({
      external_id: v.externalId || `va:${encodeURIComponent(v.name)}`,
      name: v.name,
      name_native: v.native || null,
      image_url: v.image || null,
      role: v.role || 'voice',
      language: v.language || null,
    })));
  }

  p.setStatusMsg(p.statusPreparingProposal);

  // Only the fields this session actually edited — same reasoning as
  // minimalProposalCatalogEntry (media proposals): a proposal whose only
  // real change is "added a voice actor" shouldn't also re-propose the
  // name/bio/aliases/image as if the user had touched those too.
  const characterFields: CharacterProposalBundle['character'] = { external_id: updatedCharacter.external_id };
  if (isFieldChanged(p.name, p.originalCharacter.name)) characterFields.name = updatedCharacter.name;
  if (isFieldChanged(p.nameNative, p.originalCharacter.name_native)) characterFields.name_native = updatedCharacter.name_native;
  if (p.aliases.join(',') !== (p.originalCharacter.aliases_csv || '')) characterFields.aliases_csv = updatedCharacter.aliases_csv;
  if (isFieldChanged(p.cleanBiography, p.originalCleanBiography)) characterFields.biography = updatedCharacter.biography;
  if (isFieldChanged(p.imageUrl, p.originalCharacter.image_url)) characterFields.image_url = updatedCharacter.image_url;

  const bundle: CharacterProposalBundle = {
    character: characterFields,
    appearances: p.appearances.map(a => ({
      media_external_id: a.media_external_id,
      relation_type: a.relation_type,
    })),
    // AniList-sourced actors (real external_id from the search picker) only
    // propose the relation itself (role/language) — name/native/image are
    // AniList's data, not this proposal's; a legacy row with no real
    // external_id (typed in manually, before the picker existed) has no
    // other way to be identified/displayed, so keeps its fields.
    actors: p.voiceActors.map(v => v.externalId?.startsWith('person:a') ? {
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
  const removedAppearanceIds = p.originalAppearances
    .filter(orig => !p.appearances.some(a => a.media_external_id === orig.media_external_id))
    .map(orig => orig.media_external_id);
  const removedActorIds = p.originalVoiceActors
    .filter(orig => orig.externalId && !p.voiceActors.some(v => v.externalId === orig.externalId))
    .map(orig => orig.externalId as string);

  return submitCollaborativeProposal(
    p.currentId,
    [{ kind: 'character', externalId: p.currentId, bundle, removedAppearanceIds, removedActorIds }],
    `- ${p.changeSummary}`,
    p.setStatusMsg,
  );
}
