import { describe, expect, it } from 'vitest';
import { Tag, Zap } from 'lucide-react';
import { UNIFIED_GENRE_NAMES } from '../../lib/media/genre-unifier';
import { GENRE_ICONS, genreIcon } from './genre-icons';

// Adult tags deliberately share the neutral fallback.
const NEUTRAL = new Set(['Ecchi', 'Hentai', 'Erotic']);

describe('genreIcon', () => {
  it('has an icon for every unified genre', () => {
    for (const name of UNIFIED_GENRE_NAMES) {
      expect(GENRE_ICONS[name], name).toBeDefined();
      if (!NEUTRAL.has(name)) expect(genreIcon(name), name).not.toBe(Tag);
    }
  });

  it('matches case-insensitively and falls back to a tag', () => {
    expect(genreIcon('action')).toBe(Zap);
    expect(genreIcon('Some Unknown Genre')).toBe(Tag);
  });
});
