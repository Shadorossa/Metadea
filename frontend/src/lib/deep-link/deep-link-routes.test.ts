import { describe, it, expect } from 'vitest';
import {
  buildDeepLink, buildShareUrl, targetToPath, parseDeepLinkTarget, isValidDeepLinkTarget, SHARE_URL_BASE,
} from './deep-link-routes';

describe('targetToPath', () => {
  it('maps every kind to the route the app already uses', () => {
    expect(targetToPath({ kind: 'media', external_id: 'anime:21610' })).toBe('/media?id=anime%3A21610');
    expect(targetToPath({ kind: 'character', id: 'a:12345' })).toBe('/character?id=a%3A12345');
    expect(targetToPath({ kind: 'profile', user: 'Shadorossa' })).toBe('/user?id=Shadorossa');
    expect(targetToPath({ kind: 'home' })).toBe('/home');
    expect(targetToPath({ kind: 'auth_mal', code: 'c', state: 's' })).toBe('/settings');
  });
});

describe('buildDeepLink', () => {
  it('builds metadea:// URLs', () => {
    expect(buildDeepLink({ kind: 'media', external_id: 'anime:21610' })).toBe('metadea://media/anime:21610');
    expect(buildDeepLink({ kind: 'character', id: 'co:678' })).toBe('metadea://character/co:678');
    expect(buildDeepLink({ kind: 'profile', user: 'user_1-x' })).toBe('metadea://profile/user_1-x');
    expect(buildDeepLink({ kind: 'home' })).toBe('metadea://home');
    expect(buildDeepLink({ kind: 'auth_mal', code: 'def50200a-b_c.~', state: 'st4te' })).toBe('metadea://auth/mal?code=def50200a-b_c.~&state=st4te');
  });

  it('refuses ids that the Rust parser would reject', () => {
    expect(() => buildDeepLink({ kind: 'media', external_id: '../x' })).toThrow();
    expect(() => buildDeepLink({ kind: 'media', external_id: 'anime' })).toThrow();
    expect(() => buildDeepLink({ kind: 'media', external_id: 'Anime:1' })).toThrow();
    expect(() => buildDeepLink({ kind: 'character', id: '12345' })).toThrow();
    expect(() => buildDeepLink({ kind: 'profile', user: 'user name' })).toThrow();
    expect(() => buildDeepLink({ kind: 'profile', user: '' })).toThrow();
    expect(() => buildDeepLink({ kind: 'auth_mal', code: 'a b', state: 's' })).toThrow();
    expect(() => buildDeepLink({ kind: 'auth_mal', code: '', state: 's' })).toThrow();
    expect(() => buildDeepLink({ kind: 'auth_mal', code: 'a', state: 's:1' })).toThrow();
  });
});

describe('buildShareUrl', () => {
  it('points at the GitHub Pages redirect with a readable locator', () => {
    expect(buildShareUrl({ kind: 'media', external_id: 'anime:21610' }))
      .toBe(`${SHARE_URL_BASE}?to=media/anime:21610`);
    expect(buildShareUrl({ kind: 'home' })).toBe(`${SHARE_URL_BASE}?to=home`);
  });

  it('round-trips through URLSearchParams unchanged', () => {
    const url = new URL(buildShareUrl({ kind: 'character', id: 'ms:5256c8a2' }));
    expect(url.searchParams.get('to')).toBe('character/ms:5256c8a2');
  });

  it('validates like buildDeepLink', () => {
    expect(() => buildShareUrl({ kind: 'media', external_id: 'anime:1/../x' })).toThrow();
  });
});

describe('parseDeepLinkTarget', () => {
  it('accepts the serialized Rust enum', () => {
    expect(parseDeepLinkTarget({ kind: 'media', external_id: 'anime:1' })).toEqual({ kind: 'media', external_id: 'anime:1' });
    expect(parseDeepLinkTarget({ kind: 'character', id: 'a:1' })).toEqual({ kind: 'character', id: 'a:1' });
    expect(parseDeepLinkTarget({ kind: 'profile', user: 'u' })).toEqual({ kind: 'profile', user: 'u' });
    expect(parseDeepLinkTarget({ kind: 'home' })).toEqual({ kind: 'home' });
    expect(parseDeepLinkTarget({ kind: 'auth_mal', code: 'c0de', state: 's' })).toEqual({ kind: 'auth_mal', code: 'c0de', state: 's' });
  });

  it('drops extra fields and rejects anything malformed', () => {
    expect(parseDeepLinkTarget({ kind: 'home', extra: 1 })).toEqual({ kind: 'home' });
    expect(parseDeepLinkTarget(null)).toBeNull();
    expect(parseDeepLinkTarget('metadea://home')).toBeNull();
    expect(parseDeepLinkTarget({ kind: 'settings' })).toBeNull();
    expect(parseDeepLinkTarget({ kind: 'media' })).toBeNull();
    expect(parseDeepLinkTarget({ kind: 'media', external_id: 'anime:1?x=<script>' })).toBeNull();
    expect(parseDeepLinkTarget({ kind: 'profile', user: '../x' })).toBeNull();
    expect(parseDeepLinkTarget({ kind: 'auth_mal', code: 'c' })).toBeNull();
    expect(parseDeepLinkTarget({ kind: 'auth_mal', code: 'c<script>', state: 's' })).toBeNull();
  });
});

describe('isValidDeepLinkTarget', () => {
  it('mirrors the Rust id patterns', () => {
    expect(isValidDeepLinkTarget({ kind: 'media', external_id: 'book:OL262758W' })).toBe(true);
    expect(isValidDeepLinkTarget({ kind: 'media', external_id: 'episode:series:42' })).toBe(false);
    expect(isValidDeepLinkTarget({ kind: 'character', id: 'ms:5256c8a2-ab_c' })).toBe(true);
  });
});

describe('company targets', () => {
  it('opens the company page and accepts one hyphenated qualifier', () => {
    expect(targetToPath({ kind: 'company', id: 'anilist-studio:11' })).toBe('/company?id=anilist-studio%3A11');
    expect(buildDeepLink({ kind: 'company', id: 'igdb:1020' })).toBe('metadea://company/igdb:1020');
    expect(buildShareUrl({ kind: 'company', id: 'tmdb-network:213' })).toBe(`${SHARE_URL_BASE}?to=company/tmdb-network:213`);
    expect(parseDeepLinkTarget({ kind: 'company', id: 'tmdb-company:420' })).toEqual({ kind: 'company', id: 'tmdb-company:420' });
  });

  it('rejects what deep_link.rs rejects', () => {
    for (const id of ['anilist-studio-x:1', '-studio:1', 'anilist-:1', 'Igdb:1', 'igdb:1/x', 'igdb', 'igdb:../x']) {
      expect(isValidDeepLinkTarget({ kind: 'company', id })).toBe(false);
    }
    expect(parseDeepLinkTarget({ kind: 'company' })).toBeNull();
  });
});
