import { describe, it, expect } from 'vitest';
import { buildShareLink, shareableWorkFromPage } from './share-link';
import type { MediaPageData } from '../media/types';

const BAYONETTA = {
  externalId: 'game:2136',
  title: 'Bayonetta',
  year: 2009,
  genres: ['Hack and Slash', 'Action'],
  score: 8.6,
  coverUrl: 'https://images.igdb.com/igdb/image/upload/t_cover_big/co9xp1.jpg',
};

describe('buildShareLink', () => {
  it('builds the preview links for the reference works', () => {
    expect(buildShareLink(BAYONETTA)).toBe('https://metadea.pages.dev/g/2136/bayonetta-2009/hsac-86-co9xp1');
  });

  it('computes the links for the production reference works (banner + cover)', () => {
    const links = [
      buildShareLink({
        externalId: 'anime:161645', title: 'Kusuriya no Hitorigoto', year: 2023, genres: ['Drama', 'Mystery'], score: 8.8,
        bannerUrl: 'https://s4.anilist.co/file/anilistcdn/media/anime/banner/161645-oqzTZYIvviWI.jpg',
        coverUrl: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx161645-QLbzHXiYRgV2.jpg',
      }),
      buildShareLink({
        externalId: 'anime:147105', title: 'Tongari Boushi no Atelier', year: 2026, genres: ['Adventure', 'Drama', 'Fantasy'], score: 8.5,
        bannerUrl: 'https://s4.anilist.co/file/anilistcdn/media/anime/banner/147105-fTjmRrILFixZ.jpg',
        coverUrl: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx147105-rwOX8qyUy8gV.jpg',
      }),
      buildShareLink({
        ...BAYONETTA, genres: ['Shooter', 'Hack and Slash', 'Adventure'],
        bannerUrl: 'https://images.igdb.com/igdb/image/upload/t_1080p/onbkmlwypoqawqecxyhz.jpg',
      }),
    ];
    expect(links).toEqual([
      'https://metadea.pages.dev/a/161645/kusuriya-no-hitorigoto-2023/drmy-88-b.oqzTZYIvviWI',
      'https://metadea.pages.dev/a/147105/tongari-boushi-no-atelier-2026/addrfa-85-b.fTjmRrILFixZ',
      'https://metadea.pages.dev/g/2136/bayonetta-2009/shhsad-86-co9xp1',
    ]);
  });

  it('keeps the AniList cover token when there is no banner', () => {
    expect(buildShareLink({
      externalId: 'manga:30013', title: 'One Piece',
      coverUrl: 'https://s4.anilist.co/file/anilistcdn/media/manga/cover/large/bx30013-tZn2PIpT7vdK.png',
    })).toBe('https://metadea.pages.dev/m/30013/one-piece/--xmbx30013~tZn2PIpT7vdK.png');
  });

  it('carries the 0..10 scoreGlobal ×10 (7.9 -> 79, not 8)', () => {
    expect(buildShareLink({ ...BAYONETTA, score: 7.9 })).toContain('-79-');
  });

  it('always uses the cover for games, even with a banner', () => {
    expect(buildShareLink({ ...BAYONETTA, bannerUrl: 'https://images.igdb.com/igdb/image/upload/t_1080p/ar1.jpg' }))
      .toBe('https://metadea.pages.dev/g/2136/bayonetta-2009/hsac-86-co9xp1');
  });

  it('leaves out banners the Worker could not rebuild', () => {
    expect(buildShareLink({ ...BAYONETTA, bannerUrl: 'https://cdn.cloudflare.steamstatic.com/steam/apps/1/library_hero.jpg' }))
      .toBe('https://metadea.pages.dev/g/2136/bayonetta-2009/hsac-86-co9xp1');
  });

  it('omits the image for local or unknown covers', () => {
    expect(buildShareLink({ ...BAYONETTA, coverUrl: 'http://asset.localhost/C%3A/covers/x.jpg' }))
      .toBe('https://metadea.pages.dev/g/2136/bayonetta-2009/hsac-86-');
  });

  it('returns null when the app could not open the link or has no title', () => {
    expect(buildShareLink({ ...BAYONETTA, title: '  ' })).toBeNull();
    expect(buildShareLink({ ...BAYONETTA, externalId: 'local:abc' })).toBeNull();
    expect(buildShareLink({ ...BAYONETTA, externalId: 'event:apisports:football:39' })).toBeNull();
  });

  it('reads the fields a media page already has', () => {
    const page = {
      externalId: 'game:2136', titleMain: 'Bayonetta', releaseYear: 2009, genreDots: 'Hack and Slash · Action',
      scoreGlobal: 8.6, cover: BAYONETTA.coverUrl, bannerImage: 'https://images.igdb.com/igdb/image/upload/t_1080p/ar1.jpg',
    } as unknown as MediaPageData;
    expect(buildShareLink(shareableWorkFromPage(page)))
      .toBe('https://metadea.pages.dev/g/2136/bayonetta-2009/hsac-86-co9xp1');
  });
});
