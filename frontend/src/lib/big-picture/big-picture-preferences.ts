// Big Picture preferences (device-level, localStorage): whether the app
// starts in Big Picture (optionally only when a controller is connected),
// and the navigation-sound toggle of its Start menu. Storage failures fall
// back to the defaults — none of this is user data.
import { STORAGE_KEYS } from '../storage/storage-keys';

export interface BigPicturePreferences {
  startInBigPicture: boolean;
  /** With startInBigPicture: only enter once a controller is detected. */
  startOnlyWithController: boolean;
  navigationSounds: boolean;
}

export const DEFAULT_BIG_PICTURE_PREFERENCES: BigPicturePreferences = {
  startInBigPicture: false,
  startOnlyWithController: false,
  navigationSounds: false,
};

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function defaultStorage(): StorageLike | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function parseBigPicturePreferences(raw: string | null): BigPicturePreferences {
  if (!raw) return { ...DEFAULT_BIG_PICTURE_PREFERENCES };
  try {
    const value = JSON.parse(raw) as Partial<Record<keyof BigPicturePreferences, unknown>>;
    return {
      startInBigPicture: value.startInBigPicture === true,
      startOnlyWithController: value.startOnlyWithController === true,
      navigationSounds: value.navigationSounds === true,
    };
  } catch {
    return { ...DEFAULT_BIG_PICTURE_PREFERENCES };
  }
}

export function readBigPicturePreferences(storage: StorageLike | null = defaultStorage()): BigPicturePreferences {
  try {
    return parseBigPicturePreferences(storage?.getItem(STORAGE_KEYS.bigPicturePreferences) ?? null);
  } catch {
    return { ...DEFAULT_BIG_PICTURE_PREFERENCES };
  }
}

export function writeBigPicturePreferences(
  patch: Partial<BigPicturePreferences>,
  storage: StorageLike | null = defaultStorage(),
): BigPicturePreferences {
  const next = { ...readBigPicturePreferences(storage), ...patch };
  try {
    storage?.setItem(STORAGE_KEYS.bigPicturePreferences, JSON.stringify(next));
  } catch {}
  return next;
}

/** Query value /local reads to open straight into Big Picture: `on`, or
 *  `pad` to wait for a controller first. */
export const BIG_PICTURE_START_PARAM = 'bigpicture';

/** Where the app's entry page should send the user when Big Picture is set
 *  to start with the app, or null to keep the normal destination. */
export function bigPictureStartPath(prefs: BigPicturePreferences): string | null {
  if (!prefs.startInBigPicture) return null;
  return `/local?${BIG_PICTURE_START_PARAM}=${prefs.startOnlyWithController ? 'pad' : 'on'}`;
}
