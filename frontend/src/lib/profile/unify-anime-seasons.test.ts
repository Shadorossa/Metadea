import { describe, expect, it } from 'vitest';
import { unifyAnimeSeasons } from './library-grouping';
import type { CatalogSummary, DbMediaRelation } from '../tauri/catalog';

const catalog = new Map<string, CatalogSummary>(
  [['anime:1', 2013], ['anime:2', 2017], ['anime:3', 2019]].map(([id, year]) => [
    id as string,
    { external_id: id, type: 'anime', title_main: `AoT ${id}`, release_year: year } as unknown as CatalogSummary,
  ]),
);
const rel = (a: string, b: string, type: string) =>
  ({ media_external_id: a, related_media_external_id: b, relation_type: type, type_label: '' }) as DbMediaRelation;
const relations = [rel('anime:1', 'anime:2', 'SEQUEL'), rel('anime:2', 'anime:1', 'PREQUEL'), rel('anime:2', 'anime:3', 'SEQUEL'), rel('anime:3', 'anime:2', 'PREQUEL')];
const item = (external_id: string, status: string) => ({ external_id, status, started_at: null });

describe('unifyAnimeSeasons', () => {
  it('merges watched seasons into one card', () => {
    const { consumedIds, groups } = unifyAnimeSeasons([item('anime:1', 'completed'), item('anime:2', 'completed'), item('anime:3', 'watching')], catalog, relations, {});
    expect(groups).toHaveLength(1);
    expect([...consumedIds].sort()).toEqual(['anime:1', 'anime:2', 'anime:3']);
  });

  it('leaves a planned season on its own and merges the rest', () => {
    const { consumedIds, groups } = unifyAnimeSeasons([item('anime:1', 'completed'), item('anime:2', 'completed'), item('anime:3', 'planning')], catalog, relations, {});
    expect(groups).toHaveLength(1);
    expect(groups[0].item.external_id).toBe('anime:1');
    expect(consumedIds.has('anime:3')).toBe(false);
  });

  it('unifies planned seasons among themselves, apart from the watched ones', () => {
    const { groups } = unifyAnimeSeasons([item('anime:1', 'completed'), item('anime:2', 'planning'), item('anime:3', 'planning')], catalog, relations, {});
    expect(groups).toHaveLength(1);
    expect(groups[0].item.external_id).toBe('anime:2');
    expect(groups[0].grouped.map(g => g.external_id)).toEqual(['anime:3']);
  });

  it('does not merge a lone watched season with a planned one', () => {
    const { groups } = unifyAnimeSeasons([item('anime:1', 'completed'), item('anime:2', 'planning')], catalog, relations, {});
    expect(groups).toHaveLength(0);
  });
});
