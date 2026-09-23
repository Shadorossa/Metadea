// The company's own page on its provider, shown on the company header as
// the provider's logo button (the media page's MediaSourceLink), and the
// websites left once that page is taken out of the plain links.
import type { CompanyPageData } from '../tauri/company-catalog';

export interface CompanySourceLink {
  /** A MediaSourceLink source key. */
  source: 'anilist' | 'igdb' | 'tmdb' | 'comicvine';
  url: string;
}

const SOURCE_BY_PREFIX: Record<string, CompanySourceLink['source']> = {
  'igdb': 'igdb',
  'anilist-studio': 'anilist',
  'tmdb-company': 'tmdb',
  'tmdb-network': 'tmdb',
  'comicvine': 'comicvine',
};

const PROVIDER_HOSTS = ['anilist.co', 'igdb.com', 'themoviedb.org', 'comicvine.gamespot.com'];

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return null;
  }
}

/** Whether a link points at one of the metadata providers rather than at
 *  the company's own site. */
export function isProviderUrl(url: string): boolean {
  const host = hostOf(url);
  return !!host && PROVIDER_HOSTS.some(provider => host === provider || host.endsWith(`.${provider}`));
}

/** The provider page: what Rust reported, or — on copies cached before it
 *  did — rebuilt from the page id where the URL scheme is known. */
export function companySourceLink(page: Pick<CompanyPageData, 'provider_id' | 'source_url' | 'websites'>): CompanySourceLink | null {
  const [prefix, id] = page.provider_id.split(':', 2);
  const source = SOURCE_BY_PREFIX[prefix];
  if (!source || !id) return null;
  if (page.source_url && page.source_url.startsWith('https://')) return { source, url: page.source_url };
  switch (prefix) {
    case 'anilist-studio': return { source, url: `https://anilist.co/studio/${id}` };
    case 'tmdb-company': return { source, url: `https://www.themoviedb.org/company/${id}` };
    case 'tmdb-network': return { source, url: `https://www.themoviedb.org/network/${id}` };
    default: {
      // Older IGDB/ComicVine copies: only a provider link among the websites.
      const fromWebsites = page.websites.find(isProviderUrl);
      return fromWebsites ? { source, url: fromWebsites } : null;
    }
  }
}

/** The company's own sites: https links that aren't provider pages. */
export function companyWebsites(websites: readonly string[]): string[] {
  return websites.filter(url => /^https?:\/\//i.test(url) && !isProviderUrl(url));
}
