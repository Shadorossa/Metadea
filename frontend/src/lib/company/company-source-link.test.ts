import { describe, expect, it } from 'vitest';
import { companySourceLink, companyWebsites, isProviderUrl } from './company-source-link';

describe('companySourceLink', () => {
  it('uses the provider page Rust reported', () => {
    expect(companySourceLink({ provider_id: 'igdb:1020', source_url: 'https://www.igdb.com/companies/fromsoftware', websites: [] }))
      .toEqual({ source: 'igdb', url: 'https://www.igdb.com/companies/fromsoftware' });
  });

  it('rebuilds it from the id on older cached copies', () => {
    expect(companySourceLink({ provider_id: 'anilist-studio:11', websites: ['https://anilist.co/studio/11'] }))
      .toEqual({ source: 'anilist', url: 'https://anilist.co/studio/11' });
    expect(companySourceLink({ provider_id: 'tmdb-company:420', websites: [] })?.url).toBe('https://www.themoviedb.org/company/420');
    expect(companySourceLink({ provider_id: 'tmdb-network:213', websites: [] })?.url).toBe('https://www.themoviedb.org/network/213');
    expect(companySourceLink({ provider_id: 'igdb:1', websites: ['https://www.fromsoftware.jp'] })).toBeNull();
  });

  it('ignores unknown providers and non-https source urls', () => {
    expect(companySourceLink({ provider_id: 'steam:1', websites: [] })).toBeNull();
    expect(companySourceLink({ provider_id: 'igdb:1', source_url: 'javascript:alert(1)', websites: [] })).toBeNull();
  });
});

describe('companyWebsites', () => {
  it('keeps the company own http(s) sites only', () => {
    expect(companyWebsites(['https://anilist.co/studio/11', 'https://www.fromsoftware.jp', 'javascript:alert(1)', 'https://www.themoviedb.org/company/1']))
      .toEqual(['https://www.fromsoftware.jp']);
    expect(isProviderUrl('https://www.igdb.com/companies/x')).toBe(true);
    expect(isProviderUrl('https://notanilist.co.uk')).toBe(false);
  });
});
