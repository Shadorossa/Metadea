// Button glyphs for Big Picture's hint bar, per input device. The labels are
// the controllers' own printed symbols (brand data, not interface text), so
// they are not translated; keyboard keys use the usual key names.
import type { ControllerFamily } from './gamepad';

export type InputDevice = ControllerFamily | 'keyboard';

export type HintButton = 'confirm' | 'back' | 'details' | 'search' | 'menu' | 'tabs' | 'move';

export interface Glyph {
  label: string;
  /** Face-button colour class suffix (xbox green A, playstation blue cross…). */
  tone?: 'green' | 'red' | 'blue' | 'yellow' | 'pink';
}

const GLYPHS: Record<InputDevice, Record<HintButton, Glyph>> = {
  xbox: {
    confirm: { label: 'A', tone: 'green' },
    back: { label: 'B', tone: 'red' },
    details: { label: 'X', tone: 'blue' },
    search: { label: 'Y', tone: 'yellow' },
    menu: { label: '☰' },
    tabs: { label: 'LB RB' },
    move: { label: '✥' },
  },
  playstation: {
    confirm: { label: '✕', tone: 'blue' },
    back: { label: '○', tone: 'red' },
    details: { label: '□', tone: 'pink' },
    search: { label: '△', tone: 'green' },
    menu: { label: 'OPTIONS' },
    tabs: { label: 'L1 R1' },
    move: { label: '✥' },
  },
  // The standard mapping reports buttons by POSITION (index 0 = bottom), so
  // on a Nintendo pad the bottom button — printed "B" — confirms.
  nintendo: {
    confirm: { label: 'B' },
    back: { label: 'A' },
    details: { label: 'Y' },
    search: { label: 'X' },
    menu: { label: '+' },
    tabs: { label: 'L R' },
    move: { label: '✥' },
  },
  generic: {
    confirm: { label: '1' },
    back: { label: '2' },
    details: { label: '3' },
    search: { label: '4' },
    menu: { label: 'START' },
    tabs: { label: 'L1 R1' },
    move: { label: '✥' },
  },
  keyboard: {
    confirm: { label: 'Enter' },
    back: { label: 'Esc' },
    details: { label: 'I' },
    search: { label: 'S' },
    menu: { label: 'M' },
    tabs: { label: 'Q E' },
    move: { label: '← → ↑ ↓' },
  },
};

export function glyphFor(device: InputDevice, button: HintButton): Glyph {
  return GLYPHS[device][button];
}
