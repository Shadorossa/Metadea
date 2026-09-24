import { describe, it, expect } from 'vitest';
import { buildSpoilerIndex, type SpoilerLibraryRow, type SpoilerRelation } from './spoiler-franchises';
import { createSpoilerEvaluator } from './spoiler-evaluator';
import { DEFAULT_SPOILER_SETTINGS } from './spoiler-settings';

// Cross-medium stories: the owner's Frieren case. Three anime seasons, the
// source manga (never added to the library) and a spin-off manga.
const row = (external_id: string, status: string | null, progress = 0): SpoilerLibraryRow => ({
  external_id, type: external_id.split(':')[0], status, progress, progress_2: 0,
});
const cat = (external_id: string, title: string, release_year: number, status = 'FINISHED') => ({
  external_id, type: external_id.split(':')[0], title_main: title, release_year, status, total_count: 28,
});
const rel = (a: string, b: string, relation_type: string): SpoilerRelation => ({
  media_external_id: a, related_media_external_id: b, relation_type,
});

const catalog = [
  cat('manga:100', 'Sousou no Frieren', 2020, 'RELEASING'),
  cat('anime:1', 'Sousou no Frieren', 2023),
  cat('anime:2', 'Sousou no Frieren 2nd Season', 2025),
  cat('anime:3', 'Sousou no Frieren 3rd Season', 2026),
  cat('manga:200', 'Frieren Spin-off', 2024),
];
const relations = [
  rel('anime:1', 'anime:2', 'SEQUEL'),
  rel('anime:2', 'anime:3', 'SEQUEL'),
  rel('anime:1', 'manga:100', 'SOURCE'),
  rel('manga:100', 'anime:1', 'ADAPTATION'),
  rel('manga:100', 'manga:200', 'SPIN_OFF'),
  rel('anime:1', 'manga:200', 'CHARACTER'),
];

// Who appears where.
const FRIEREN = ['anime:1', 'anime:2', 'anime:3', 'manga:100'];
const SEASON3_ONLY = ['anime:3', 'manga:100'];
const MANGA_ONLY = ['manga:100'];
const SPIN_OFF_ONLY = ['manga:200'];

const allSeasons = [row('anime:1', 'completed', 28), row('anime:2', 'completed', 28), row('anime:3', 'completed', 28)];

function evaluator(library: SpoilerLibraryRow[], revealed: string[] = []) {
  const index = buildSpoilerIndex({ library, catalog, relations, currentYear: 2026 });
  return createSpoilerEvaluator({
    index,
    settings: DEFAULT_SPOILER_SETTINGS,
    isFranchiseRevealed: ids => ids.some(id => revealed.includes(id)),
  });
}

describe('cross-medium stories', () => {
  it('joins the anime chain and its source manga, leaving the spin-off out', () => {
    const index = buildSpoilerIndex({ library: allSeasons, catalog, relations, currentYear: 2026 });
    const story = index.storyOf('anime:2');
    expect(story.memberIds).toEqual(['manga:100', 'anime:1', 'anime:2', 'anime:3']);
    expect(index.storyOf('manga:100')).toBe(story);
    expect(story.isProtected).toBe(true);
    // The per-medium chain itself is done, as before.
    expect(index.franchiseOf('anime:2').isCompleted).toBe(true);
    expect(index.storyOf('manga:200').memberIds).toEqual(['manga:200']);
  });

  it('marks a manga-only character as a late debut once every season is watched', () => {
    const shield = evaluator(allSeasons).characterShield(MANGA_ONLY);
    expect(shield?.lateDebutWorkId).toBe('manga:100');
    expect(shield?.hideImage).toBe(true);
    expect(shield?.hideBiography).toBe(true);
    expect(shield?.franchise.memberIds).toContain('anime:1');
  });

  it('keeps the anime cast known on both sides', () => {
    const spoilers = evaluator(allSeasons);
    expect(spoilers.characterShield(FRIEREN)).toBeNull();
    expect(spoilers.characterShield(SEASON3_ONLY)).toBeNull();
  });

  it('compares the manga page cast with the watched seasons', () => {
    expect(evaluator(allSeasons).castComparisonWorks('manga:100')).toEqual(['anime:1', 'anime:2', 'anime:3']);
  });

  it('knows everyone once the manga is completed too', () => {
    const spoilers = evaluator([...allSeasons, row('manga:100', 'completed', 140)]);
    expect(spoilers.characterShield(MANGA_ONLY)).toBeNull();
    expect(spoilers.activeStory('manga:100')).toBeNull();
    expect(spoilers.castComparisonWorks('manga:100')).toBeNull();
  });

  it('makes a partly watched season known only when there is progress in it', () => {
    const library = [row('anime:1', 'completed', 28), row('anime:2', 'completed', 28)];
    const planned = evaluator([...library, row('anime:3', 'watching', 0)]);
    expect(planned.characterShield(SEASON3_ONLY)?.lateDebutWorkId).toBe('manga:100');
    const started = evaluator([...library, row('anime:3', 'watching', 4)]);
    expect(started.characterShield(SEASON3_ONLY)?.lateDebutWorkId ?? null).toBeNull();
  });

  it('uses the debut episode when it is known', () => {
    const library = [row('anime:1', 'completed', 28), row('anime:2', 'completed', 28), row('anime:3', 'watching', 4)];
    const spoilers = evaluator(library);
    const debutAt = (episode: number) => (workId: string) => (workId === 'anime:3' ? episode : null);
    expect(spoilers.characterShield(SEASON3_ONLY, debutAt(9))?.lateDebutWorkId).toBe('manga:100');
    expect(spoilers.characterShield(SEASON3_ONLY, debutAt(3))?.lateDebutWorkId ?? null).toBeNull();
  });

  it('does not protect through a spin-off', () => {
    const spoilers = evaluator(allSeasons);
    expect(spoilers.characterShield(SPIN_OFF_ONLY)).toBeNull();
    expect(spoilers.castComparisonWorks('manga:200')).toBeNull();
  });

  it('says nothing about a story the user consumed nothing of', () => {
    expect(evaluator([row('anime:1', 'planning')]).characterShield(MANGA_ONLY)).toBeNull();
  });

  it('lets a revealed franchise override everything', () => {
    const spoilers = evaluator(allSeasons, ['manga:100']);
    expect(spoilers.characterShield(MANGA_ONLY)).toBeNull();
    expect(spoilers.castComparisonWorks('manga:100')).toBeNull();
  });
});
