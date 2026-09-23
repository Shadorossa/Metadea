import { describe, it, expect } from 'vitest';
import fixtures from './share-link-fixtures.json';
import {
  GENRE_CODES, SHARE_TYPES, bannerTokenFromUrl, bannerTokenToUrl, coverTokenFromUrl, coverTokenToUrl,
  decodeSharePath, encodeSharePath, escapeIdSegment, parseBannerToken, parseCoverToken, slugifyTitle,
  titleFromSlug, typeLetterForId, unescapeIdSegment, type ShareLinkData,
} from './share-link-codec';
import { UNIFIED_GENRE_NAMES } from '../media/genre-unifier';

// The same fixture file lives in metadea-web (test/share-link-fixtures.json)
// and runs through that repo's copy of the codec: both copies must agree.
interface FixtureData extends Omit<ShareLinkData, 'cover' | 'banner'> { cover?: string; banner?: string }
type Fixture = { name: string; path: string; data: FixtureData };
const valid = fixtures.valid as Fixture[];
const legacy = fixtures.legacy as Fixture[];

function toData(data: FixtureData): ShareLinkData {
  const letter = typeLetterForId(data.externalId)!;
  return {
    ...data,
    banner: data.banner !== undefined ? parseBannerToken(data.banner, letter) ?? undefined : undefined,
    cover: data.cover ? parseCoverToken(data.cover) ?? undefined : undefined,
  };
}

describe('share-link codec fixtures (parity with metadea-web)', () => {
  it.each(valid)('encodes $name', ({ path, data }) => {
    expect(encodeSharePath(toData(data))).toBe(path);
  });

  it.each(valid)('decodes $name', ({ path, data }) => {
    const decoded = decodeSharePath(path);
    expect(decoded).not.toBeNull();
    expect(decoded).toEqual({ ...toData(data), letter: path[1] });
  });

  it.each(legacy)('decodes $name (old link, bare banner flag ignored)', ({ path, data }) => {
    expect(decodeSharePath(path)).toEqual({ ...toData(data), letter: path[1] });
  });

  it.each(fixtures.invalid)('rejects %s', path => {
    expect(decodeSharePath(path)).toBeNull();
  });
});

describe('share-link codec', () => {
  it('has a unique code for every unified genre, and one letter per prefix', () => {
    for (const name of UNIFIED_GENRE_NAMES) expect(GENRE_CODES[name], name).toMatch(/^[a-z0-9]{2}$/);
    const codes = Object.values(GENRE_CODES);
    expect(new Set(codes).size).toBe(codes.length);
    const prefixes = Object.values(SHARE_TYPES).map(t => t.prefix);
    expect(new Set(prefixes).size).toBe(prefixes.length);
  });

  it('drops unknown genres and caps the list', () => {
    const path = encodeSharePath({ externalId: 'game:1', title: 'X', genres: ['Action', 'Nope', 'Action', 'Drama'] });
    expect(path).toBe('/g/1/x/acdr--');
    expect(decodeSharePath('/g/1/x/acq9dr--')?.genres).toEqual(['Action', 'Drama']);
  });

  it('round-trips ids with colons, dots, tildes and non-ASCII', () => {
    for (const rest of ['apisports:football:39', 'a.b~c', '100%', 'ñ:ü', 'OL1W']) {
      const escaped = escapeIdSegment(rest);
      expect(escaped).toMatch(/^[A-Za-z0-9_.~-]+$/);
      expect(unescapeIdSegment(escaped)).toBe(rest);
    }
    expect(unescapeIdSegment('.ZZ')).toBeNull();
    expect(unescapeIdSegment('.FF')).toBeNull();
  });

  it('refuses ids that are not safe to render', () => {
    expect(encodeSharePath({ externalId: 'game:<script>', title: 'x', genres: [] })).toBeNull();
    expect(encodeSharePath({ externalId: 'unknown:1', title: 'x', genres: [] })).toBeNull();
    expect(decodeSharePath('/g/.3Cscript.3E/x/--')).toBeNull();
  });

  it('slugifies and rebuilds titles', () => {
    expect(slugifyTitle('Pokémon: Été à Zürich')).toBe('pokemon-ete-a-zurich');
    expect(slugifyTitle('Straße Œuvre Ørsted')).toBe('strasse-oeuvre-orsted');
    expect(slugifyTitle('葬送のフリーレン')).toBe('');
    expect(slugifyTitle('a '.repeat(80)).length).toBeLessThanOrEqual(60);
    expect(titleFromSlug('the-lord-of-the-rings')).toBe('The Lord of the Rings');
  });

  it('keeps the title token within its byte cap on a character boundary', () => {
    const path = encodeSharePath({ externalId: 'manga:1', title: '葬'.repeat(100), genres: [] })!;
    expect(decodeSharePath(path)?.title).toBe('葬'.repeat(30));
  });

  it('maps every supported CDN URL to a token and back', () => {
    const cases: [string, string, string][] = [
      ['https://images.igdb.com/igdb/image/upload/t_1080p/co9xp1.jpg', 'co9xp1', 'https://images.igdb.com/igdb/image/upload/t_cover_big/co9xp1.jpg'],
      ['https://cdn.cloudflare.steamstatic.com/steam/apps/1145360/library_600x900_2x.jpg', 's1145360', 'https://cdn.cloudflare.steamstatic.com/steam/apps/1145360/library_600x900_2x.jpg'],
      ['https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx147105-Ab12.jpg', 'xabx147105~Ab12.jpg', 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx147105-Ab12.jpg'],
      ['https://image.tmdb.org/t/p/w300/ggFHVNu6YYI5L9pCfOacjizRGt.jpg', 'tggFHVNu6YYI5L9pCfOacjizRGt.jpg', 'https://image.tmdb.org/t/p/w500/ggFHVNu6YYI5L9pCfOacjizRGt.jpg'],
      ['https://covers.openlibrary.org/b/id/10521270-M.jpg', 'o10521270', 'https://covers.openlibrary.org/b/id/10521270-L.jpg'],
      ['https://t.vndb.org/cv/42/12342.jpg', 'v12342', 'https://t.vndb.org/cv/42/12342.jpg'],
      ['https://comicvine.gamespot.com/a/uploads/scale_medium/6/67663/5387463-01.jpg', 'k6_67663_5387463~01.jpg', 'https://comicvine.gamespot.com/a/uploads/scale_large/6/67663/5387463-01.jpg'],
      [`https://metadea.metadea.workers.dev/images/Media/${'c'.repeat(64)}.webp`, `im${'c'.repeat(64)}`, `https://metadea.metadea.workers.dev/images/Media/${'c'.repeat(64)}.webp`],
    ];
    for (const [url, token, back] of cases) {
      const parsed = coverTokenFromUrl(url);
      expect(parsed?.value, url).toBe(token);
      expect(coverTokenToUrl(parsed!)).toBe(back);
    }
  });

  it('maps banner URLs to tokens the Worker rebuilds without any API', () => {
    const sha = 'd'.repeat(64);
    const cases: [string, string, string, string][] = [
      ['anime:161645', 'https://s4.anilist.co/file/anilistcdn/media/anime/banner/161645-oqzTZYIvviWI.jpg', 'oqzTZYIvviWI', 'https://s4.anilist.co/file/anilistcdn/media/anime/banner/161645-oqzTZYIvviWI.jpg'],
      ['manga:30013', 'https://s4.anilist.co/file/anilistcdn/media/manga/banner/30013.png', '~png', 'https://s4.anilist.co/file/anilistcdn/media/manga/banner/30013.png'],
      ['lnovel:85737', 'https://s4.anilist.co/file/anilistcdn/media/manga/banner/85737-Ab1.jpg', 'Ab1', 'https://s4.anilist.co/file/anilistcdn/media/manga/banner/85737-Ab1.jpg'],
      ['game:2136', 'https://images.igdb.com/igdb/image/upload/t_1080p/onbkmlwypoqawqecxyhz.jpg', 'onbkmlwypoqawqecxyhz', 'https://images.igdb.com/igdb/image/upload/t_1080p/onbkmlwypoqawqecxyhz.jpg'],
      ['game:2136', 'https://images.igdb.com/igdb/image/upload/t_screenshot_huge/sc6abc.jpg', 'sc6abc', 'https://images.igdb.com/igdb/image/upload/t_1080p/sc6abc.jpg'],
      ['movie:603', 'https://image.tmdb.org/t/p/original/9faGSFi5jam6pDWGNd0p8JcJgXQ.jpg', '9faGSFi5jam6pDWGNd0p8JcJgXQ', 'https://image.tmdb.org/t/p/w1280/9faGSFi5jam6pDWGNd0p8JcJgXQ.jpg'],
      ['series:1396', 'https://image.tmdb.org/t/p/w1280/abc.png', 'abc~png', 'https://image.tmdb.org/t/p/w1280/abc.png'],
      ['book:OL1W', `https://metadea.metadea.workers.dev/images/Media/${sha}.webp`, `im${sha}`, `https://metadea.metadea.workers.dev/images/Media/${sha}.webp`],
    ];
    for (const [id, url, value, back] of cases) {
      const token = bannerTokenFromUrl(url, id);
      expect(token?.value, url).toBe(value);
      expect(bannerTokenToUrl(token!, typeLetterForId(id)!, id)).toBe(back);
    }
  });

  it('drops banners the Worker could not rebuild for that work', () => {
    const anilist = 'https://s4.anilist.co/file/anilistcdn/media/anime/banner/161645-oqzTZYIvviWI.jpg';
    expect(bannerTokenFromUrl(anilist, 'anime:1')).toBeNull();
    expect(bannerTokenFromUrl(anilist, 'manga:161645')).toBeNull();
    expect(bannerTokenFromUrl(anilist, 'game:161645')).toBeNull();
    expect(bannerTokenFromUrl('https://images.igdb.com/igdb/image/upload/t_1080p/ar1.jpg', 'anime:1')).toBeNull();
    expect(bannerTokenFromUrl('https://cdn.cloudflare.steamstatic.com/steam/apps/1/library_hero.jpg', 'game:1')).toBeNull();
    expect(bannerTokenFromUrl('http://asset.localhost/C%3A/b.jpg', 'game:1')).toBeNull();
    expect(bannerTokenFromUrl(null, 'game:1')).toBeNull();
  });

  it('ignores local, asset and unknown-host covers', () => {
    for (const url of ['C:/covers/x.jpg', 'asset://localhost/x.jpg', 'http://asset.localhost/x.jpg', 'https://evil.example/co1.jpg', '', null, undefined]) {
      expect(coverTokenFromUrl(url)).toBeNull();
    }
  });
});
