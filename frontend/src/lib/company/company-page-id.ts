// Company page ids (`/company?id=<provider>:<id>`) from the company rows the
// media mappers persist (companies / media_by_company). The stored ids are
// namespaced per provider — `company:<igdb id>`, `company:anilist:<id>`,
// `company:tmdb:<id>`, `company:comicvine:<id>` — and TMDB networks share
// their namespace with production companies, so the relation's role and the
// media type decide which TMDB endpoint the page reads. Mirrors
// src-tauri/src/company_catalog/model.rs (CompanyProvider::parse).

export type CompanyProviderPrefix = 'igdb' | 'anilist-studio' | 'tmdb-company' | 'tmdb-network' | 'comicvine';

export interface CompanyRef {
  external_id: string;
  role: string;
}

const NUMERIC = /^\d+$/;
const PAGE_ID = /^(igdb|anilist-studio|tmdb-company|tmdb-network|comicvine):[A-Za-z0-9_-]+$/;

/** The page id for a stored company, or null when it has no provider id
 *  (a name-only fallback id) — those names stay plain text. */
export function companyPageId(company: CompanyRef, mediaType: string): string | null {
  const parts = company.external_id.split(':');
  if (parts[0] !== 'company') return null;
  if (parts.length === 2 && NUMERIC.test(parts[1])) return `igdb:${parts[1]}`;
  if (parts.length !== 3 || !NUMERIC.test(parts[2])) return null;
  const [, provider, id] = parts;
  switch (provider) {
    case 'anilist': return `anilist-studio:${id}`;
    // TV networks are stored as the series' 'publisher' (tmdb-mapper.ts).
    case 'tmdb': return company.role === 'publisher' && mediaType === 'series' ? `tmdb-network:${id}` : `tmdb-company:${id}`;
    case 'comicvine': return `comicvine:${id}`;
    default: return null;
  }
}

export function isCompanyPageId(id: string): boolean {
  return PAGE_ID.test(id);
}

export function companyPageUrl(pageId: string): string {
  return `/company?id=${encodeURIComponent(pageId)}`;
}

/** The link for a stored company, or null when it can't have a page. */
export function companyPageHref(company: CompanyRef, mediaType: string): string | null {
  const id = companyPageId(company, mediaType);
  return id ? companyPageUrl(id) : null;
}
