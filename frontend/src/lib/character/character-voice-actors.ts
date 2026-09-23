// Voice-actor merging and grouping for the character page: the live AniList
// cast list overlaid with locally persisted actors, then bucketed per
// language tab in a fixed priority order.
import type { AniListCharacterDetail } from '../search/providers/anilist';
import type { DbCharacterActor } from '../tauri/actors';

const VOICE_ACTOR_LANG_MAP: Readonly<Record<string, { code: string; label: string }>> = {
  'japanese': { code: 'JP', label: 'Japonés' },
  'spanish': { code: 'ES', label: 'Español' },
  'english': { code: 'EN', label: 'Inglés' },
  'italian': { code: 'IT', label: 'Italiano' },
  'french': { code: 'FR', label: 'Francés' },
  'german': { code: 'DE', label: 'Alemán' },
  'portuguese': { code: 'PT', label: 'Portugués' },
  'korean': { code: 'KR', label: 'Coreano' },
  'chinese': { code: 'ZH', label: 'Chino' },
  'mandarin': { code: 'ZH', label: 'Chino' },
};

// Orden de prioridad para las pestañas de idiomas
const VOICE_ACTOR_LANG_PRIORITY =['JP', 'ES', 'EN', 'IT', 'FR', 'DE', 'PT', 'KR', 'ZH'];

// Local DB actors overlay the live AniList cast list the same way the
// PR editor merges them (see CharacterPrEditorModal.tsx's vaMap) — a
// locally-added actor (no AniList counterpart at all) or a locally
// edited role/language must show here too, not just in the editor.
// Keyed by external_id ("person:a{id}" for a real AniList staff pick,
// "va:{name}" for a manually-typed legacy entry) instead of AniList's
// own numeric id, since a local-only actor has no such id.
export interface MergedVoiceActor {
  externalId: string;
  name: string;
  native: string;
  image: string;
  siteUrl: string;
  language: string;
}

type CharacterMediaEdge = AniListCharacterDetail['media']['edges'][number];

export function mergeVoiceActors(
  edges: CharacterMediaEdge[] | undefined,
  persistedActors: DbCharacterActor[],
): { actors: MergedVoiceActor[]; hasNewActors: boolean } {
  const vaMap = new Map<string, MergedVoiceActor>();
  if (edges) {
    for (const edge of edges) {
      if (edge.voiceActors) {
        for (const va of edge.voiceActors) {
          const key = va.id ? `person:a${va.id}` : `va:${va.name?.full || ''}`;
          if (!vaMap.has(key)) {
            vaMap.set(key, {
              externalId: key,
              name: va.name?.userPreferred || va.name?.full || '',
              native: va.name?.native || '',
              image: va.image?.large || va.image?.medium || '',
              siteUrl: va.siteUrl || (va.id ? `https://anilist.co/staff/${va.id}` : ''),
              language: va.languageV2 || 'Japanese',
            });
          }
        }
      }
    }
  }
  const persistedIds = new Set(persistedActors.map(a => a.external_id));
  for (const a of persistedActors) {
    const live = vaMap.get(a.external_id);
    vaMap.set(a.external_id, {
      externalId: a.external_id,
      name: a.name || live?.name || '',
      native: a.name_native || live?.native || '',
      image: a.image_url || live?.image || '',
      siteUrl: live?.siteUrl || '',
      language: a.language || live?.language || 'Japanese',
    });
  }
  const hasNewActors = Array.from(vaMap.keys()).some(id => !persistedIds.has(id));
  return { actors: Array.from(vaMap.values()), hasNewActors };
}

export function toPersistedActor(va: MergedVoiceActor): DbCharacterActor {
  return {
    external_id: va.externalId,
    name: va.name,
    name_native: va.native || null,
    image_url: va.image || null,
    role: null,
    language: va.language || null,
  };
}

export interface VoiceActorsByLanguage {
  byLang: Map<string, MergedVoiceActor[]>;
  languages: string[];
}

export function groupVoiceActorsByLanguage(actors: MergedVoiceActor[]): VoiceActorsByLanguage {
  const byLang = new Map<string, MergedVoiceActor[]>();
  for (const va of actors) {
    const rawLang = (va.language || 'Japanese').toLowerCase();
    const langKey = VOICE_ACTOR_LANG_MAP[rawLang]?.code || rawLang.substring(0, 2).toUpperCase();
    const bucket = byLang.get(langKey);
    if (bucket) bucket.push(va);
    else byLang.set(langKey, [va]);
  }
  const languages = Array.from(byLang.keys()).sort((a, b) => {
    const idxA = VOICE_ACTOR_LANG_PRIORITY.indexOf(a);
    const idxB = VOICE_ACTOR_LANG_PRIORITY.indexOf(b);
    if (idxA !== -1 && idxB !== -1) return idxA - idxB;
    if (idxA !== -1) return -1;
    if (idxB !== -1) return 1;
    return a.localeCompare(b);
  });
  return { byLang, languages };
}

export function defaultVoiceActorLanguage(languages: string[]): string {
  return languages.includes('JP') ? 'JP' : languages[0];
}

/** "Name (Suffix)" → name + parenthetical shown smaller; suffix null otherwise. */
export function splitVoiceActorName(rawName: string): { name: string; suffix: string | null } {
  const match = rawName.match(/^([^(]+)(?:\s*(\([^)]+\)))?$/);
  if (!match || !match[2]) return { name: rawName, suffix: null };
  return { name: match[1].trim(), suffix: match[2].trim() };
}

export function voiceActorInitial(name: string): string {
  return (name.replace(/\s*\([^)]*\)/g, '').trim().charAt(0) || '?').toUpperCase();
}
