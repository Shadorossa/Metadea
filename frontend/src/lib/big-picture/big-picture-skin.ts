// Big Picture's look (Settings › Appearance): the default Metadea layout or
// a PS5-style home screen — the PS5 skin is inspired by PS5ish, David
// Griggs' Playnite fullscreen theme (https://github.com/davidkgriggs/PS5ish,
// MIT); nothing of it is copied, the look is recreated in CSS
// (styles/pages/local/big-picture-ps5.css). Device-level, like the other
// Big Picture preferences: a storage failure falls back to the default.
import { STORAGE_KEYS } from '../storage/storage-keys';
import { defaultStorage, type StorageLike } from './big-picture-preferences';

export type BigPictureSkin = 'default' | 'ps5';

/** Picker order (Settings › Appearance). */
export const BIG_PICTURE_SKINS: readonly BigPictureSkin[] = ['default', 'ps5'];

export const DEFAULT_BIG_PICTURE_SKIN: BigPictureSkin = 'default';

export function isBigPictureSkin(value: unknown): value is BigPictureSkin {
  return typeof value === 'string' && (BIG_PICTURE_SKINS as readonly string[]).includes(value);
}

export function parseBigPictureSkin(raw: string | null | undefined): BigPictureSkin {
  return isBigPictureSkin(raw) ? raw : DEFAULT_BIG_PICTURE_SKIN;
}

export function readBigPictureSkin(storage: StorageLike | null = defaultStorage()): BigPictureSkin {
  try {
    return parseBigPictureSkin(storage?.getItem(STORAGE_KEYS.bigPictureSkin));
  } catch {
    return DEFAULT_BIG_PICTURE_SKIN;
  }
}

export function writeBigPictureSkin(skin: BigPictureSkin, storage: StorageLike | null = defaultStorage()): BigPictureSkin {
  const next = parseBigPictureSkin(skin);
  try {
    storage?.setItem(STORAGE_KEYS.bigPictureSkin, next);
  } catch {}
  return next;
}
