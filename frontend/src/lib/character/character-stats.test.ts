import { describe, expect, it } from 'vitest';
import { es } from '../../i18n/es';
import {
  buildCharacterStatRows,
  formatBirthday,
  parseStatItems,
  splitStatValue,
  stripTags,
} from './character-stats';

const t = es.character;

describe('parseStatItems', () => {
  it('splits comma lists, but not when a parenthetical is present', () => {
    expect(parseStatItems('Blue, Green')).toEqual(['Blue', 'Green']);
    expect(parseStatItems('Straw Hat Pirates (Captain), Marines')).toEqual(['Straw Hat Pirates (Captain), Marines']);
  });

  it('turns list markup and line breaks into items and drops <small> wrappers', () => {
    expect(parseStatItems('<ul><li>A</li><li>B</li></ul>')).toEqual(['A', 'B']);
    expect(parseStatItems('A<br>B<br/>C\nD')).toEqual(['A', 'B', 'C', 'D']);
    expect(parseStatItems('<small>180 cm</small>')).toEqual(['180 cm']);
    expect(parseStatItems('  ')).toEqual([]);
  });
});

describe('splitStatValue', () => {
  it('separates a trailing parenthetical into a sub line', () => {
    expect(splitStatValue('180 cm (after timeskip)')).toEqual({ main: '180 cm', sub: '(after timeskip)' });
    expect(splitStatValue('<small>180 cm</small> (pre)')).toEqual({ main: '180 cm', sub: '(pre)' });
  });

  it('keeps a value that is only a parenthetical, or has none, on the main line', () => {
    expect(splitStatValue('(unknown)')).toEqual({ main: '(unknown)', sub: null });
    expect(splitStatValue('<b>Blue</b>')).toEqual({ main: '<b>Blue</b>', sub: null });
  });
});

describe('stripTags / formatBirthday', () => {
  it('reduces inline markup to its text for title attributes', () => {
    expect(stripTags('<a href="x">Straw Hat</a> <b>Pirates</b>')).toBe('Straw Hat Pirates');
  });

  it('formats day/month with an optional year and ? placeholders', () => {
    expect(formatBirthday({ year: null, month: 5, day: 5 })).toBe('5/5');
    expect(formatBirthday({ year: 1999, month: 12, day: null })).toBe('?/12/1999');
  });
});

describe('buildCharacterStatRows', () => {
  const structured = { gender: 'Male', age: '17', bloodType: null, dateOfBirth: { year: null, month: 5, day: 5 } };

  it('puts AniList structured fields first and skips duplicated or alias biography lines', () => {
    const rows = buildCharacterStatRows(structured, [
      { label: 'Height [Physical Description]', value: '<small>174 cm</small> (post-timeskip)' },
      { label: 'Eyes', value: 'Black' },
      { label: 'Affiliations', value: 'Straw Hat Pirates<br>Ninja Pirates' },
      { label: 'Age', value: '19' },
      { label: 'Aliases', value: 'Straw Hat' },
      { label: 'Devil Fruit', value: 'Gomu Gomu no Mi' },
    ], t);
    expect(rows).toEqual([
      { kind: 'stat', label: t.stat_gender, items: ['Male'] },
      { kind: 'stat', label: t.stat_age, items: ['17'] },
      { kind: 'stat', label: t.stat_birthday, items: ['5/5'] },
      { kind: 'header', label: t.section_physical },
      { kind: 'stat', label: t.stat_height, items: ['174 cm (post-timeskip)'] },
      { kind: 'stat', label: t.stat_eyes, items: ['Black'] },
      { kind: 'stat', label: t.stat_affiliation, items: ['Straw Hat Pirates', 'Ninja Pirates'] },
      { kind: 'stat', label: 'Devil Fruit', items: ['Gomu Gomu no Mi'] },
    ]);
  });

  it('folds a bare section-name line into the section that follows and emits one header per run', () => {
    const rows = buildCharacterStatRows({ gender: null, age: null, bloodType: 'O', dateOfBirth: null }, [
      { label: 'Physical Description', value: 'Tall' },
      { label: 'Hair [Physical Description]', value: 'Black' },
      { label: 'Weight [Physical Description]', value: '60 kg' },
      { label: 'Occupation [Career and Family]', value: 'Pirate' },
      { label: 'Blood Type', value: 'F' },
      { label: 'Status', value: 'Alive' },
    ], t);
    expect(rows).toEqual([
      { kind: 'stat', label: t.stat_blood_type, items: ['O'] },
      { kind: 'header', label: t.section_physical },
      { kind: 'stat', label: 'Physical Description', items: ['Tall'] },
      { kind: 'stat', label: t.stat_hair, items: ['Black'] },
      { kind: 'stat', label: t.stat_weight, items: ['60 kg'] },
      { kind: 'header', label: t.section_career_family },
      { kind: 'stat', label: t.stat_occupation, items: ['Pirate'] },
      // "blood type" (with a space) is not the dedupe key AniList's own
      // field registers ("bloodtype"), so the biography line still shows.
      { kind: 'stat', label: t.stat_blood_type, items: ['F'] },
      { kind: 'stat', label: t.stat_status, items: ['Alive'] },
    ]);
  });

  it('drops a stat whose value parses to nothing and keeps the first of two same-label lines', () => {
    const rows = buildCharacterStatRows({ gender: null, age: null, bloodType: null, dateOfBirth: { year: 2000, month: null, day: null } }, [
      { label: 'Hair', value: '<br>' },
      { label: 'Eyes', value: 'Blue' },
      { label: 'Eye color', value: 'Green' },
    ], t);
    expect(rows).toEqual([
      { kind: 'stat', label: t.stat_eyes, items: ['Blue'] },
      { kind: 'stat', label: t.stat_eyes, items: ['Green'] },
    ]);
  });
});
