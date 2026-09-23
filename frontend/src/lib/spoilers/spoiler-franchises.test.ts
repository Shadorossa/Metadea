import { describe, it, expect } from 'vitest';
import { buildSpoilerIndex, chainToRelations, isRowStarted, type SpoilerLibraryRow, type SpoilerRelation } from './spoiler-franchises';

const row = (external_id: string, status: string | null, progress = 0, progress_2 = 0): SpoilerLibraryRow => ({
  external_id, type: external_id.split(':')[0], status, progress, progress_2,
});
const cat = (external_id: string, title: string, release_year = 2020, status: string | null = 'FINISHED') => ({
  external_id, type: external_id.split(':')[0], title_main: title, release_year, status,
});
const sequel = (a: string, b: string): SpoilerRelation => ({ media_external_id: a, related_media_external_id: b, relation_type: 'SEQUEL' });
const prequel = (a: string, b: string): SpoilerRelation => ({ media_external_id: a, related_media_external_id: b, relation_type: 'PREQUEL' });

// Jujutsu Kaisen: S1 → S2 → S3, plus the source manga (another medium).
const catalog = [
  cat('anime:1', 'Jujutsu Kaisen', 2020),
  cat('anime:2', 'Jujutsu Kaisen 2nd Season', 2023),
  cat('anime:3', 'Jujutsu Kaisen 3rd Season', 2026),
  cat('manga:10', 'Jujutsu Kaisen', 2018),
];
const relations = [
  sequel('anime:1', 'anime:2'),
  prequel('anime:3', 'anime:2'),
  { media_external_id: 'anime:1', related_media_external_id: 'manga:10', relation_type: 'SOURCE' },
];

describe('buildSpoilerIndex', () => {
  it('groups one medium chain and orders it prequels first', () => {
    const index = buildSpoilerIndex({ library: [row('anime:1', 'watching', 5)], catalog, relations, currentYear: 2026 });
    const franchise = index.franchiseOf('anime:2');
    expect(franchise.memberIds).toEqual(['anime:1', 'anime:2', 'anime:3']);
    expect(franchise.name).toBe('Jujutsu Kaisen');
    expect(index.franchiseOf('anime:1')).toBe(franchise);
    expect([...index.predecessorsOf('anime:3')].sort()).toEqual(['anime:1', 'anime:2']);
  });

  it('keeps the source manga out of the anime franchise', () => {
    const index = buildSpoilerIndex({ library: [row('anime:1', 'watching', 5)], catalog, relations, currentYear: 2026 });
    expect(index.franchiseOf('manga:10').memberIds).toEqual(['manga:10']);
    expect(index.franchiseOf('manga:10').isProtected).toBe(false);
  });

  it('protects a chain with any engaging library row until every released entry is completed', () => {
    const watching = buildSpoilerIndex({ library: [row('anime:1', 'watching', 5)], catalog, relations, currentYear: 2026 });
    expect(watching.franchiseOf('anime:3').isProtected).toBe(true);

    const planning = buildSpoilerIndex({ library: [row('anime:2', 'planning')], catalog, relations, currentYear: 2026 });
    expect(planning.franchiseOf('anime:1').isProtected).toBe(true);

    const allDone = buildSpoilerIndex({
      library: [row('anime:1', 'completed', 24), row('anime:2', 'completed', 23), row('anime:3', 'completed', 12)],
      catalog, relations, currentYear: 2026,
    });
    expect(allDone.franchiseOf('anime:2').isProtected).toBe(false);
    expect(allDone.franchiseOf('anime:2').isCompleted).toBe(true);
  });

  it('does not wait for unreleased entries to count a chain as completed', () => {
    const upcoming = [...catalog.slice(0, 2), cat('anime:3', 'Jujutsu Kaisen 3rd Season', 2027, 'NOT_YET_RELEASED')];
    const index = buildSpoilerIndex({
      library: [row('anime:1', 'completed', 24), row('anime:2', 'completed', 23)],
      catalog: upcoming, relations, currentYear: 2026,
    });
    expect(index.franchiseOf('anime:3').isCompleted).toBe(true);
    expect(index.franchiseOf('anime:3').isProtected).toBe(false);
  });

  it('ignores a dropped row with no progress but not a partially watched one', () => {
    const untouched = buildSpoilerIndex({ library: [row('anime:1', 'dropped')], catalog, relations, currentYear: 2026 });
    expect(untouched.franchiseOf('anime:1').isProtected).toBe(false);
    const partial = buildSpoilerIndex({ library: [row('anime:1', 'dropped', 3)], catalog, relations, currentYear: 2026 });
    expect(partial.franchiseOf('anime:1').isProtected).toBe(true);
  });

  it('treats a work with no relations as a franchise of its own', () => {
    const index = buildSpoilerIndex({ library: [row('manga:50', 'reading', 12)], catalog: [cat('manga:50', 'Solo')], relations: [], currentYear: 2026 });
    const franchise = index.franchiseOf('manga:50');
    expect(franchise.memberIds).toEqual(['manga:50']);
    expect(franchise.isProtected).toBe(true);
  });

  it('reads started works from progress or a status beyond planning', () => {
    expect(isRowStarted(undefined)).toBe(false);
    expect(isRowStarted({ status: 'planning', progress: 0 })).toBe(false);
    expect(isRowStarted({ status: 'planning', progress: 2 })).toBe(true);
    expect(isRowStarted({ status: 'watching', progress: 0 })).toBe(true);
    expect(isRowStarted({ status: null, progress: 0, progress_2: 1 })).toBe(true);
  });

  it('turns an ordered chain into sequel relations', () => {
    expect(chainToRelations(['anime:1', 'anime:2', 'anime:3'])).toEqual([
      sequel('anime:1', 'anime:2'),
      sequel('anime:2', 'anime:3'),
    ]);
  });
});
