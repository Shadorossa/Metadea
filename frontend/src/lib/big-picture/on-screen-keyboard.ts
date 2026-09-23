// The on-screen keyboard of Big Picture's search: a grid of keys navigated
// with the focus grid (rows of different length — the action row is short).
// Character keys are data; the action keys carry an id the view translates.

export type KeyboardKey =
  | { kind: 'char'; value: string }
  | { kind: 'space' }
  | { kind: 'delete' }
  | { kind: 'clear' }
  | { kind: 'done' };

const CHAR_ROWS = ['1234567890', 'qwertyuiop', 'asdfghjkl', 'zxcvbnm'];

export const ON_SCREEN_KEYBOARD: readonly (readonly KeyboardKey[])[] = [
  ...CHAR_ROWS.map(row => [...row].map((value): KeyboardKey => ({ kind: 'char', value }))),
  [{ kind: 'space' }, { kind: 'delete' }, { kind: 'clear' }, { kind: 'done' }],
];

export const MAX_QUERY_LENGTH = 60;

/** The query after pressing `key` ('done' leaves it unchanged). */
export function applyKeyboardKey(query: string, key: KeyboardKey): string {
  switch (key.kind) {
    case 'char': return (query + key.value).slice(0, MAX_QUERY_LENGTH);
    case 'space': return query.length === 0 || query.endsWith(' ') ? query : (query + ' ').slice(0, MAX_QUERY_LENGTH);
    case 'delete': return query.slice(0, -1);
    case 'clear': return '';
    case 'done': return query;
  }
}
