import { describe, it, expect } from 'vitest';
import { resolveLangCode } from './runtime';

describe('resolveLangCode', () => {
  it('prefers the language picked in Settings', () => {
    expect(resolveLangCode('ja', ['es-ES'])).toBe('ja');
  });

  it('ignores an unknown stored value and uses the system language', () => {
    expect(resolveLangCode('xx', ['fr-FR'])).toBe('fr');
  });

  it('matches the system language on its base code, in preference order', () => {
    expect(resolveLangCode(null, ['pt-BR', 'es-MX', 'en-US'])).toBe('es');
    expect(resolveLangCode(null, ['ca_ES'])).toBe('ca');
  });

  it('falls back to English when no system language is supported', () => {
    expect(resolveLangCode(null, ['pt-BR', 'ko-KR'])).toBe('en');
    expect(resolveLangCode(null, [])).toBe('en');
  });
});
