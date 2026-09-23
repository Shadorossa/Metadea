import { describe, it, expect } from 'vitest';
import { steamLanguageForLocale } from './steam';

describe('steamLanguageForLocale', () => {
  it('maps every app locale to a Steam Web API language', () => {
    expect(steamLanguageForLocale('en')).toBe('english');
    expect(steamLanguageForLocale('es')).toBe('spanish');
    expect(steamLanguageForLocale('ca')).toBe('spanish');
    expect(steamLanguageForLocale('de')).toBe('german');
    expect(steamLanguageForLocale('fr')).toBe('french');
    expect(steamLanguageForLocale('it')).toBe('italian');
    expect(steamLanguageForLocale('ja')).toBe('japanese');
    expect(steamLanguageForLocale('ru')).toBe('russian');
  });

  it('falls back to English for anything else', () => {
    expect(steamLanguageForLocale('pt')).toBe('english');
    expect(steamLanguageForLocale('')).toBe('english');
  });
});
