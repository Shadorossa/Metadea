import { tauriCmd } from './bridge';

// ── Company pages (src-tauri/src/company_catalog) ───────────────────────────

/** `developer` | `publisher` | `studio` | `producer` | `production` | `network`. */
export type CompanyRole = 'developer' | 'publisher' | 'studio' | 'producer' | 'production' | 'network';

export interface CompanyWork {
  /** Same scheme as search results: `game:1942`, `anime:21`, `movie:603`. */
  external_id: string;
  title: string;
  cover_url: string | null;
  year: number | null;
  media_type: string;
  roles: CompanyRole[];
  /** DLC / bundle / pack / mod / update. */
  is_extra: boolean;
  /** Not out yet, or cancelled. */
  unreleased: boolean;
  /** Provider average on the app's 0–10 scale (scoreGlobal); absent on
   *  pages cached before it existed or when unrated. */
  score?: number | null;
  /** AniList isAdult (lib/search/exclusion-filters.ts). */
  is_adult?: boolean;
  /** Local catalog format on pages rebuilt from it (DLC, REMASTER...). */
  format?: string | null;
}

export interface CompanyPageData {
  provider_id: string;
  /** `igdb` | `anilist` | `tmdb` | `local` (rebuilt from the local catalog). */
  source: string;
  name: string;
  logo_url: string | null;
  description: string | null;
  country_code: string | null;
  headquarters: string | null;
  founded_year: number | null;
  websites: string[];
  /** The company's page on the provider; absent on older cached copies. */
  source_url?: string | null;
  roles: CompanyRole[];
  works: CompanyWork[];
  total_hint: number | null;
}

export interface CompanyPagePayload {
  page: CompanyPageData;
  fetched_at: number;
  /** Past the 7-day TTL: render, then refresh with `forceRefresh`. */
  stale: boolean;
  /** Every work the provider has is in `page.works`. */
  complete: boolean;
}

/** Null outside Tauri. Errors are `E_COMPANY_*` codes (formatAppError). */
export function getCompanyPage(providerId: string, forceRefresh = false): Promise<CompanyPagePayload | null> {
  return tauriCmd<CompanyPagePayload | null>('get_company_page', null, { providerId, forceRefresh });
}

/** Resolves the next chunk of works after the cached cursor. */
export function loadMoreCompanyWorks(providerId: string): Promise<CompanyPagePayload | null> {
  return tauriCmd<CompanyPagePayload | null>('load_more_company_works', null, { providerId });
}
