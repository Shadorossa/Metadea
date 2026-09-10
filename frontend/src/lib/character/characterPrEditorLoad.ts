// CharacterPrEditorModal's load effect body, split out to mirror
// PrEditorModal's own load/submit split (see pr-editor-load.ts,
// pr-editor-submit.ts) — takes the id plus whatever the caller can't itself
// know (the pending appearance ref, the relation type new appearances
// default to) instead of closing over component state.
import {
  getCharacter, getCharacterAppearances,
  type CharacterEntry, type CharacterAppearance,
} from '../tauri/characters';
import { getCharacterActors, type DbCharacterActor } from '../tauri/actors';
import { getCatalogEntry, saveCatalogEntry } from '../tauri/catalog';
import { fetchAniListCharacterDetail } from '../search/providers/anilist';
import { parseCSV } from '../shared/string-utils';
import { parseCharacterBiography, type ParsedCharacteristic } from './biography-parser';
import { compareByReleaseDateThenTitle, mapExternalFormatToType } from '../media/mapper-utils';
import type { AppearanceRow, VoiceActorRow } from './prEditorDiff';

export interface PendingAppearance {
  media_external_id: string;
  title: string;
  cover: string | null;
  release_year?: number | null;
  release_month?: number | null;
  release_day?: number | null;
}

export interface CharacterEditorLoadResult {
  character: CharacterEntry;
  originalCharacter: CharacterEntry;
  name: string;
  nameNative: string;
  aliases: string[];
  imageUrl: string;
  characteristics: ParsedCharacteristic[];
  cleanBiography: string;
  originalCharacteristics: ParsedCharacteristic[];
  originalCleanBiography: string;
  appearances: AppearanceRow[];
  originalAppearances: AppearanceRow[];
  voiceActors: VoiceActorRow[];
  originalVoiceActors: VoiceActorRow[];
}

export async function loadCharacterEditorData(
  currentId: string,
  pendingAppearance: PendingAppearance | null,
  appearanceRelationType: string,
): Promise<CharacterEditorLoadResult> {
  const now = new Date().toISOString();
  // Same "character:<providerCode>:<rawId>" parsing character.astro's own
  // loadCharacterData already does (a/co/ms/custom) — this used to just grab
  // split(':')[1] and strip non-digits from it, which for the current
  // 3-segment id shape only ever grabbed the provider code letter itself
  // (e.g. "a"), not the real numeric id, silently skipping every live
  // AniList refetch. providerCode !== 'a' (custom characters included)
  // always skips the fetch, same as that page.
  const bareId = currentId.startsWith('character:') ? currentId.slice('character:'.length) : currentId;
  const sepIndex = bareId.indexOf(':');
  const providerCode = sepIndex === -1 ? (/^\d+$/.test(bareId) ? 'a' : '') : bareId.slice(0, sepIndex);
  const rawId = sepIndex === -1 ? bareId : bareId.slice(sepIndex + 1);
  const anilistCharId = providerCode === 'a' ? parseInt(rawId, 10) : NaN;

  let anilistDetail = null;
  if (!isNaN(anilistCharId) && anilistCharId > 0) {
    try {
      anilistDetail = await fetchAniListCharacterDetail(anilistCharId);
    } catch (err) {
      console.error('Failed to fetch from AniList:', err);
    }
  }

  const localData: CharacterEntry = (await getCharacter(currentId)) ?? {
    id: '',
    external_id: currentId,
    name: '',
    created_at: now,
    updated_at: now,
  };

  // Local edit wins whenever one exists — the same "sticky local field" rule
  // mediaService.ts's applyStickyLocalFields uses for media pages. AniList's
  // live value only fills in what's actually still blank locally (a
  // brand-new character, or a field the user never touched). Without this, a
  // manually corrected name/bio/image (e.g. fixing a mis-parsed
  // characteristic) got silently reverted to AniList's raw copy the very
  // next time this editor reopened.
  const data = anilistDetail ? {
    ...localData,
    name: localData.name || anilistDetail.name.full || '',
    name_native: localData.name_native || anilistDetail.name.native || null,
    biography: localData.biography || anilistDetail.description || null,
    image_url: localData.image_url || anilistDetail.image?.large || null,
  } : localData;

  const aniListAlt = [
    ...(anilistDetail?.name?.alternative ?? []),
    ...(anilistDetail?.name?.alternativeSpoiler ?? []),
  ];
  const localAlt = parseCSV(data.aliases_csv);
  const combinedAliases = Array.from(new Set([...localAlt, ...aniListAlt]));

  // Same sticky-local-wins merge as `data` above, extended to the 4 native
  // fields (gender/age/bloodType/birthday) — character.astro's own
  // localCharacterToDetail() does the equivalent for the read-only page.
  // Without this, these 4 characteristics silently vanished from the editor
  // whenever the live AniList re-fetch above failed (offline, rate-limited,
  // a non-numeric id), even though the local DB already had them cached
  // from a previous successful load.
  const nativeGender = anilistDetail?.gender ?? localData.gender ?? null;
  const nativeAge = anilistDetail?.age ?? localData.age ?? null;
  const nativeBloodType = anilistDetail?.bloodType ?? localData.blood_type ?? null;
  const nativeDob = (anilistDetail?.dateOfBirth?.day || anilistDetail?.dateOfBirth?.month)
    ? anilistDetail!.dateOfBirth
    : (localData.dob_day || localData.dob_month)
      ? { day: localData.dob_day ?? null, month: localData.dob_month ?? null, year: localData.dob_year ?? null }
      : null;

  const { characteristics: parsedStats, cleanBiography: parsedBio } = parseCharacterBiography(data.biography);
  const addedLabels = new Set(parsedStats.map(c => c.label.toLowerCase()));

  // Prepended (not appended) — the character page itself renders
  // Género/Edad/Grupo Sanguíneo/Cumpleaños before any parsed bio
  // characteristic (character.astro's own stats block does gender, then
  // age, then bloodType, then birthday, THEN loops parsedStats), so the
  // editor should list them in that same order instead of tacking them onto
  // the end after Height/In Fate/etc.
  const nativeCharacteristics: ParsedCharacteristic[] = [];
  if (nativeGender && !addedLabels.has('gender') && !addedLabels.has('género')) {
    nativeCharacteristics.push({ label: 'Gender', value: nativeGender });
  }
  if (nativeAge && !addedLabels.has('age') && !addedLabels.has('edad')) {
    nativeCharacteristics.push({ label: 'Age', value: String(nativeAge) });
  }
  if (nativeBloodType && !addedLabels.has('blood type') && !addedLabels.has('bloodtype') && !addedLabels.has('grupo sanguíneo')) {
    nativeCharacteristics.push({ label: 'Blood Type', value: nativeBloodType });
  }
  if (nativeDob && (nativeDob.day || nativeDob.month)) {
    if (!addedLabels.has('birthday') && !addedLabels.has('cumpleaños')) {
      const day = nativeDob.day ?? '?';
      const month = nativeDob.month ?? '?';
      const year = nativeDob.year ? `/${nativeDob.year}` : '';
      nativeCharacteristics.push({ label: 'Birthday', value: `${day}/${month}${year}` });
    }
  }

  const allCharacteristics = [...nativeCharacteristics, ...parsedStats];

  // ── APARICIONES: Usar datos guardados localmente o fallback a AniList ──
  const rawAppearances = await getCharacterAppearances(currentId).catch(() => [] as CharacterAppearance[]);
  let resolved: AppearanceRow[] = [];

  const anilistMediaCache: Record<string, { title: string; cover: string | null; year: number | null; month: number | null; day: number | null }> = {};
  if (anilistDetail?.media?.edges) {
    for (const edge of anilistDetail.media.edges) {
      // AniList's `type` alone can't tell manga from light novel (both are
      // type MANGA — format NOVEL is what actually distinguishes them) —
      // see character.astro's identical fix.
      const extId = `${mapExternalFormatToType(edge.node.type, edge.node.format)}:${edge.node.id}`;
      anilistMediaCache[extId] = {
        title: edge.node.title.userPreferred || `${edge.node.type}:${edge.node.id}`,
        cover: edge.node.coverImage?.large || null,
        year: edge.node.startDate?.year ?? null,
        month: edge.node.startDate?.month ?? null,
        day: edge.node.startDate?.day ?? null,
      };
    }
  }

  if (rawAppearances.length > 0) {
    resolved = await Promise.all(rawAppearances.map(async (a): Promise<AppearanceRow> => {
      let entry = await getCatalogEntry(a.media_external_id).catch(() => null);
      const cached = anilistMediaCache[a.media_external_id];
      if (!entry && cached) {
        entry = {
          id: '',
          external_id: a.media_external_id,
          type: a.media_external_id.split(':')[0].toUpperCase(),
          title_main: cached.title,
          cover_url: cached.cover,
          release_year: cached.year,
          release_month: cached.month,
          release_day: cached.day,
          created_at: now,
          updated_at: now,
        };
        await saveCatalogEntry(entry).catch(() => {});
      }
      return {
        media_external_id: a.media_external_id,
        relation_type: a.relation_type ?? null,
        title: entry?.title_main || cached?.title || a.media_external_id,
        cover: entry?.cover_url ?? cached?.cover ?? null,
        release_year: entry?.release_year ?? cached?.year ?? null,
        release_month: entry?.release_month ?? cached?.month ?? null,
        release_day: entry?.release_day ?? cached?.day ?? null,
      };
    }));
  } else if (anilistDetail?.media?.edges) {
    resolved = anilistDetail.media.edges.map((edge: any): AppearanceRow => {
      const extId = `${mapExternalFormatToType(edge.node.type, edge.node.format)}:${edge.node.id}`;
      return {
        media_external_id: extId,
        relation_type: edge.characterRole ?? 'SUPPORTING',
        title: edge.node.title.userPreferred || extId,
        cover: edge.node.coverImage?.large || null,
        release_year: edge.node.startDate?.year ?? null,
        release_month: edge.node.startDate?.month ?? null,
        release_day: edge.node.startDate?.day ?? null,
      };
    });
  }

  resolved.sort(compareByReleaseDateThenTitle);

  const resolvedWithPending = (pendingAppearance && !resolved.some(a => a.media_external_id === pendingAppearance.media_external_id))
    ? [...resolved, {
      media_external_id: pendingAppearance.media_external_id,
      relation_type: appearanceRelationType,
      title: pendingAppearance.title,
      cover: pendingAppearance.cover,
      release_year: pendingAppearance.release_year ?? null,
      release_month: pendingAppearance.release_month ?? null,
      release_day: pendingAppearance.release_day ?? null,
    }]
    : resolved;
  // Always sorted here, unconditionally — so this stays correct even if the
  // pending-appearance branch above changes, instead of relying on a sort
  // call nested inside that branch.
  resolvedWithPending.sort(compareByReleaseDateThenTitle);

  // Live AniList cast list goes in first (full name/image) — a
  // community-shared actor's proposal only ever carries role/language (see
  // handleSubmit: AniList's own data isn't re-proposed), so persisted rows
  // can have a blank name/native/image. Overlaying persisted second, only
  // over non-empty fields, means role/language (the actual curated data)
  // always win while name/image still fall back to AniList's live copy
  // instead of showing blank.
  const vaMap = new Map<string, VoiceActorRow>();
  if (anilistDetail?.media?.edges) {
    for (const edge of anilistDetail.media.edges) {
      if (edge.voiceActors) {
        for (const va of edge.voiceActors) {
          const key = va.id ? `person:a${va.id}` : `va:${va.name?.full || ''}`;
          if (!vaMap.has(key)) {
            vaMap.set(key, {
              externalId: key,
              name: va.name?.userPreferred || va.name?.full || '',
              native: va.name?.native || '',
              language: va.languageV2 || 'Japanese',
              image: va.image?.large || va.image?.medium || '',
              role: 'voice',
            });
          }
        }
      }
    }
  }
  const persistedActors = await getCharacterActors(currentId).catch(() => [] as DbCharacterActor[]);
  for (const a of persistedActors) {
    const live = vaMap.get(a.external_id);
    vaMap.set(a.external_id, {
      externalId: a.external_id,
      name: a.name || live?.name || '',
      native: a.name_native || live?.native || '',
      language: a.language || live?.language || 'Japanese',
      image: a.image_url || live?.image || '',
      role: a.role || live?.role || 'voice',
    });
  }
  const initialVas = Array.from(vaMap.values());

  return {
    character: data,
    originalCharacter: data,
    name: data.name || '',
    nameNative: data.name_native || '',
    aliases: combinedAliases,
    imageUrl: data.image_url || '',
    characteristics: allCharacteristics,
    cleanBiography: parsedBio,
    originalCharacteristics: allCharacteristics,
    originalCleanBiography: parsedBio,
    appearances: resolvedWithPending,
    originalAppearances: resolved,
    voiceActors: initialVas,
    originalVoiceActors: initialVas,
  };
}
