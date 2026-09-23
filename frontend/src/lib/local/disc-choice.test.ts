import { describe, it, expect } from 'vitest';
import { isMultiDisc, launchDiscChoice, rememberDisc, rememberedDisc, type StorageLike } from './disc-choice';

function memory(): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: key => data.get(key) ?? null, setItem: (key, value) => { data.set(key, value); } };
}

const ff7 = {
  app_id: 'rom_ff7',
  discs: ['C:/Roms/FF7 (Disc 1).chd', 'C:/Roms/FF7 (Disc 2).chd', 'C:/Roms/FF7 (Disc 3).chd'],
  disc_playlist: 'C:/Roms/FF7.m3u',
};

describe('disc choice', () => {
  it('only applies to games with more than one disc', () => {
    expect(isMultiDisc({ discs: [] })).toBe(false);
    expect(isMultiDisc({ discs: ['a'] })).toBe(false);
    expect(isMultiDisc(ff7)).toBe(true);
    expect(launchDiscChoice({ app_id: 'x', discs: undefined }, null, memory())).toBeNull();
  });

  it('boots the first disc until another one is picked, then remembers it per game', () => {
    const storage = memory();
    expect(rememberedDisc(ff7, storage)).toBe(ff7.discs[0]);
    rememberDisc(ff7.app_id, ff7.discs[1], storage);
    expect(rememberedDisc(ff7, storage)).toBe(ff7.discs[1]);
    expect(rememberedDisc({ ...ff7, app_id: 'rom_other' }, storage)).toBe(ff7.discs[0]);
    expect(launchDiscChoice(ff7, null, storage)).toEqual({ discPath: ff7.discs[1], discPlaylist: ff7.disc_playlist });
    expect(launchDiscChoice(ff7, ff7.discs[2], storage)?.discPath).toBe(ff7.discs[2]);
  });

  it('ignores a remembered disc that is no longer part of the set and broken storage', () => {
    const storage = memory();
    rememberDisc(ff7.app_id, 'C:/Roms/gone.chd', storage);
    expect(rememberedDisc(ff7, storage)).toBe(ff7.discs[0]);
    storage.data.set('metadea_rom_disc_choice', '{not json');
    expect(rememberedDisc(ff7, storage)).toBe(ff7.discs[0]);
    expect(rememberedDisc(ff7, null)).toBe(ff7.discs[0]);
  });
});
