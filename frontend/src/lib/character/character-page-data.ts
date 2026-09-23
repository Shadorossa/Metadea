// Loads everything a character page shows — local-first with a sync_state-
// gated AniList refresh — and folds it into one render-ready view model.
// No DOM here: the React island (components/character/page) renders it.
import { fetchAniListCharacterDetail, type AniListCharacterDetail } from '../search/providers/anilist';
import { parseCharacterBiography } from './biography-parser';
import { needsResync } from '../media/media-status';
import { parseCSV } from '../shared/text/string-utils';
import {
  readUserFavoritesTyped,
  saveCharacter,
  getCharacter,
  getCharacterReaction,
  getCharacterMergeTarget,
  getCharacterAppearances,
  saveCharacterAppearances,
  getCharacterActors,
  saveCharacterActors,
  getCatalogEntry,
  getSyncState,
  markSynced,
  markSyncFailed,
  getFavoriteCustomImage,
  wrapAssetUrl,
  type CharacterEntry,
} from '../tauri';
import { collectCharacterAliases, type CharacterAlias } from './character-aliases';
import {
  buildAniListMediaCache,
  mergeAppearanceRows,
  resolveMergedAppearance,
  sortAppearances,
  type MergedAppearance,
} from './character-appearances';
import { parseCharacterPageId } from './character-page-id';
import { normalizeReaction, type CharacterReaction } from './character-reactions';
import { buildRoleLabels, type CharacterStrings } from './character-stat-labels';
import { buildCharacterStatRows, type CharacterStatRow } from './character-stats';
import {
  groupVoiceActorsByLanguage,
  mergeVoiceActors,
  toPersistedActor,
  type VoiceActorsByLanguage,
} from './character-voice-actors';

export interface CharacterPageData {
  externalId: string;
  name: string;
  nameNative: string | null;
  /** Local-preferred image (custom crop excluded) — the avatar falls back to it. */
  stickyImage: string | null;
  /** The custom favourite crop, already wrapped as an asset URL, when one exists. */
  customImageUrl: string | null;
  aliases: CharacterAlias[];
  siteUrl: string;
  statRows: CharacterStatRow[];
  /** Biography with stat lines removed and ~!spoilers!~ wrapped; unsanitized. */
  biographyHtml: string;
  voiceActors: VoiceActorsByLanguage;
  appearances: MergedAppearance[];
  isFavorite: boolean;
  reaction: CharacterReaction | null;
}

export type CharacterPageLoadResult =
  | { status: 'ready'; data: CharacterPageData }
  | { status: 'redirect'; targetId: string }
  | { status: 'error'; message: string };

// Reconstructs an AniListCharacterDetail-shaped object purely from what's
// cached locally, so every downstream render (stats, name/native/image,
// aliases) works unchanged whether `character` came from a live AniList
// fetch or was skipped because sync_state says it isn't due for a resync
// yet. media.edges stays empty — appearances/voice-actors already have
// their own local-first merge (character_appearances / character_actors)
// that tolerates an empty live edge list fine.
function localCharacterToDetail(id: number, lc: CharacterEntry): AniListCharacterDetail {
  return {
    id,
    name: {
      full: lc.name,
      native: lc.name_native ?? null,
      alternative: parseCSV(lc.aliases_csv),
      alternativeSpoiler: [],
    },
    image: { large: lc.image_url ?? null },
    description: lc.biography ?? null,
    gender: lc.gender ?? null,
    dateOfBirth: { year: lc.dob_year ?? null, month: lc.dob_month ?? null, day: lc.dob_day ?? null },
    age: lc.age ?? null,
    bloodType: lc.blood_type ?? null,
    media: { edges: [] },
  };
}

// A locally-stored image only gets replaced by the fresh AniList fetch
// when it's itself an old AniList "medium" thumbnail (e.g. seeded by a
// media page's character grid — save_characters_skeleton's INSERT OR
// IGNORE means it never upgrades itself otherwise) — never for a
// custom crop (data: URL) or any other deliberately-set image, which
// stay sticky like every other manually-edited field.
function resolveStickyImage(localChar: CharacterEntry | null, character: AniListCharacterDetail): string | null {
  const localImageIsAniListMedium = !!localChar?.image_url
    && localChar.image_url.includes('anilist.co')
    && localChar.image_url.includes('/medium/');
  return (localChar?.image_url && !localImageIsAniListMedium)
    ? localChar.image_url
    : (character.image?.large || localChar?.image_url || null);
}

function spoilerMarkupToHtml(cleanBiography: string): string {
  return cleanBiography.replace(/~!([\s\S]*?)!~/g, '<span class="spoiler">$1</span>');
}

export async function loadCharacterPageData(idParam: string, t: CharacterStrings): Promise<CharacterPageLoadResult> {
  const parsed = parseCharacterPageId(idParam);
  if (!parsed) return { status: 'error', message: t.error_invalid_id };
  const { providerCode, rawId, externalId: characterExternalId } = parsed;

  const localChar = await getCharacter(characterExternalId).catch(() => null);
  const mergeTarget = await getCharacterMergeTarget(characterExternalId).catch(() => null);
  if (mergeTarget && mergeTarget !== characterExternalId) {
    return { status: 'redirect', targetId: mergeTarget };
  }

  let character: AniListCharacterDetail;
  if (providerCode !== 'a') {
    if (!localChar) return { status: 'error', message: t.error_unsupported_source };
    character = localCharacterToDetail(0, localChar);
  } else {
    const characterId = parseInt(rawId, 10);
    if (isNaN(characterId)) return { status: 'error', message: t.error_invalid_id };

    const syncState = await getSyncState(characterExternalId).catch(() => null);
    const dueForResync = needsResync(syncState ? {
      last_synced_at: syncState.last_synced_at,
      sync_failed_count: syncState.sync_failed_count,
    } : null);

    const isSkeleton = !localChar || !localChar.biography;
    if (dueForResync || isSkeleton) {
      const live = await fetchAniListCharacterDetail(characterId);
      if (live) {
        character = live;
        markSynced(characterExternalId).catch(() => {});
      } else if (localChar) {
        markSyncFailed(characterExternalId, 'Live fetch returned no data').catch(() => {});
        character = localCharacterToDetail(characterId, localChar);
      } else {
        return { status: 'error', message: t.not_found_anilist };
      }
    } else {
      character = localCharacterToDetail(characterId, localChar);
    }
  }

  const stickyName = localChar?.name || character.name.full;
  const stickyNameNative = localChar?.name_native || character.name.native || null;
  const stickyImage = resolveStickyImage(localChar, character);
  const stickyBiography = localChar?.biography || character.description;

  // Imagen / Avatar (prioriza imagen personalizada local si existe)
  const customImg = await getFavoriteCustomImage(characterExternalId).catch(() => null);
  const customImageUrl = customImg ? wrapAssetUrl(customImg.image_url) : null;

  // Parseo de biografía para extraer características
  const { characteristics: parsedStats, cleanBiography } = parseCharacterBiography(stickyBiography);
  const biographyHtml = spoilerMarkupToHtml(cleanBiography);

  const aliases = collectCharacterAliases({
    name: stickyName,
    nameNative: stickyNameNative,
    alternative: character.name?.alternative ?? [],
    alternativeSpoiler: character.name?.alternativeSpoiler ?? [],
    aliasesCsv: localChar?.aliases_csv,
    parsedStats,
    biography: stickyBiography,
  });

  // ── ENLACE A LA API DE ORIGEN (ANILIST) ──
  // AniListCharacterDetail carries no siteUrl of its own, so the link is
  // always derived from the id (non-AniList sources get none).
  const siteUrl = providerCode === 'a' && rawId ? `https://anilist.co/character/${rawId}` : '';

  // ── ACTORES DE VOZ POR IDIOMA ──
  const persistedActors = await getCharacterActors(characterExternalId).catch(() => []);
  const { actors, hasNewActors } = mergeVoiceActors(character.media?.edges, persistedActors);
  // Voice actors only ever came from this live AniList fetch — never
  // cached locally otherwise — so a later visit skipped by sync_state's
  // staleness gate (no live fetch, no character.media.edges at all) used
  // to show no voice actors whatsoever. Persist the merged set (local
  // edits still win, never overwritten) so they survive a skipped fetch
  // the same way appearances already do.
  if (hasNewActors) {
    saveCharacterActors(characterExternalId, actors.map(toPersistedActor)).catch(() => {});
  }
  const voiceActors = groupVoiceActorsByLanguage(actors);

  // ── ESPECIFICACIONES Y DATOS ──
  const statRows = buildCharacterStatRows(character, parsedStats, t);

  // ── APARICIONES EN OBRAS ──
  // Local DB appearances win over the live AniList list whenever any
  // exist, same as the editor (CharacterPrEditorModal.tsx) — a manually
  // added or removed appearance must show here too, not just there.
  // AniList's own edges still resolve title/cover/date for whichever of
  // those local rows aren't cataloged locally yet.
  const rawEdges = character.media?.edges || [];
  const anilistMediaCache = buildAniListMediaCache(rawEdges);
  const rawAppearances = await getCharacterAppearances(characterExternalId).catch(() => []);
  const { union: unionAppearances, newFromAniList } = mergeAppearanceRows(rawAppearances, rawEdges);
  if (newFromAniList.length > 0) {
    saveCharacterAppearances(characterExternalId, unionAppearances).catch(() => {});
  }
  const roleLabels = buildRoleLabels(t);
  const mergedAppearances = await Promise.all(unionAppearances.map(async a => {
    const entry = await getCatalogEntry(a.media_external_id).catch(() => null);
    return resolveMergedAppearance(a, entry, anilistMediaCache[a.media_external_id], roleLabels);
  }));
  const appearances = sortAppearances(mergedAppearances);

  // Reacciones y Favorito
  const allFavs = await readUserFavoritesTyped().catch(() => ({} as Record<string, string[]>));
  // read_user_favorites_typed (Rust) keys its result by the singular type name
  // (fav_key_to_type("character_fav") === "character") — 'characters'/
  // 'characters_fav' never matched anything, so isFav was always false
  // and the button never reflected (or persisted to) the real list.
  const favList = allFavs['character'] || [];
  const isFavorite = Array.isArray(favList) && favList.includes(characterExternalId);

  const reaction = normalizeReaction(await getCharacterReaction(characterExternalId).catch(() => null));

  // Writes the sticky (local-preferred) values back, not AniList's raw
  // live copy — this used to blindly resave character.name.full/
  // .image/.native/.description on every single page view, silently
  // wiping out any edit made via the PR editor as soon as the user next
  // visited this same character page. Also persists the fully
  // consolidated alias list (aliases_csv/regex-extracted/etc.), not
  // just AniList's own raw alternative names.
  saveCharacter(
    characterExternalId,
    stickyName,
    stickyImage,
    stickyNameNative,
    aliases.map(a => a.text).join(','),
    stickyBiography,
    character.gender,
    character.age,
    character.bloodType,
    character.dateOfBirth?.year ?? null,
    character.dateOfBirth?.month ?? null,
    character.dateOfBirth?.day ?? null,
  ).catch(() => {});

  return {
    status: 'ready',
    data: {
      externalId: characterExternalId,
      name: stickyName,
      nameNative: stickyNameNative,
      stickyImage,
      customImageUrl,
      aliases,
      siteUrl,
      statRows,
      biographyHtml,
      voiceActors,
      appearances,
      isFavorite,
      reaction,
    },
  };
}
