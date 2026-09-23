import { describe, it, expect, vi } from 'vitest';

vi.mock('../tauri/catalog', () => ({ getBlockedExternalIds: vi.fn(), getReclassifiedExternalIds: vi.fn() }));
import type { CompanyWork } from '../tauri/company-catalog';
import type { WorkLibraryState } from '../media/creator-completion';
import {
  availableTypes,
  companyInitials,
  DEFAULT_COMPANY_WORK_FILTERS,
  filterAndSortWorks,
  applySearchExclusions,
  hasExtras,
  hasMasterpieces,
  hasRoleSplit,
  type CompanyWorkFilters,
} from './company-works';

function work(id: string, title: string, year: number | null, extra: Partial<CompanyWork> = {}): CompanyWork {
  return {
    external_id: id, title, year, cover_url: null, media_type: id.split(':')[0],
    roles: ['developer'], is_extra: false, unreleased: false, ...extra,
  };
}

const works: CompanyWork[] = [
  work('game:1', 'Dark Souls', 2011),
  work('game:2', 'Bloodborne', 2015, { roles: ['developer', 'publisher'] }),
  work('game:3', 'Bloodborne: The Old Hunters', 2015, { is_extra: true }),
  work('game:4', 'Elden Ring 2', null, { unreleased: true }),
  work('game:5', 'Another Studio Game', 2010, { roles: ['publisher'] }),
  work('vnovel:6', 'armored core 10', 2005),
  work('vnovel:7', 'Armored Core 2', 2005),
];

const states: Record<string, WorkLibraryState> = { 'game:1': 'completed', 'game:2': 'in_progress', 'vnovel:6': 'planned' };
const stateOf = (id: string): WorkLibraryState => states[id] ?? 'missing';
const run = (patch: Partial<CompanyWorkFilters>) =>
  filterAndSortWorks(works, { ...DEFAULT_COMPANY_WORK_FILTERS, ...patch }, stateOf).map(w => w.external_id);

describe('filterAndSortWorks', () => {
  it('hides extras by default and sorts by year, undated last, ties by title', () => {
    expect(run({})).toEqual(['game:2', 'game:1', 'game:5', 'vnovel:7', 'vnovel:6', 'game:4']);
    expect(run({ includeExtras: true })).toContain('game:3');
  });

  it('filters by role side', () => {
    expect(run({ role: 'published' })).toEqual(['game:2', 'game:5']);
    expect(run({ role: 'developed' })).not.toContain('game:5');
  });

  it('filters by type', () => {
    expect(run({ type: 'vnovel' })).toEqual(['vnovel:7', 'vnovel:6']);
  });

  it('sorts titles naturally and case-insensitively', () => {
    expect(run({ type: 'vnovel', sort: 'title' })).toEqual(['vnovel:7', 'vnovel:6']);
    expect(run({ sort: 'title' })[0]).toBe('game:5');
  });

  it('sorts by the user status: in progress, completed, planned, then the rest', () => {
    expect(run({ sort: 'status' }).slice(0, 3)).toEqual(['game:2', 'game:1', 'vnovel:6']);
  });

  it('shows only released works the user has not touched', () => {
    expect(run({ onlyMissing: true })).toEqual(['game:5', 'vnovel:7']);
  });

  it('does not mutate its input', () => {
    const before = works.map(w => w.external_id);
    run({ sort: 'title' });
    expect(works.map(w => w.external_id)).toEqual(before);
  });
});

describe('work list helpers', () => {
  it('reports types by frequency, the role split and extras', () => {
    expect(availableTypes(works)).toEqual(['game', 'vnovel']);
    expect(hasRoleSplit(works)).toBe(true);
    expect(hasRoleSplit([work('anime:1', 'A', 2000, { roles: ['studio'] })])).toBe(false);
    expect(hasRoleSplit([work('series:1', 'A', 2000, { roles: ['network'] }), work('series:2', 'B', 2001, { roles: ['production'] })])).toBe(true);
    expect(hasExtras(works)).toBe(true);
    expect(hasExtras(works.filter(w => !w.is_extra))).toBe(false);
  });

  it('builds initials for the logo tile', () => {
    expect(companyInitials('FromSoftware')).toBe('F');
    expect(companyInitials('Kyoto Animation')).toBe('KA');
    expect(companyInitials('  studio  ghibli, inc. ')).toBe('SG');
    expect(companyInitials('— ')).toBe('?');
    expect(companyInitials('京都アニメーション')).toBe('京');
  });
});

describe('masterpieces filter', () => {
  const scored = [work('game:1', 'A', 2000, { score: 8 }), work('game:2', 'B', 2001, { score: 7.9 }), work('game:3', 'C', 2002)];
  it('keeps only works scored 8 or more', () => {
    const shown = filterAndSortWorks(scored, { ...DEFAULT_COMPANY_WORK_FILTERS, masterpiecesOnly: true }, () => 'missing');
    expect(shown.map(w => w.external_id)).toEqual(['game:1']);
    expect(hasMasterpieces(scored)).toBe(true);
    expect(hasMasterpieces(works)).toBe(false);
  });
});

describe('applySearchExclusions', () => {
  const context = { blocked: new Set(['game:1']), reclassified: new Set(['game:2']), showAdult: false, source: 'igdb' };

  it('drops blocked, reclassified and adult works like Search', () => {
    const list = [
      work('game:1', 'Blocked', 2000), work('game:2', 'Reclassified', 2001),
      work('anime:3', 'Adult', 2002, { is_adult: true }), work('anime:4', 'Fine', 2003),
    ];
    expect(applySearchExclusions(list, context).map(w => w.external_id)).toEqual(['anime:4']);
    expect(applySearchExclusions(list, { ...context, showAdult: true }).map(w => w.external_id)).toEqual(['anime:3', 'anime:4']);
  });

  it('applies the local-catalog rules only to pages rebuilt from it, DLC kept as an extra', () => {
    const list = [
      work('game:5', 'Remaster', 2010, { format: 'REMASTER' }),
      work('game:6', 'Add-on', 2011, { format: 'DLC' }),
      work('game:7', 'Game: Definitive Edition', 2012),
      work('game:8', 'Game', 2013),
    ];
    const local = applySearchExclusions(list, { ...context, source: 'local' });
    expect(local.map(w => w.external_id)).toEqual(['game:6', 'game:8']);
    expect(local[0].is_extra).toBe(true);
    // Live providers already filtered in Rust: nothing more is dropped.
    expect(applySearchExclusions(list, context)).toHaveLength(4);
  });
});
