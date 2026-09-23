import { describe, it, expect } from 'vitest';
import { companyPageId, companyPageHref, isCompanyPageId } from './company-page-id';

describe('companyPageId', () => {
  it('maps each mapper namespace to its provider prefix', () => {
    expect(companyPageId({ external_id: 'company:1020', role: 'developer' }, 'game')).toBe('igdb:1020');
    expect(companyPageId({ external_id: 'company:anilist:11', role: 'developer' }, 'anime')).toBe('anilist-studio:11');
    expect(companyPageId({ external_id: 'company:anilist:17', role: 'publisher' }, 'anime')).toBe('anilist-studio:17');
    expect(companyPageId({ external_id: 'company:comicvine:31', role: 'publisher' }, 'comic')).toBe('comicvine:31');
  });

  it('splits TMDB networks from production companies by role and type', () => {
    expect(companyPageId({ external_id: 'company:tmdb:213', role: 'publisher' }, 'series')).toBe('tmdb-network:213');
    expect(companyPageId({ external_id: 'company:tmdb:420', role: 'developer' }, 'series')).toBe('tmdb-company:420');
    expect(companyPageId({ external_id: 'company:tmdb:420', role: 'developer' }, 'movie')).toBe('tmdb-company:420');
  });

  it('leaves name-only ids and unknown shapes unlinked', () => {
    expect(companyPageId({ external_id: 'company:comicvine:Marvel Comics', role: 'publisher' }, 'comic')).toBeNull();
    expect(companyPageId({ external_id: 'company:mal:3', role: 'developer' }, 'anime')).toBeNull();
    expect(companyPageId({ external_id: 'studio:1', role: 'developer' }, 'anime')).toBeNull();
    expect(companyPageId({ external_id: 'company:', role: 'developer' }, 'game')).toBeNull();
  });

  it('builds an encoded href and validates page ids', () => {
    expect(companyPageHref({ external_id: 'company:anilist:11', role: 'developer' }, 'anime')).toBe('/company?id=anilist-studio%3A11');
    expect(companyPageHref({ external_id: 'company:x:y', role: 'developer' }, 'anime')).toBeNull();
    expect(isCompanyPageId('tmdb-network:213')).toBe(true);
    expect(isCompanyPageId('anilist:1')).toBe(false);
    expect(isCompanyPageId('igdb:1/../x')).toBe(false);
  });
});
