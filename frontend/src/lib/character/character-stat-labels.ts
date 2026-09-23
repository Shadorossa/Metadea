// Display-label resolution for the stats parsed out of a character's
// biography (Fandom / AniList bold "Label: value" lines). Extracted verbatim
// from the former character.astro inline script; the alias tables below are
// data and map onto i18n keys instead of translated strings so the same
// tables serve every locale.
import type { Translations } from '../../i18n/index';

export type CharacterStrings = Translations['character'];
type CharacterStringKey = keyof CharacterStrings;

// Fandom and AniList label the same stat in either language and with
// several spellings, so every known alias maps onto one display label.
export const STAT_LABEL_ALIASES: ReadonlyArray<readonly [readonly string[], CharacterStringKey]> = [
  [['height', 'estatura', 'altura'], 'stat_height'],
  [['weight', 'peso'], 'stat_weight'],
  [['hair color', 'hair', 'color de pelo', 'pelo', 'cabello'], 'stat_hair'],
  [['eye color', 'eyes', 'eye colour', 'color de ojos', 'ojos'], 'stat_eyes'],
  [['affiliations', 'affiliation'], 'stat_affiliation'],
  [['bounty', 'recompensa'], 'stat_bounty'],
  [['gender', 'sex', 'género', 'sexo'], 'stat_gender'],
  [['age', 'edad'], 'stat_age'],
  [['status', 'estado'], 'stat_status'],
  [['nationality', 'nacionalidad'], 'stat_nationality'],
  [['ethnicity', 'etnia'], 'stat_ethnicity'],
  [['born', 'birth date', 'date of birth', 'nacimiento', 'fecha de nacimiento'], 'stat_born'],
  [['died', 'death date', 'date of death', 'fallecimiento', 'muerte'], 'stat_died'],
  [['occupation', 'occupations', 'ocupación', 'profesión'], 'stat_occupation'],
  [['notable family', 'family', 'familia', 'relatives', 'parientes'], 'stat_family'],
  [['friends', 'amigos', 'friend'], 'stat_friends'],
  [['affiliates', 'afiliados', 'colleagues', 'colegas', 'asociados', 'associates'], 'stat_affiliates'],
  [['blood type', 'bloodtype', 'grupo sanguíneo'], 'stat_blood_type'],
  [['birthday', 'cumpleaños'], 'stat_birthday'],
  [['created by', 'creador', 'creado por'], 'stat_created_by'],
  [['designed by', 'diseño', 'diseñado por'], 'stat_designed_by'],
  [['main appearance(s)', 'appearances', 'apariciones'], 'stat_appearances'],
];

export const SECTION_HEADER_KEYS: Readonly<Record<string, CharacterStringKey>> = {
  'physical description': 'section_physical',
  'descripción física': 'section_physical',
  'career and family information': 'section_career_family',
  'career and family': 'section_career_family',
  'carrera y familia': 'section_career_family',
  'información profesional': 'section_career_family',
  'associates': 'section_associates',
  'asociados': 'section_associates',
  'relaciones': 'section_associates',
  'relationships': 'section_associates',
  'behind the scenes': 'section_behind_scenes',
  'detrás de las cámaras': 'section_behind_scenes',
  'producción': 'section_behind_scenes',
  'personal information': 'section_personal',
  'información personal': 'section_personal',
};

// Bold biography labels whose value is a list of alternate names rather than
// a stat — they feed the alias tag row, and are skipped in the stats list.
const ALIAS_SOURCE_LABEL_TERMS = ['alias', 'nombre', 'name', 'aka', 'nickname', 'title'];
const ALIAS_SKIP_LABEL_TERMS = ['alias', 'nombre', 'name', 'aka'];

export function buildStatLabelMap(t: CharacterStrings): Map<string, string> {
  const map = new Map<string, string>();
  for (const [aliases, key] of STAT_LABEL_ALIASES) {
    for (const alias of aliases) map.set(alias, t[key]);
  }
  return map;
}

export function resolveStatLabel(lowerLabel: string, t: CharacterStrings, labelMap: Map<string, string> = buildStatLabelMap(t)): string | undefined {
  const exact = labelMap.get(lowerLabel);
  if (exact) return exact;
  // "Affiliation(s)", "Afiliaciones", ... — the suffix varies per wiki.
  if (lowerLabel.startsWith('affiliation') || lowerLabel.startsWith('afiliaci')) return t.stat_affiliation;
  return undefined;
}

export function formatSectionHeader(header: string, t: CharacterStrings): string {
  const key = SECTION_HEADER_KEYS[header.toLowerCase().trim()];
  return key ? t[key] : header;
}

/** Whether a biography label ("Aliases", "AKA", "Nicknames", ...) holds alternate names. */
export function isAliasSourceLabel(label: string): boolean {
  const lower = label.toLowerCase();
  return ALIAS_SOURCE_LABEL_TERMS.some(term => lower.includes(term));
}

/** Whether a stat label must be left out of the stats list because it's an alias line. */
export function isAliasStatLabel(lowerLabel: string): boolean {
  return ALIAS_SKIP_LABEL_TERMS.some(term => lowerLabel.includes(term));
}

export function buildRoleLabels(t: CharacterStrings): Record<string, string> {
  return {
    MAIN: t.role_main,
    SUPPORTING: t.role_supporting,
    BACKGROUND: t.role_background,
    CAMEO: t.role_cameo,
  };
}
