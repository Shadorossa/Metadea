import { describe, it, expect } from 'vitest';
import type { LocalGame } from '../tauri';
import { dedupeLocalGames, gameIdentity, gameLinkKey } from './game-identity';

const game = (over: Partial<LocalGame>): LocalGame => ({ name: 'Game', launcher: 'steam', ...over });

describe('gameLinkKey', () => {
  it('follows app_id, then install_path, then name like the Rust scan', () => {
    expect(gameLinkKey(game({ app_id: '10', install_path: 'C:/g' }))).toBe('10');
    expect(gameLinkKey(game({ install_path: 'C:/g' }))).toBe('C:/g');
    expect(gameLinkKey(game({}))).toBe('Game');
    expect(gameIdentity(game({ launcher: 'gog', app_id: '7' }))).toBe('gog:7');
  });
});

describe('dedupeLocalGames', () => {
  it('keeps one card per identity, the installed and linked one, with the best playtime', () => {
    const ghost = game({ app_id: '1245620', name: 'ELDEN RING', installed: false, playtime_minutes: 600 });
    const installed = game({ app_id: '1245620', name: 'ELDEN RING', installed: true, external_id: 'game:119133', install_path: 'D:/SteamLibrary/steamapps/common/ELDEN RING' });
    const other = game({ app_id: '1388770', name: 'Cruelty Squad' });
    const result = dedupeLocalGames([ghost, other, installed]);
    expect(result.map(g => g.name)).toEqual(['ELDEN RING', 'Cruelty Squad']);
    expect(result[0]).toMatchObject({ installed: true, external_id: 'game:119133', playtime_minutes: 600 });
  });

  it('never merges the same title on two launchers or two different app ids', () => {
    const result = dedupeLocalGames([
      game({ app_id: '1', name: 'Persona 4 Golden' }),
      game({ app_id: '1', name: 'Persona 4 Golden', launcher: 'playstation' }),
      game({ app_id: '2', name: 'Persona 4 Golden' }),
    ]);
    expect(result).toHaveLength(3);
  });
});
