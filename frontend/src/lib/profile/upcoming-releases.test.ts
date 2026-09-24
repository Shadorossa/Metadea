import { describe, expect, it } from 'vitest';
import { computeUpcomingPlanningReleases } from './stats-calculators';
import type { CatalogSummary } from '../tauri/catalog';

const row = (external_id: string, format: string | null) =>
  ({ external_id, type: 'anime', format, title_main: external_id, cover_url: '', release_year: 2026, release_month: 10, release_day: 5 }) as unknown as CatalogSummary;
const item = (external_id: string, status = 'planning', selected_version: string | null = null) =>
  ({ external_id, status, selected_version }) as never;

describe('computeUpcomingPlanningReleases', () => {
  it('includes planned seasons, not only standalone works', () => {
    const catalog = new Map([['anime:1', row('anime:1', 'TV')], ['anime:2', row('anime:2', 'SEASON')]]);
    const out = computeUpcomingPlanningReleases([item('anime:1'), item('anime:2')], catalog, new Date(2026, 9, 1));
    expect(out.map(r => r.externalId).sort()).toEqual(['anime:1', 'anime:2']);
  });

  it('skips entries that are only an edition picked on another one', () => {
    const catalog = new Map([['game:1', row('game:1', null)], ['game:2', row('game:2', null)]]);
    const out = computeUpcomingPlanningReleases([item('game:1', 'planning', 'game:2'), item('game:2')], catalog, new Date(2026, 9, 1));
    expect(out.map(r => r.externalId)).toEqual(['game:1']);
  });
});
