import { describe, expect, it } from 'vitest';
import { collectCharacterAliases } from './character-aliases';

describe('collectCharacterAliases', () => {
  it('merges every source in order, de-duplicated case-insensitively, excluding the character\'s own names', () => {
    const aliases = collectCharacterAliases({
      name: 'Monkey D. Luffy',
      nameNative: 'モンキー・D・ルフィ',
      alternative: ['Straw Hat', 'Monkey D. Luffy', 'モンキー・D・ルフィ', 'x'],
      alternativeSpoiler: ['Joy Boy', 'straw hat'],
      aliasesCsv: 'Straw Hat,Mugiwara',
      parsedStats: [
        { label: 'Nickname', value: '<b>Lucy</b>; Rubber Man' },
        { label: 'Height', value: '174 cm' },
      ],
      biography: 'He is also known as Straw Hat Luffy, and referred to as the Fifth Emperor. Alias "Lucy" (arena).',
    });
    expect(aliases).toEqual([
      { text: 'Straw Hat', spoiler: false },
      { text: 'Joy Boy', spoiler: true },
      { text: 'Mugiwara', spoiler: false },
      { text: 'Lucy', spoiler: false },
      { text: 'Rubber Man', spoiler: false },
      { text: 'Straw Hat Luffy', spoiler: false },
      { text: 'the Fifth Emperor', spoiler: false },
      { text: '"Lucy"', spoiler: false },
    ]);
  });

  it('ignores parentheticals in the biography and empty inputs', () => {
    expect(collectCharacterAliases({
      name: 'Rin',
      nameNative: null,
      alternative: [],
      alternativeSpoiler: [],
      aliasesCsv: null,
      parsedStats: [],
      biography: 'Rin (Coach) leads the team in the Aliea Gakuen arc.',
    })).toEqual([]);
  });
});
