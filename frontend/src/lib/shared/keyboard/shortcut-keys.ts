// Key-combo parsing and normalisation for the shortcut registry. Pure and
// DOM-free (same idea as lib/player/keymap.ts, which resolves a plain key
// description instead of a KeyboardEvent) so every rule here is unit-tested.
//
// A spec is a lowercase `+`-joined combo: 'mod+k', 'ctrl+arrowright',
// 'alt+arrowleft', '/', '?', 'mod+,', 'shift+/'. `mod` is Ctrl on
// Windows/Linux and Meta (⌘) on macOS.

export interface ShortcutKeyInput {
  key: string;
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  metaKey?: boolean;
}

export interface ParsedShortcut {
  /** Normalised key name — 'k', 'arrowleft', 'space', 'escape', '?', '+'. */
  key: string;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  meta: boolean;
}

export interface ShortcutPlatform {
  isMac: boolean;
}

const MODIFIER_ALIASES: Record<string, 'ctrl' | 'alt' | 'shift' | 'meta' | 'mod'> = {
  ctrl: 'ctrl', control: 'ctrl',
  alt: 'alt', option: 'alt', opt: 'alt',
  shift: 'shift',
  meta: 'meta', cmd: 'meta', command: 'meta', win: 'meta', super: 'meta',
  mod: 'mod',
};

// Older/alternate KeyboardEvent.key spellings folded into the canonical
// lowercase name a spec uses.
const KEY_ALIASES: Record<string, string> = {
  ' ': 'space',
  spacebar: 'space',
  esc: 'escape',
  del: 'delete',
  return: 'enter',
  left: 'arrowleft',
  right: 'arrowright',
  up: 'arrowup',
  down: 'arrowdown',
};

/** Canonical lowercase name for a KeyboardEvent.key value or a spec token. */
export function normalizeKeyName(key: string): string {
  const lower = key.length === 1 ? key.toLowerCase() : key.trim().toLowerCase();
  return KEY_ALIASES[lower] ?? lower;
}

// Splits on `+` while letting a bare `+` be the key itself ('+', 'mod++').
function tokenizeSpec(spec: string): string[] {
  const tokens: string[] = [];
  let buffer = '';
  for (const ch of spec) {
    if (ch === '+' && buffer.length > 0) {
      tokens.push(buffer);
      buffer = '';
    } else {
      buffer += ch;
    }
  }
  tokens.push(buffer);
  return tokens;
}

export function parseShortcut(spec: string, platform: ShortcutPlatform): ParsedShortcut {
  const tokens = tokenizeSpec(spec.trim().toLowerCase());
  const parsed: ParsedShortcut = { key: '', ctrl: false, alt: false, shift: false, meta: false };
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const modifier = i < tokens.length - 1 ? MODIFIER_ALIASES[token] : undefined;
    if (modifier === 'mod') {
      if (platform.isMac) parsed.meta = true;
      else parsed.ctrl = true;
    } else if (modifier) {
      parsed[modifier] = true;
    } else if (i === tokens.length - 1) {
      parsed.key = normalizeKeyName(token);
    } else {
      throw new Error(`Invalid shortcut spec "${spec}": unknown modifier "${token}"`);
    }
  }
  if (!parsed.key) throw new Error(`Invalid shortcut spec "${spec}": no key`);
  return parsed;
}

// Punctuation keys carry their own shift state in KeyboardEvent.key ('?' is
// Shift+/ on a US layout, Shift+' on a Spanish one) — comparing shiftKey
// for those would make '?' unmatchable on some layouts and '/' ambiguous.
// Letters and digits keep the comparison so 'k' and 'shift+k' stay distinct.
function isShiftAgnosticKey(key: string): boolean {
  return key.length === 1 && !/[a-z0-9]/i.test(key);
}

export function matchesShortcut(parsed: ParsedShortcut, input: ShortcutKeyInput): boolean {
  if (normalizeKeyName(input.key) !== parsed.key) return false;
  if (!!input.ctrlKey !== parsed.ctrl) return false;
  if (!!input.altKey !== parsed.alt) return false;
  if (!!input.metaKey !== parsed.meta) return false;
  if (!isShiftAgnosticKey(parsed.key) && !!input.shiftKey !== parsed.shift) return false;
  return true;
}

const KEY_CAP_LABELS: Record<string, string> = {
  arrowleft: '←',
  arrowright: '→',
  arrowup: '↑',
  arrowdown: '↓',
  space: 'Space',
  escape: 'Esc',
  enter: 'Enter',
  tab: 'Tab',
  backspace: '⌫',
  delete: 'Del',
  home: 'Home',
  end: 'End',
  pageup: 'PgUp',
  pagedown: 'PgDn',
};

/** Key-cap labels for a spec, in display order (modifiers first):
 *  'mod+k' → ['Ctrl', 'K'] on Windows/Linux, ['⌘', 'K'] on macOS. */
export function formatShortcutKeys(spec: string, platform: ShortcutPlatform): string[] {
  const parsed = parseShortcut(spec, platform);
  const caps: string[] = [];
  if (parsed.ctrl) caps.push(platform.isMac ? '⌃' : 'Ctrl');
  if (parsed.alt) caps.push(platform.isMac ? '⌥' : 'Alt');
  if (parsed.shift) caps.push(platform.isMac ? '⇧' : 'Shift');
  if (parsed.meta) caps.push(platform.isMac ? '⌘' : 'Win');
  const label = KEY_CAP_LABELS[parsed.key] ?? (parsed.key.length === 1 ? parsed.key.toUpperCase() : parsed.key);
  caps.push(label);
  return caps;
}
