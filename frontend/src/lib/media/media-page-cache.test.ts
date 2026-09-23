import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { MediaPageData } from './types';

vi.mock('./media-cache', () => ({ setCachedMediaData: vi.fn() }));

import { setCachedMediaData } from './media-cache';
import { API_SPORTS_EVENT_BANNER_COLOR } from './constants';
import { normalizeCachedApiSportsCompetition } from './media-page-cache';

const page = (externalId: string, extra: Partial<MediaPageData> = {}): MediaPageData => ({
  externalId, type: 'event', titleMain: externalId, bannerColor: 'plain',
  metaLines: [], stats: [], characters: [], relations: [], progressStatus: 'watching', progressLabel: '',
  ...extra,
});

const season = { seasonNumber: 2024, coverUrl: null };

beforeEach(() => { vi.clearAllMocks(); });

describe('normalizeCachedApiSportsCompetition', () => {
  it('leaves non-competition ids and season-less competitions untouched', () => {
    const anime = page('anime:1', { seasons: [season] });
    expect(normalizeCachedApiSportsCompetition('anime:1', anime)).toBe(anime);
    const noSeasons = page('event:apisports:football:39');
    expect(normalizeCachedApiSportsCompetition('event:apisports:football:39', noSeasons)).toBe(noSeasons);
    const fixture = page('event:apisports:football:39:100', { seasons: [season] });
    expect(normalizeCachedApiSportsCompetition('event:apisports:football:39:100', fixture)).toBe(fixture);
    expect(setCachedMediaData).not.toHaveBeenCalled();
  });

  it('returns an already-normalized competition as-is without rewriting the cache', () => {
    const ok = page('event:apisports:basketball:12', { seasons: [season], format: 'Season', bannerColor: API_SPORTS_EVENT_BANNER_COLOR });
    expect(normalizeCachedApiSportsCompetition('event:apisports:basketball:12', ok)).toBe(ok);
    expect(setCachedMediaData).not.toHaveBeenCalled();
  });

  it('repairs a stale competition entry and writes the repaired copy back', () => {
    const stale = page('event:apisports:football:39', { seasons: [season], format: 'League' });
    const fixed = normalizeCachedApiSportsCompetition('event:apisports:football:39', stale);
    expect(fixed).not.toBe(stale);
    expect(fixed).toMatchObject({ format: 'Season', bannerColor: API_SPORTS_EVENT_BANNER_COLOR, seasons: [season] });
    expect(setCachedMediaData).toHaveBeenCalledWith('event:apisports:football:39', fixed);
  });
});
