// Whether the controller pause menu is on screen. Big Picture reads it so
// its own Start+Select shortcut does not fire while the combo that opened
// the menu is still held (components/big-picture/BigPictureMode.tsx).
import { createExternalStore } from '../shared/state/external-store';

export const gamePauseOpenStore = createExternalStore<boolean>(false);
