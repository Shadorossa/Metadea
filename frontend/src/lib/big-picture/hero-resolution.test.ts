import { describe, expect, it } from 'vitest';
import { highResArtUrl } from './hero-resolution';

describe('highResArtUrl', () => {
  it('asks IGDB for 1080p on full HD and the original above it', () => {
    const url = 'https://images.igdb.com/igdb/image/upload/t_720p/ar1abc.jpg';
    expect(highResArtUrl(url, 1920)).toBe('https://images.igdb.com/igdb/image/upload/t_1080p/ar1abc.jpg');
    expect(highResArtUrl(url, 3840)).toBe('https://images.igdb.com/igdb/image/upload/t_original/ar1abc.jpg');
  });

  it('asks TMDB for the original backdrop on large screens', () => {
    const url = 'https://image.tmdb.org/t/p/w780/abc.jpg';
    expect(highResArtUrl(url, 2560)).toBe('https://image.tmdb.org/t/p/original/abc.jpg');
    expect(highResArtUrl(url, 1280)).toBe('https://image.tmdb.org/t/p/w1280/abc.jpg');
  });

  it('upgrades Steam art to the library hero', () => {
    const url = 'https://cdn.akamai.steamstatic.com/steam/apps/1086940/header.jpg?t=1';
    expect(highResArtUrl(url, 3840)).toBe('https://cdn.akamai.steamstatic.com/steam/apps/1086940/library_hero_2x.jpg');
    expect(highResArtUrl(url, 1920)).toBe('https://cdn.akamai.steamstatic.com/steam/apps/1086940/library_hero.jpg');
  });

  it('keeps anything else as is', () => {
    expect(highResArtUrl('https://s4.anilist.co/file/anilistcdn/media/anime/banner/1.jpg', 3840))
      .toBe('https://s4.anilist.co/file/anilistcdn/media/anime/banner/1.jpg');
    expect(highResArtUrl('asset://localhost/banner.jpg', 3840)).toBe('asset://localhost/banner.jpg');
  });
});
