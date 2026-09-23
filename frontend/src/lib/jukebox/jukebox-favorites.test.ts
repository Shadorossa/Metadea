import { describe, it, expect } from 'vitest';
import type { FavoriteTheme } from '../tauri/jukebox';
import type { MediaTheme } from '../tauri/themes';
import { applyFavoriteToggle, favoriteKeySet, isThemeFavorite, themeDisplayTitle, toFavoriteKeys } from './jukebox-favorites';

function theme(externalId: string, slug: string, songTitle: string | null = slug): MediaTheme {
  return { external_id: externalId, slug, theme_type: slug.startsWith('ED') ? 'ED' : 'OP', sequence: 1, song_title: songTitle, artists: null, episodes: null, video_url: null };
}

function fav(t: MediaTheme, mediaTitle = t.external_id): FavoriteTheme {
  return { theme: t, media_title: mediaTitle, cover_url: null, preview_frame_path: null };
}

const queue = [fav(theme('a', 'OP1')), fav(theme('b', 'OP1'))];
const context = { mediaTitle: 'Work C', coverUrl: 'https://img/c.jpg' };

describe('isThemeFavorite / favoriteKeySet / toFavoriteKeys', () => {
  it('matches on both id and slug', () => {
    expect(isThemeFavorite(queue, theme('a', 'OP1'))).toBe(true);
    expect(isThemeFavorite(queue, theme('a', 'ED1'))).toBe(false);
    expect(isThemeFavorite(queue, theme('c', 'OP1'))).toBe(false);
    expect(favoriteKeySet(queue)).toEqual(new Set(['a::OP1', 'b::OP1']));
    expect(toFavoriteKeys(queue)).toEqual([{ external_id: 'a', slug: 'OP1' }, { external_id: 'b', slug: 'OP1' }]);
  });
});

describe('applyFavoriteToggle', () => {
  it('appends a new star with the page context and leaves an existing one alone', () => {
    const next = applyFavoriteToggle(queue, theme('c', 'ED1'), true, context);
    expect(next).toHaveLength(3);
    expect(next[2]).toEqual({ theme: theme('c', 'ED1'), media_title: 'Work C', cover_url: 'https://img/c.jpg', preview_frame_path: null });
    expect(applyFavoriteToggle(queue, theme('a', 'OP1'), true, context)).toBe(queue);
  });

  it('removes on unstar and is a no-op for an unknown theme', () => {
    const next = applyFavoriteToggle(queue, theme('a', 'OP1'), false, context);
    expect(next.map(f => f.theme.external_id)).toEqual(['b']);
    expect(applyFavoriteToggle(queue, theme('zzz', 'OP1'), false, context)).toBe(queue);
  });
});

describe('themeDisplayTitle', () => {
  it('prefers the song title and falls back to the OP/ED label', () => {
    expect(themeDisplayTitle(theme('a', 'OP1', 'Pray'))).toBe('Pray');
    expect(themeDisplayTitle(theme('a', 'OP1', '  '))).toBe('OP1');
    expect(themeDisplayTitle(theme('a', 'ED1', null))).toBe('ED1');
  });
});
