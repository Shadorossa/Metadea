// Render states of the company page pieces from fixtures — outside Tauri
// the page itself has no data, so the header, grid and meter are rendered
// directly with a provider-shaped page and a library snapshot.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { en } from '../../i18n/en';
import type { CompanyPageData, CompanyWork } from '../../lib/tauri/company-catalog';
import type { LibraryEntry } from '../../lib/tauri/library';
import type { CatalogSummary } from '../../lib/tauri/catalog';
import { DEFAULT_COMPANY_WORK_FILTERS } from '../../lib/company/company-works';
import type { LibrarySnapshot } from '../shared/hooks/useLibrarySnapshot';
import { CreatorCompletionBar } from '../shared/CreatorCompletionBar';
import { CompanyHeader } from './CompanyHeader';
import { CompanyWorks } from './CompanyWorks';
import { CareerTimeline, type CareerTimelineItem } from '../shared/CareerTimeline';

function work(id: string, title: string, year: number | null, extra: Partial<CompanyWork> = {}): CompanyWork {
  return {
    external_id: id, title, year, media_type: id.split(':')[0], roles: ['developer'],
    cover_url: `https://images.igdb.com/igdb/image/upload/t_cover_big/${id.replace(':', '')}.jpg`,
    is_extra: false, unreleased: false, ...extra,
  };
}

const PAGE: CompanyPageData = {
  provider_id: 'igdb:1020',
  source: 'igdb',
  name: 'FromSoftware',
  logo_url: null,
  description: 'A Japanese developer. '.repeat(30),
  country_code: 'JP',
  headquarters: null,
  founded_year: 1986,
  websites: ['https://www.fromsoftware.jp', 'javascript:alert(1)'],
  roles: ['developer', 'publisher'],
  total_hint: 6,
  works: [
    work('game:1', 'Dark Souls', 2011),
    work('game:2', 'Bloodborne', 2015, { roles: ['developer', 'publisher'] }),
    work('game:3', 'Sekiro', 2019, { score: 9 }),
    work('game:4', 'Elden Ring', 2022),
    work('game:5', 'The Old Hunters', 2015, { is_extra: true }),
    work('game:6', 'Next Game', null, { unreleased: true, cover_url: null }),
  ],
};

function snapshot(statuses: Record<string, string>): LibrarySnapshot {
  const libraryById = new Map(Object.entries(statuses).map(([id, status]) =>
    [id, { external_id: id, status, progress: 3 } as unknown as LibraryEntry]));
  const catalogById = new Map([['game:2', { external_id: 'game:2', total_count: 12 } as unknown as CatalogSummary]]);
  return { libraryById, catalogById };
}

const tc = en.creator_completion;

function renderHeader(page: CompanyPageData, withSnapshot: LibrarySnapshot | null) {
  const bar = createElement(CreatorCompletionBar, {
    kind: 'company', name: page.name, snapshot: withSnapshot, strings: tc,
    works: page.works.map(w => ({ externalId: w.external_id, type: w.media_type, unreleased: w.unreleased, isExtra: w.is_extra })),
  });
  return renderToStaticMarkup(createElement(CompanyHeader, { page, t: en.company_page }, bar));
}

function renderWorks(withSnapshot: LibrarySnapshot | null, works = PAGE.works) {
  return renderToStaticMarkup(createElement(CompanyWorks, {
    works, filters: DEFAULT_COMPANY_WORK_FILTERS, onFiltersChange: () => {}, snapshot: withSnapshot,
    loadingMore: false, t: en.company_page, tc, types: en.search.types,
  }));
}

describe('CompanyHeader', () => {
  it('falls back to an initials tile, shows roles, place, year and only safe links', () => {
    const html = renderHeader(PAGE, null);
    expect(html).toContain('company-logo-initials">F<');
    expect(html).toContain('>Developer<');
    expect(html).toContain('>Publisher<');
    expect(html).toContain('Founded 1986');
    expect(html).toContain('Japan');
    expect(html).toContain('company-description-text--collapsed');
    expect(html).toContain('>Show more<');
    expect(html).toContain('href="https://www.fromsoftware.jp"');
    expect(html).not.toContain('javascript:');
  });

  it('hides the completion meter when the user has none of the works', () => {
    expect(renderHeader(PAGE, snapshot({}))).not.toContain('saga-completion');
  });

  it('shows the headline, excluding DLC and unreleased works', () => {
    const html = renderHeader(PAGE, snapshot({ 'game:1': 'completed', 'game:3': 'completed', 'game:2': 'playing' }));
    expect(html).toContain("You&#x27;ve played 2 of 4 FromSoftware games");
    expect(html).toContain('50 %');
    expect(html).toContain('1 unreleased (not counted)');
    expect(html).toContain('1 DLC or bundles (not counted)');
  });
});

describe('CompanyWorks', () => {
  it('renders medium covers linking to the media page, with DLC hidden by default', () => {
    const html = renderWorks(null);
    expect(html.match(/class="company-work-card/g)).toHaveLength(5);
    expect(html).toContain('href="/media?id=game:1"');
    expect(html).toContain('t_cover_big/game1.jpg');
    expect(html).not.toContain('The Old Hunters');
    expect(html).toContain('>Upcoming<');
    expect(html).toContain('5 works');
  });

  it('marks each card with the user state', () => {
    const html = renderWorks(snapshot({ 'game:1': 'completed', 'game:2': 'playing', 'game:3': 'planning' }));
    expect(html).toMatch(/company-work-card creator-work creator-work--completed"[^>]*href="\/media\?id=game:1"|href="\/media\?id=game:1" class="company-work-card creator-work creator-work--completed"/);
    expect(html).toContain('creator-work-tag--completed');
    expect(html).toContain('creator-work--in-progress');
    expect(html).toContain('aria-valuenow="25"');
    expect(html).toContain('creator-work-tag--planned');
    expect(html).toContain('creator-work--missing');
  });

  it('offers the role filter only when both sides exist and says when nothing matches', () => {
    expect(renderWorks(null)).toContain('>Developed<');
    const html = renderWorks(null, []);
    expect(html).not.toContain('>Developed<');
    expect(html).toContain('No works found.');
  });
});

describe('CompanyHeader links', () => {
  it('shows the provider logo button and keeps provider pages out of the website links', () => {
    const html = renderHeader({ ...PAGE, provider_id: 'anilist-studio:11', websites: ['https://anilist.co/studio/11', 'https://www.mappa.co.jp'] }, null);
    expect(html).toContain('src="/API/Anilist_logo.png"');
    expect(html).toContain('href="https://www.mappa.co.jp"');
    expect(html).not.toContain('href="https://anilist.co/studio/11"');
  });
});

describe('CompanyWorks masterpieces', () => {
  it('offers the masterpieces filter once a work is scored 8+', () => {
    expect(renderWorks(null)).toContain('>Masterpieces only<');
    expect(renderWorks(null, PAGE.works.map(w => ({ ...w, score: null })))).not.toContain('Masterpieces only');
    // Grid / Timeline are icon buttons named by their labels.
    expect(renderWorks(null)).toContain('aria-label="Grid"');
    expect(renderWorks(null)).toContain('aria-label="Timeline"');
  });
});

describe('CareerTimeline', () => {
  const item = (id: string, year: number | null, score: number | null, state: CareerTimelineItem['state'] = null): CareerTimelineItem => ({
    id, href: `/media?id=${id}`, title: `Title ${id}`, year, cover: null, score, state, progress: null,
  });
  const items = [item('game:1', 1994, 7), item('game:2', 2011, 9.1, 'completed'), item('game:3', 2015, 8), item('game:4', null, null)];

  it('renders year columns, decade separators and the undated bucket', () => {
    const html = renderToStaticMarkup(createElement(CareerTimeline, { items, strings: tc }));
    expect(html).toContain('>1990s<');
    expect(html).toContain('>2010s<');
    expect(html).toContain('>Undated<');
    expect(html).toContain('>1994<');
    expect(html).toContain('href="/media?id=game:2"');
    expect(html).toContain('aria-label="Career timeline"');
  });

  it('gives masterpieces the halo and the star, and keeps the completion states', () => {
    const html = renderToStaticMarkup(createElement(CareerTimeline, { items, strings: tc }));
    expect(html.match(/career-work--masterpiece/g)).toHaveLength(2);
    expect(html.match(/career-work-star/g)).toHaveLength(2);
    expect(html).toContain('aria-label="Title game:2 · 2011 · Masterpiece"');
    expect(html).toContain('creator-work--completed');
    expect(html).toContain('creator-work-tag--completed');
  });
});
