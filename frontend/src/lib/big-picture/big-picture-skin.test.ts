import { describe, expect, it } from 'vitest';
import {
  BIG_PICTURE_SKINS, DEFAULT_BIG_PICTURE_SKIN, parseBigPictureSkin, readBigPictureSkin, writeBigPictureSkin,
} from './big-picture-skin';
import { STORAGE_KEYS } from '../storage/storage-keys';

const memory = () => {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => { data.set(k, v); },
  };
};

describe('big picture skin preference', () => {
  it('defaults to the current look', () => {
    expect(DEFAULT_BIG_PICTURE_SKIN).toBe('default');
    expect(readBigPictureSkin(memory())).toBe('default');
    expect(readBigPictureSkin(null)).toBe('default');
    expect(BIG_PICTURE_SKINS).toEqual(['default', 'ps5']);
  });

  it('parses only known skins', () => {
    expect(parseBigPictureSkin('ps5')).toBe('ps5');
    expect(parseBigPictureSkin('default')).toBe('default');
    expect(parseBigPictureSkin('xbox')).toBe('default');
    expect(parseBigPictureSkin('')).toBe('default');
    expect(parseBigPictureSkin(null)).toBe('default');
  });

  it('writes and reads back under its storage key', () => {
    const storage = memory();
    expect(writeBigPictureSkin('ps5', storage)).toBe('ps5');
    expect(storage.data.get(STORAGE_KEYS.bigPictureSkin)).toBe('ps5');
    expect(readBigPictureSkin(storage)).toBe('ps5');
    writeBigPictureSkin('default', storage);
    expect(readBigPictureSkin(storage)).toBe('default');
  });

  it('survives a storage that throws', () => {
    const broken = {
      getItem: () => { throw new Error('denied'); },
      setItem: () => { throw new Error('denied'); },
    };
    expect(readBigPictureSkin(broken)).toBe('default');
    expect(writeBigPictureSkin('ps5', broken)).toBe('ps5');
  });
});
