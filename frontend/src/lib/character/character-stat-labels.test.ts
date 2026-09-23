import { describe, expect, it } from 'vitest';
import { es } from '../../i18n/es';
import {
  SECTION_HEADER_KEYS,
  STAT_LABEL_ALIASES,
  buildRoleLabels,
  buildStatLabelMap,
  formatSectionHeader,
  isAliasSourceLabel,
  isAliasStatLabel,
  resolveStatLabel,
} from './character-stat-labels';

const t = es.character;

describe('STAT_LABEL_ALIASES', () => {
  it('keeps every alias of the former character.astro table', () => {
    const all = STAT_LABEL_ALIASES.flatMap(([aliases]) => [...aliases]);
    expect(all).toEqual([
      'height', 'estatura', 'altura',
      'weight', 'peso',
      'hair color', 'hair', 'color de pelo', 'pelo', 'cabello',
      'eye color', 'eyes', 'eye colour', 'color de ojos', 'ojos',
      'affiliations', 'affiliation',
      'bounty', 'recompensa',
      'gender', 'sex', 'género', 'sexo',
      'age', 'edad',
      'status', 'estado',
      'nationality', 'nacionalidad',
      'ethnicity', 'etnia',
      'born', 'birth date', 'date of birth', 'nacimiento', 'fecha de nacimiento',
      'died', 'death date', 'date of death', 'fallecimiento', 'muerte',
      'occupation', 'occupations', 'ocupación', 'profesión',
      'notable family', 'family', 'familia', 'relatives', 'parientes',
      'friends', 'amigos', 'friend',
      'affiliates', 'afiliados', 'colleagues', 'colegas', 'asociados', 'associates',
      'blood type', 'bloodtype', 'grupo sanguíneo',
      'birthday', 'cumpleaños',
      'created by', 'creador', 'creado por',
      'designed by', 'diseño', 'diseñado por',
      'main appearance(s)', 'appearances', 'apariciones',
    ]);
    expect(new Set(all).size).toBe(all.length);
  });

  it('maps every alias onto an existing translated label', () => {
    const map = buildStatLabelMap(t);
    for (const [aliases, key] of STAT_LABEL_ALIASES) {
      for (const alias of aliases) expect(map.get(alias)).toBe(t[key]);
    }
    expect(map.get('estatura')).toBe('Estatura');
    expect(map.get('grupo sanguíneo')).toBe('Grupo Sanguíneo');
  });
});

describe('resolveStatLabel', () => {
  it('resolves exact aliases in either language', () => {
    expect(resolveStatLabel('height', t)).toBe(t.stat_height);
    expect(resolveStatLabel('ojos', t)).toBe(t.stat_eyes);
    expect(resolveStatLabel('main appearance(s)', t)).toBe(t.stat_appearances);
  });

  it('applies the affiliation prefix rule for the suffixes wikis vary on', () => {
    expect(resolveStatLabel('affiliation(s)', t)).toBe(t.stat_affiliation);
    expect(resolveStatLabel('afiliaciones', t)).toBe(t.stat_affiliation);
    expect(resolveStatLabel('afiliación', t)).toBe(t.stat_affiliation);
    // exact-alias hits still win over the prefix rule
    expect(resolveStatLabel('affiliates', t)).toBe(t.stat_affiliates);
  });

  it('leaves unknown labels unresolved so the raw label shows', () => {
    expect(resolveStatLabel('devil fruit', t)).toBeUndefined();
    expect(resolveStatLabel('', t)).toBeUndefined();
  });
});

describe('formatSectionHeader', () => {
  it('translates known section names case-insensitively and keeps unknown ones', () => {
    expect(formatSectionHeader('Physical Description', t)).toBe(t.section_physical);
    expect(formatSectionHeader('  descripción física ', t)).toBe(t.section_physical);
    expect(formatSectionHeader('Behind the Scenes', t)).toBe(t.section_behind_scenes);
    expect(formatSectionHeader('Relationships', t)).toBe(t.section_associates);
    expect(formatSectionHeader('Trivia', t)).toBe('Trivia');
  });

  it('keeps every section alias of the former table', () => {
    expect(Object.keys(SECTION_HEADER_KEYS)).toEqual([
      'physical description', 'descripción física',
      'career and family information', 'career and family', 'carrera y familia', 'información profesional',
      'associates', 'asociados', 'relaciones', 'relationships',
      'behind the scenes', 'detrás de las cámaras', 'producción',
      'personal information', 'información personal',
    ]);
  });
});

describe('alias label detection', () => {
  it('treats title lines as alias sources but still lists them as stats', () => {
    expect(isAliasSourceLabel('Title')).toBe(true);
    expect(isAliasStatLabel('title')).toBe(false);
    // "nicknames" contains "name", so it is both a source and skipped.
    expect(isAliasSourceLabel('Nicknames')).toBe(true);
    expect(isAliasStatLabel('nicknames')).toBe(true);
  });

  it('flags alias/aka/name/nombre lines in both roles', () => {
    for (const label of ['Aliases', 'AKA', 'Full Name', 'Nombre completo']) {
      expect(isAliasSourceLabel(label)).toBe(true);
      expect(isAliasStatLabel(label.toLowerCase())).toBe(true);
    }
    expect(isAliasSourceLabel('Height')).toBe(false);
    expect(isAliasStatLabel('height')).toBe(false);
  });
});

describe('buildRoleLabels', () => {
  it('maps AniList character roles onto translated labels', () => {
    expect(buildRoleLabels(t)).toEqual({
      MAIN: t.role_main,
      SUPPORTING: t.role_supporting,
      BACKGROUND: t.role_background,
      CAMEO: t.role_cameo,
    });
  });
});
