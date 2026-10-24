import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STORAGE_KEYS } from '../storage/storage-keys';
import { getResultsGridColumns, getUrlSearchParams, loadPersistedSearchState } from './search-island-state';

function stubWindow(overrides: { search?: string; innerWidth?: number }) {
  vi.stubGlobal('window', {
    location: { search: overrides.search ?? '' },
    innerWidth: overrides.innerWidth ?? 1920,
  });
}

function stubSessionStorage(store: Record<string, string> | null) {
  vi.stubGlobal('sessionStorage', {
    getItem: (key: string) => {
      if (store === null) throw new Error('sessionStorage unavailable');
      return key in store ? store[key] : null;
    },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('loadPersistedSearchState', () => {
  it('returns null when nothing is stored', () => {
    stubSessionStorage({});
    expect(loadPersistedSearchState()).toBeNull();
  });

  it('returns the parsed state when it has a query', () => {
    const state = {
      query: 'naruto', mediaType: 'anime', results: [], status: 'done', page: 2, hasMore: true,
      sortField: 'scoreGlobal', sortDirection: 'asc',
    };
    stubSessionStorage({ [STORAGE_KEYS.searchState]: JSON.stringify(state) });
    expect(loadPersistedSearchState()).toEqual(state);
  });

  it('returns null for a stored state with an empty query', () => {
    stubSessionStorage({ [STORAGE_KEYS.searchState]: JSON.stringify({ query: '', mediaType: 'all', results: [] }) });
    expect(loadPersistedSearchState()).toBeNull();
  });

  it('returns null on malformed JSON', () => {
    stubSessionStorage({ [STORAGE_KEYS.searchState]: '{not json' });
    expect(loadPersistedSearchState()).toBeNull();
  });

  it('returns null when sessionStorage throws', () => {
    stubSessionStorage(null);
    expect(loadPersistedSearchState()).toBeNull();
  });
});

describe('getUrlSearchParams', () => {
  it('returns null without a ?q', () => {
    stubWindow({ search: '?type=anime' });
    expect(getUrlSearchParams()).toBeNull();
  });

  it('returns null for an empty ?q', () => {
    stubWindow({ search: '?q=&type=anime' });
    expect(getUrlSearchParams()).toBeNull();
  });

  it('reads query and a known type', () => {
    stubWindow({ search: '?q=real%20madrid&type=anime' });
    expect(getUrlSearchParams()).toEqual({ query: 'real madrid', mediaType: 'anime' });
  });

  it('falls back to "all" for an unknown type', () => {
    stubWindow({ search: '?q=x&type=podcast' });
    expect(getUrlSearchParams()).toEqual({ query: 'x', mediaType: 'all' });
  });

  it('defaults type to "all" when absent', () => {
    stubWindow({ search: '?q=zelda' });
    expect(getUrlSearchParams()).toEqual({ query: 'zelda', mediaType: 'all' });
  });
});

describe('getResultsGridColumns', () => {
  beforeEach(() => stubWindow({}));

  it.each([
    [1920, 12], [1280, 12], [1279, 10], [1024, 10], [1023, 8], [768, 8], [767, 7], [640, 7], [639, 6], [480, 6], [479, 5], [320, 5],
  ])('width %i -> %i columns', (width, columns) => {
    stubWindow({ innerWidth: width });
    expect(getResultsGridColumns()).toBe(columns);
  });
});
