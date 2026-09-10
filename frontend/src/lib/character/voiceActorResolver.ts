import { findActorByExactName } from '../tauri/actors';
import { findAniListStaffExactMatch } from '../search/providers/anilist';

export interface CorrelatedVoiceActor {
  externalId: string;
  name: string;
  native?: string;
  language: string;
  image?: string;
  matchedFrom: 'db' | 'anilist' | 'none';
}

export async function correlateVoiceActor(
  name: string,
  language: string = 'Japanese',
  signal?: AbortSignal,
): Promise<CorrelatedVoiceActor> {
  const clean = name.trim();
  if (!clean) {
    return { externalId: '', name: '', language, matchedFrom: 'none' };
  }

  const matchBase = clean.match(/^([^(]+)(?:\s*\(([^)]+)\))?$/);
  const baseName = (matchBase ? matchBase[1] : clean).trim();

  // 1. Base de datos local
  try {
    const dbMatch = await findActorByExactName(baseName);
    if (dbMatch) {
      return {
        externalId: dbMatch.external_id,
        name: dbMatch.name,
        native: dbMatch.name_native || undefined,
        language,
        image: dbMatch.image_url || undefined,
        matchedFrom: 'db',
      };
    }
  } catch (err) {
    console.warn('[VoiceActorResolver] Local DB check error:', err);
  }

  // 2. Coincidencia exacta en AniList
  try {
    const anilistMatch = await findAniListStaffExactMatch(baseName, signal);
    if (anilistMatch) {
      return {
        externalId: `person:a${anilistMatch.id}`,
        name: anilistMatch.name,
        native: anilistMatch.nameNative || undefined,
        language,
        image: anilistMatch.image || undefined,
        matchedFrom: 'anilist',
      };
    }
  } catch (err) {
    console.warn('[VoiceActorResolver] AniList check error:', err);
  }

  return {
    externalId: `va:${clean}`,
    name: clean,
    language,
    matchedFrom: 'none',
  };
}

export async function correlateVoiceActors(
  actors: Array<{ name: string; language?: string; image?: string; siteUrl?: string }>,
  signal?: AbortSignal,
): Promise<CorrelatedVoiceActor[]> {
  return Promise.all(
    actors.map(async (act) => {
      const res = await correlateVoiceActor(act.name, act.language || 'Japanese', signal);
      if (!res.image && act.image) {
        res.image = act.image;
      }
      return res;
    })
  );
}
