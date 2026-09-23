import { describe, expect, it } from 'vitest';
import { filterSections, matchesTerms, normalizeForSearch, queryTerms } from './guide-search';

describe('normalizeForSearch', () => {
  it('ignores case, accents and repeated whitespace', () => {
    expect(normalizeForSearch('  Canción   ÉPICA ')).toBe('cancion epica');
    expect(normalizeForSearch('Ça marche')).toBe('ca marche');
  });

  it('keeps scripts without diacritics untouched', () => {
    expect(normalizeForSearch('プレーヤー')).toBe('プレーヤー');
    expect(normalizeForSearch('Плеер')).toBe('плеер');
    expect(normalizeForSearch('Мой')).toBe('мой');
  });
});

describe('queryTerms / matchesTerms', () => {
  it('splits the query into normalised words', () => {
    expect(queryTerms('  Reproductor  VLC ')).toEqual(['reproductor', 'vlc']);
    expect(queryTerms('   ')).toEqual([]);
  });

  it('requires every word, in any order', () => {
    const haystack = normalizeForSearch('Emuladores y ROMs: carpeta de capturas');
    expect(matchesTerms(haystack, ['capturas', 'emuladores'])).toBe(true);
    expect(matchesTerms(haystack, ['capturas', 'steam'])).toBe(false);
  });
});

describe('filterSections', () => {
  const sections = [
    { id: 'player', text: 'Reproductor de vídeo libmpv VLC' },
    { id: 'roms', text: 'Emuladores y ROMs' },
    { id: 'reader', text: 'Leer cómics' },
  ];

  it('returns every section for an empty query', () => {
    expect(filterSections(sections, '')).toEqual(['player', 'roms', 'reader']);
  });

  it('matches accent-insensitively and keeps the input order', () => {
    expect(filterSections(sections, 'VIDEO')).toEqual(['player']);
    expect(filterSections(sections, 'comics')).toEqual(['reader']);
    expect(filterSections(sections, 'e')).toEqual(['player', 'roms', 'reader']);
  });

  it('returns nothing when a word is missing everywhere', () => {
    expect(filterSections(sections, 'roms steam')).toEqual([]);
  });
});
