import { findActorByExactName } from '../tauri/actors';
import { findAniListStaffExactMatch } from '../search/providers/anilist';
import { findTmdbPersonExactMatch } from '../search/providers/tmdb';
import { API_ENDPOINTS } from '../api/endpoints';

export interface CorrelatedVoiceActor {
  externalId: string;
  name: string;
  native?: string;
  language: string;
  image?: string;
  matchedFrom: 'db' | 'anilist' | 'tmdb' | 'none';
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

  // Parenthetical annotations are language/details, never part of an actor's
  // searchable or canonical name (e.g. "Joana Ribeiro (European Portuguese)").
  const baseName = clean.replace(/\s*\([^()]*\)/g, '').trim();

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

  try {
    const tmdbMatch = await findTmdbPersonExactMatch(baseName, signal);
    if (tmdbMatch) {
      return {
        externalId: `person:t${tmdbMatch.id}`,
        name: tmdbMatch.name,
        language,
        image: tmdbMatch.profile_path ? API_ENDPOINTS.TMDB_IMAGE(tmdbMatch.profile_path, 'w185') : undefined,
        matchedFrom: 'tmdb',
      };
    }
  } catch (err) {
    console.warn('[VoiceActorResolver] TMDB check error:', err);
  }

  // Japanese names are commonly written family-name first on wikis, while
  // AniList/TMDB may index the same person given-name first. Only make this
  // extra pass after the original order failed across every source.
  if (/^japanese$/i.test(language.trim())) {
    const nameParts = baseName.split(/\s+/).filter(Boolean);
    if (nameParts.length >= 2) {
      const reversedName = nameParts.length === 2
        ? `${nameParts[1]} ${nameParts[0]}`
        : `${nameParts[nameParts.length - 1]} ${nameParts.slice(0, -1).join(' ')}`;

      try {
        const dbMatch = await findActorByExactName(reversedName);
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
        console.warn('[VoiceActorResolver] Reversed local DB check error:', err);
      }

      try {
        const anilistMatch = await findAniListStaffExactMatch(reversedName, signal);
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
        console.warn('[VoiceActorResolver] Reversed AniList check error:', err);
      }

      try {
        const tmdbMatch = await findTmdbPersonExactMatch(reversedName, signal);
        if (tmdbMatch) {
          return {
            externalId: `person:t${tmdbMatch.id}`,
            name: tmdbMatch.name,
            language,
            image: tmdbMatch.profile_path ? API_ENDPOINTS.TMDB_IMAGE(tmdbMatch.profile_path, 'w185') : undefined,
            matchedFrom: 'tmdb',
          };
        }
      } catch (err) {
        console.warn('[VoiceActorResolver] Reversed TMDB check error:', err);
      }
    }
  }

  return {
    externalId: `va:${baseName}`,
    name: baseName,
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
