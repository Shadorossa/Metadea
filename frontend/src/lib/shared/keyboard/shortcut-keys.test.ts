import { describe, it, expect } from 'vitest';
import { formatShortcutKeys, matchesShortcut, normalizeKeyName, parseShortcut } from './shortcut-keys';

const WIN = { isMac: false };
const MAC = { isMac: true };

describe('parseShortcut', () => {
  it('resolves mod per platform', () => {
    expect(parseShortcut('mod+k', WIN)).toEqual({ key: 'k', ctrl: true, alt: false, shift: false, meta: false });
    expect(parseShortcut('mod+k', MAC)).toEqual({ key: 'k', ctrl: false, alt: false, shift: false, meta: true });
  });

  it('accepts modifier aliases and arrow keys in any case', () => {
    expect(parseShortcut('Ctrl+ArrowRight', WIN)).toEqual({ key: 'arrowright', ctrl: true, alt: false, shift: false, meta: false });
    expect(parseShortcut('option+left', MAC).alt).toBe(true);
    expect(parseShortcut('cmd+shift+k', MAC)).toEqual({ key: 'k', ctrl: false, alt: false, shift: true, meta: true });
  });

  it('treats a bare "+" and punctuation as keys', () => {
    expect(parseShortcut('+', WIN).key).toBe('+');
    expect(parseShortcut('mod++', WIN)).toEqual({ key: '+', ctrl: true, alt: false, shift: false, meta: false });
    expect(parseShortcut('mod+,', WIN).key).toBe(',');
    expect(parseShortcut('?', WIN)).toEqual({ key: '?', ctrl: false, alt: false, shift: false, meta: false });
    expect(parseShortcut('/', WIN).key).toBe('/');
  });

  it('rejects unknown modifiers and empty keys', () => {
    expect(() => parseShortcut('hyper+k', WIN)).toThrow();
    expect(() => parseShortcut('ctrl+', WIN)).toThrow();
    expect(() => parseShortcut('', WIN)).toThrow();
  });
});

describe('normalizeKeyName', () => {
  it('folds legacy spellings and space into canonical names', () => {
    expect(normalizeKeyName(' ')).toBe('space');
    expect(normalizeKeyName('Spacebar')).toBe('space');
    expect(normalizeKeyName('Esc')).toBe('escape');
    expect(normalizeKeyName('ArrowLeft')).toBe('arrowleft');
    expect(normalizeKeyName('K')).toBe('k');
    expect(normalizeKeyName('?')).toBe('?');
  });
});

describe('matchesShortcut', () => {
  it('matches exact modifier sets for letters', () => {
    const modK = parseShortcut('mod+k', WIN);
    expect(matchesShortcut(modK, { key: 'k', ctrlKey: true })).toBe(true);
    expect(matchesShortcut(modK, { key: 'K', ctrlKey: true })).toBe(true);
    expect(matchesShortcut(modK, { key: 'k' })).toBe(false);
    expect(matchesShortcut(modK, { key: 'k', ctrlKey: true, shiftKey: true })).toBe(false);
    expect(matchesShortcut(modK, { key: 'k', metaKey: true })).toBe(false);
  });

  it('keeps k and shift+k distinct', () => {
    expect(matchesShortcut(parseShortcut('k', WIN), { key: 'K', shiftKey: true })).toBe(false);
    expect(matchesShortcut(parseShortcut('shift+k', WIN), { key: 'K', shiftKey: true })).toBe(true);
  });

  it('ignores shift for punctuation so ? and / work on every layout', () => {
    const question = parseShortcut('?', WIN);
    const slash = parseShortcut('/', WIN);
    expect(matchesShortcut(question, { key: '?', shiftKey: true })).toBe(true);
    expect(matchesShortcut(question, { key: '?' })).toBe(true);
    expect(matchesShortcut(question, { key: '/' })).toBe(false);
    expect(matchesShortcut(slash, { key: '/' })).toBe(true);
    expect(matchesShortcut(slash, { key: '?', shiftKey: true })).toBe(false);
    expect(matchesShortcut(parseShortcut('+', WIN), { key: '+', shiftKey: true })).toBe(true);
  });

  it('matches arrows with alt/ctrl combos', () => {
    expect(matchesShortcut(parseShortcut('alt+arrowleft', WIN), { key: 'ArrowLeft', altKey: true })).toBe(true);
    expect(matchesShortcut(parseShortcut('alt+arrowleft', WIN), { key: 'ArrowLeft' })).toBe(false);
    expect(matchesShortcut(parseShortcut('ctrl+arrowright', WIN), { key: 'ArrowRight', ctrlKey: true })).toBe(true);
  });
});

describe('formatShortcutKeys', () => {
  it('renders key caps per platform', () => {
    expect(formatShortcutKeys('mod+k', WIN)).toEqual(['Ctrl', 'K']);
    expect(formatShortcutKeys('mod+k', MAC)).toEqual(['⌘', 'K']);
    expect(formatShortcutKeys('alt+arrowleft', WIN)).toEqual(['Alt', '←']);
    expect(formatShortcutKeys('?', WIN)).toEqual(['?']);
    expect(formatShortcutKeys('escape', WIN)).toEqual(['Esc']);
    expect(formatShortcutKeys('mod+,', WIN)).toEqual(['Ctrl', ',']);
  });
});
