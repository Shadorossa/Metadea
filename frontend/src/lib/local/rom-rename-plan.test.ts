import { describe, it, expect } from 'vitest';
import { buildRomRenamePlan, cleanStemFor } from './rom-rename-plan';
import type { RomFile, RomGame, RomScanResult } from '../tauri/roms';

function file(dir: string, name: string, kind: RomFile['kind'] = 'base', sidecars: string[] = []): RomFile {
  const dot = name.lastIndexOf('.');
  return {
    path: `${dir}${name}`,
    file_name: name,
    stem: name.slice(0, dot),
    extension: name.slice(dot + 1),
    kind,
    sidecars: sidecars.map(s => `${dir}${s}`),
  };
}

function game(platform_id: string, base: RomFile, extra: Partial<RomGame> = {}): RomGame {
  return { platform_id, app_id: `rom_${base.stem}`, base, updates: [], dlc: [], ...extra };
}

const scan = (games: RomGame[]): RomScanResult => ({ games, folders: [] });

describe('cleanStemFor', () => {
  it('keeps the title id (and DLC name / update version) for Switch only', () => {
    expect(cleanStemFor(file('D:\\Switch\\', 'Fire Emblem™꞉ Three Houses [010055D009F78000][v0][Base].nsp'), 'switch'))
      .toBe('Fire Emblem - Three Houses [010055D009F78000]');
    expect(cleanStemFor(file('D:\\Switch\\', 'Pokemon Scarlet [New Uniform Set] [0100A3D008C5D001][v0][DLC].nsp', 'dlc'), 'switch'))
      .toBe('Pokemon Scarlet [New Uniform Set] [0100A3D008C5D001]');
    expect(cleanStemFor(file('D:\\Switch\\', 'Pokémon Scarlet [0100A3D008C5C800][v786432][US](nsw2u.com).nsp', 'update'), 'switch'))
      .toBe('Pokémon Scarlet [0100A3D008C5C800][v786432]');
    expect(cleanStemFor(file('D:\\Wii\\', 'Fire Emblem - Radiant Dawn (Europe) (En,Fr,De,Es,It) (Rev 1).rvz'), 'wii'))
      .toBe('Fire Emblem - Radiant Dawn');
  });
});

describe('buildRomRenamePlan', () => {
  it('renames tagged files with their sidecars and leaves clean ones alone', () => {
    const ds = game('ds', file('C:\\Roms\\Nintendo DS\\', '5288 - Profesor Layton y el Futuro Perdido, El (Spain).nds', 'base', [
      '5288 - Profesor Layton y el Futuro Perdido, El (Spain).sav',
      '5288 - Profesor Layton y el Futuro Perdido, El (Spain).ml1',
    ]));
    const clean = game('gamecube', file('C:\\Roms\\Gamecube\\', 'The Legend of Zelda - Twilight Princess.iso'));
    const plan = buildRomRenamePlan(scan([ds, clean]));
    expect(plan).toEqual([
      { old_path: 'C:\\Roms\\Nintendo DS\\5288 - Profesor Layton y el Futuro Perdido, El (Spain).nds', new_path: 'C:\\Roms\\Nintendo DS\\El Profesor Layton y el Futuro Perdido.nds' },
      { old_path: 'C:\\Roms\\Nintendo DS\\5288 - Profesor Layton y el Futuro Perdido, El (Spain).sav', new_path: 'C:\\Roms\\Nintendo DS\\El Profesor Layton y el Futuro Perdido.sav' },
      { old_path: 'C:\\Roms\\Nintendo DS\\5288 - Profesor Layton y el Futuro Perdido, El (Spain).ml1', new_path: 'C:\\Roms\\Nintendo DS\\El Profesor Layton y el Futuro Perdido.ml1' },
    ]);
  });

  it('includes a Switch game\'s updates and DLC, never changes extensions', () => {
    const base = file('D:\\Switch\\', 'Pokemon Scarlet [0100A3D008C5C000].xci');
    const update = file('D:\\Switch\\', 'Pokémon Scarlet [0100A3D008C5C800][v786432][US](nsw2u.com).nsp', 'update');
    const dlc = file('D:\\Switch\\', 'Pokemon Scarlet [New Uniform Set] [0100A3D008C5D001][v0][DLC].nsp', 'dlc');
    const plan = buildRomRenamePlan(scan([game('switch', base, { updates: [update], dlc: [dlc] })]));
    expect(plan.map(p => p.new_path)).toEqual([
      'D:\\Switch\\Pokémon Scarlet [0100A3D008C5C800][v786432].nsp',
      'D:\\Switch\\Pokemon Scarlet [New Uniform Set] [0100A3D008C5D001].nsp',
    ]);
    expect(plan.every(p => p.old_path.split('.').pop() === p.new_path.split('.').pop())).toBe(true);
  });

  it('is a no-op on its own output and skips case-only changes', () => {
    const first = buildRomRenamePlan(scan([game('wii', file('W:\\', 'Fire Emblem - Radiant Dawn (Europe).rvz'))]));
    expect(first).toHaveLength(1);
    const renamed = file('W:\\', first[0].new_path.slice(3));
    expect(buildRomRenamePlan(scan([game('wii', renamed)]))).toEqual([]);
    expect(buildRomRenamePlan(scan([game('wii', file('W:\\', 'fire emblem - radiant dawn.rvz'))]))).toEqual([]);
  });

  it('lets only the first of two dumps take a shared clean name', () => {
    const usa = game('ps2', file('P:\\', 'Game (USA).iso'));
    const eur = game('ps2', file('P:\\', 'Game (Europe).iso'));
    const plan = buildRomRenamePlan(scan([usa, eur]));
    expect(plan).toEqual([{ old_path: 'P:\\Game (USA).iso', new_path: 'P:\\Game.iso' }]);
  });
});
