import { describe, it, expect } from 'vitest';
import { parseRomFileName, romDisplayTitle, switchBaseTitleId, switchKindFromTitleId } from './rom-name-parser';

describe('parseRomFileName — the owner\'s real library', () => {
  it('Redump GameCube name with an inverted article and a dash subtitle', () => {
    const p = parseRomFileName('Legend of Zelda, The - Twilight Princess.iso');
    expect(p.title).toBe('The Legend of Zelda: Twilight Princess');
    expect(p.rawTitle).toBe('The Legend of Zelda - Twilight Princess');
    expect(p.fileTitle).toBe('The Legend of Zelda - Twilight Princess');
    expect(p.kind).toBe('base');
  });

  it('No-Intro Wii name with region, languages and revision', () => {
    const p = parseRomFileName('Fire Emblem - Radiant Dawn (Europe) (En,Fr,De,Es,It) (Rev 1).rvz');
    expect(p.title).toBe('Fire Emblem: Radiant Dawn');
    expect(p.region).toBe('Europe');
    expect(p.languages).toEqual(['En', 'Fr', 'De', 'Es', 'It']);
    expect(p.revision).toBe('1');
    expect(p.junkTags).toEqual([]);
  });

  it('3DS name with two dash subtitles', () => {
    const p = parseRomFileName('Inazuma Eleven GO - Chrono Stones - Thunderflash (Europe) (En,Fr,De,Es,It).3ds');
    expect(p.title).toBe('Inazuma Eleven GO: Chrono Stones: Thunderflash');
    expect(p.fileTitle).toBe('Inazuma Eleven GO - Chrono Stones - Thunderflash');
  });

  it('scene-numbered DS name with a Spanish article', () => {
    const p = parseRomFileName('5288 - Profesor Layton y el Futuro Perdido, El (Spain).nds');
    expect(p.sceneNumber).toBe('5288');
    expect(p.title).toBe('El Profesor Layton y el Futuro Perdido');
    expect(p.region).toBe('Spain');
  });

  it('Switch base with ™, a modifier-letter colon, title id, version and [Base]', () => {
    const p = parseRomFileName('Fire Emblem™꞉ Three Houses [010055D009F78000][v0][Base].nsp');
    expect(p.title).toBe('Fire Emblem: Three Houses');
    expect(p.fileTitle).toBe('Fire Emblem - Three Houses');
    expect(p.titleId).toBe('010055D009F78000');
    expect(p.baseTitleId).toBe('010055D009F78000');
    expect(p.version).toBe('0');
    expect(p.kind).toBe('base');
  });

  it('Switch XCI with only a title id', () => {
    const p = parseRomFileName('Pokemon Scarlet [0100A3D008C5C000].xci');
    expect(p.title).toBe('Pokemon Scarlet');
    expect(p.kind).toBe('base');
    expect(p.baseTitleId).toBe('0100A3D008C5C000');
  });

  it('Switch DLC keeps its name and resolves the base title id', () => {
    const p = parseRomFileName('Pokemon Scarlet [New Uniform Set] [0100A3D008C5D001][v0][DLC].nsp');
    expect(p.title).toBe('Pokemon Scarlet');
    expect(p.kind).toBe('dlc');
    expect(p.dlcName).toBe('New Uniform Set');
    expect(p.titleId).toBe('0100A3D008C5D001');
    expect(p.baseTitleId).toBe('0100A3D008C5C000');
  });

  it('Switch update from the …800 suffix, with a site tag and a bracketed region', () => {
    const p = parseRomFileName('Pokémon Scarlet [0100A3D008C5C800][v786432][US](nsw2u.com).nsp');
    expect(p.title).toBe('Pokémon Scarlet');
    expect(p.kind).toBe('update');
    expect(p.version).toBe('786432');
    expect(p.region).toBe('US');
    expect(p.junkTags).toEqual(['nsw2u.com']);
    expect(p.baseTitleId).toBe('0100A3D008C5C000');
  });

  it('PS2 Redump name with an UNDUB mod tag', () => {
    const p = parseRomFileName('Shin Megami Tensei - Digital Devil Saga 2 (UNDUB v1.0.0).iso');
    expect(p.title).toBe('Shin Megami Tensei: Digital Devil Saga 2');
    expect(p.mod).toBe('UNDUB v1.0.0');
    expect(p.version).toBeUndefined();
  });

  it('PS2 serial-prefixed archive', () => {
    const p = parseRomFileName('SLUS-20974_DDS1.7z');
    expect(p.serial).toBe('SLUS-20974');
    expect(p.title).toBe('DDS1');
  });
});

describe('parseRomFileName — conventions', () => {
  it('leaves an untagged plain name alone, dashes included', () => {
    const p = parseRomFileName('Some Game - Special Edition');
    expect(p.title).toBe('Some Game - Special Edition');
    expect(p.fileTitle).toBe('Some Game - Special Edition');
  });

  it('is idempotent over its own clean file names', () => {
    for (const name of [
      'Fire Emblem™꞉ Three Houses [010055D009F78000][v0][Base].nsp',
      'Legend of Zelda, The - Twilight Princess.iso',
      'Pokemon Scarlet [New Uniform Set] [0100A3D008C5D001][v0][DLC].nsp',
    ]) {
      const first = parseRomFileName(name);
      const cleanName = first.titleId ? `${first.fileTitle} [${first.titleId}]` : first.fileTitle;
      const second = parseRomFileName(cleanName);
      expect(second.fileTitle).toBe(first.fileTitle);
    }
  });

  it('collects unknown tags as junk and multiple regions', () => {
    const p = parseRomFileName('Game (USA, Europe) (Proto) (Disc 2) [!].bin');
    expect(p.region).toBe('USA, Europe');
    expect(p.disc).toBe(2);
    expect(p.junkTags).toEqual(['Proto', '!']);
    expect(p.title).toBe('Game');
  });

  it('handles mixed languages with + variants and a lone serial', () => {
    expect(parseRomFileName('Title (Japan) (En+Ja,Fr)').languages).toEqual(['En', 'Ja', 'Fr']);
    expect(parseRomFileName('SLES-12345.iso').title).toBe('SLES-12345');
  });

  it('honours explicit kind tags over the title id suffix', () => {
    expect(parseRomFileName('X [0100000000000800][UPD]').kind).toBe('update');
    expect(parseRomFileName('X [0100000000000000][DLC]').kind).toBe('dlc');
    expect(switchKindFromTitleId('0100000000001001')).toBe('dlc');
    expect(switchBaseTitleId('0100000000000800', 'update')).toBe('0100000000000000');
  });

  it('never yields an empty title', () => {
    expect(parseRomFileName('(USA).nds').title).toBe('(USA)');
    expect(romDisplayTitle('Fire Emblem - Radiant Dawn (Europe)')).toBe('Fire Emblem: Radiant Dawn');
  });
});
