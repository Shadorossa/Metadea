import { describe, expect, it } from 'vitest';
import { hidesMusicCompanies, isMusicCompany, normalizeCompanyName, partitionMusicCompanies } from './company-classification';

describe('normalizeCompanyName', () => {
  it('drops punctuation, accents and corporate suffixes', () => {
    expect(normalizeCompanyName('King Records Co., Ltd.')).toBe('king records');
    expect(normalizeCompanyName('  Flying  DOG, Inc. ')).toBe('flying dog');
    expect(normalizeCompanyName('Pokémon')).toBe('pokemon');
    expect(normalizeCompanyName("Toy's Factory")).toBe('toy s factory');
  });
});

describe('isMusicCompany', () => {
  it.each([
    'Lantis',
    'Flying DOG',
    'Sony Music Entertainment',
    'Sony Music Entertainment (Japan) Inc.',
    'King Records',
    'Pony Canyon',
    'Victor Entertainment',
    'JVCKENWOOD Victor Entertainment',
    'Starchild Records',
    'avex',
    'Avex Entertainment',
    'Warner Music Japan',
    'Nippon Columbia',
    'Toho Animation Records',
    "Toy's Factory",
    'Being',
    'SACRA MUSIC',
    // Heuristic: whole-word keywords.
    'DMM music',
    'Kadokawa Music',
    'Some Recordings',
    'Tokyo Audio',
  ])('flags %s', name => {
    expect(isMusicCompany(name)).toBe(true);
  });

  it.each([
    'Aniplex',
    'Kadokawa',
    'Kadokawa Media House',
    'NBCUniversal Entertainment Japan',
    'Geneon Universal Entertainment',
    'Warner Bros. Japan',
    'Avex Pictures',
    'TOHO animation',
    'Bandai Namco Arts',
    'Shueisha',
    'Movic',
    'MAPPA',
    'Madhouse',
    // Keyword traps: only whole words count.
    'Soundrop',
    'Audiovisual Works',
    'Recorded Picture Company',
    'Musashino Pictures',
    'Labelled Films',
    // Explicit exceptions.
    'Audio Planning U',
    'Sound Team Don Juan',
    '',
  ])('leaves %s alone', name => {
    expect(isMusicCompany(name)).toBe(false);
  });

  it('handles missing names', () => {
    expect(isMusicCompany(null)).toBe(false);
    expect(isMusicCompany(undefined)).toBe(false);
  });
});

describe('partitionMusicCompanies', () => {
  it('keeps order within each side', () => {
    const credits = [{ name: 'Aniplex' }, { name: 'Lantis' }, { name: 'Kadokawa' }, { name: 'King Records' }];
    const { shown, music } = partitionMusicCompanies(credits);
    expect(shown.map(c => c.name)).toEqual(['Aniplex', 'Kadokawa']);
    expect(music.map(c => c.name)).toEqual(['Lantis', 'King Records']);
  });

  it('only applies to AniList-credited media', () => {
    expect(hidesMusicCompanies('anime')).toBe(true);
    expect(hidesMusicCompanies('manga')).toBe(true);
    expect(hidesMusicCompanies('game')).toBe(false);
  });
});
