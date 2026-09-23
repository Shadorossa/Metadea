import { describe, it, expect } from 'vitest';
import { buildSpoilerIndex, type SpoilerLibraryRow } from './spoiler-franchises';
import { createSpoilerEvaluator } from './spoiler-evaluator';
import { DEFAULT_SPOILER_SETTINGS, type SpoilerSettings } from './spoiler-settings';

const row = (external_id: string, status: string | null, progress = 0): SpoilerLibraryRow => ({
  external_id, type: external_id.split(':')[0], status, progress, progress_2: 0,
});
const cat = (external_id: string, title: string, release_year: number, total_count = 24) => ({
  external_id, type: external_id.split(':')[0], title_main: title, release_year, status: 'FINISHED', total_count,
});

const catalog = [
  cat('anime:1', 'Jujutsu Kaisen', 2020),
  cat('anime:2', 'Jujutsu Kaisen 2nd Season', 2023),
  cat('anime:3', 'Jujutsu Kaisen 3rd Season', 2025),
  cat('manga:10', 'Jujutsu Kaisen', 2018),
];
const relations = [
  { media_external_id: 'anime:1', related_media_external_id: 'anime:2', relation_type: 'SEQUEL' },
  { media_external_id: 'anime:2', related_media_external_id: 'anime:3', relation_type: 'SEQUEL' },
];

function evaluator(library: SpoilerLibraryRow[], settings: Partial<SpoilerSettings> = {}, revealed: string[] = []) {
  const index = buildSpoilerIndex({ library, catalog, relations, currentYear: 2026 });
  return createSpoilerEvaluator({
    index,
    settings: { ...DEFAULT_SPOILER_SETTINGS, ...settings },
    isFranchiseRevealed: ids => ids.some(id => revealed.includes(id)),
  });
}

// The owner's case: halfway through the first season.
const watchingS1 = [row('anime:1', 'watching', 15)];

describe('createSpoilerEvaluator', () => {
  it('hides episodes past the watched count, keeping the ones already seen', () => {
    const spoilers = evaluator(watchingS1);
    const episodes = [15, 16].map(n => ({ external_id: 'anime:1', episode_number: n }));
    const offsets = spoilers.episodeOffsets(episodes, 'anime:1');
    expect(spoilers.isEpisodeHidden(episodes[0], 'anime:1', offsets)).toBe(false);
    expect(spoilers.isEpisodeHidden(episodes[1], 'anime:1', offsets)).toBe(true);
    expect(spoilers.isEpisodeHidden({ external_id: 'anime:1', episode_number: -1 }, 'anime:1', offsets)).toBe(true);
  });

  it('judges each season of a unified list by its own progress', () => {
    const spoilers = evaluator([row('anime:1', 'completed', 24), row('anime:2', 'watching', 3)]);
    const episodes = [
      { external_id: 'anime:1', episode_number: 24 },
      { external_id: 'anime:2', episode_number: 25 },
      { external_id: 'anime:2', episode_number: 28 },
    ];
    const offsets = spoilers.episodeOffsets(episodes, 'anime:1');
    expect(episodes.map(ep => spoilers.isEpisodeHidden(ep, 'anime:1', offsets))).toEqual([false, false, true]);
  });

  it('marks later unstarted seasons as future work, synopsis always, cover only by setting', () => {
    const spoilers = evaluator(watchingS1);
    expect(spoilers.isFutureWork('anime:1')).toBe(false);
    expect(spoilers.isSynopsisHidden('anime:3')).toBe(true);
    expect(spoilers.isCoverHidden('anime:3')).toBe(false);
    expect(evaluator(watchingS1, { hideFutureCovers: true }).isCoverHidden('anime:3')).toBe(true);
    // Nothing in the library for the manga chain: not protected.
    expect(spoilers.isSynopsisHidden('manga:10')).toBe(false);
  });

  it('shows the next season once everything before it is completed', () => {
    const spoilers = evaluator([row('anime:1', 'completed', 24), row('anime:2', 'planning')]);
    expect(spoilers.isFutureWork('anime:2')).toBe(false);
    expect(spoilers.isFutureWork('anime:3')).toBe(true);
  });

  it('switches everything off with the setting or a franchise reveal', () => {
    expect(evaluator(watchingS1, { enabled: false }).isSynopsisHidden('anime:3')).toBe(false);
    expect(evaluator(watchingS1, {}, ['anime:2']).isSynopsisHidden('anime:3')).toBe(false);
    expect(evaluator(watchingS1, {}, ['anime:2']).characterShield(['anime:1'])).toBeNull();
  });

  it('hides arcs that start after the current episode, keeping the current one', () => {
    const spoilers = evaluator(watchingS1);
    expect(spoilers.isArcHidden([{ media_external_id: 'anime:1', ep_start: 9 }])).toBe(false);
    expect(spoilers.isArcHidden([{ media_external_id: 'anime:1', ep_start: 16 }])).toBe(false);
    expect(spoilers.isArcHidden([{ media_external_id: 'anime:1', ep_start: 17 }])).toBe(true);
    expect(spoilers.isArcHidden([{ media_external_id: 'anime:3', ep_start: 1 }])).toBe(true);
    // The manga item says nothing: that chain is not followed.
    expect(spoilers.isArcHidden([
      { media_external_id: 'anime:1', ep_start: 20 },
      { media_external_id: 'manga:10', ep_start: 1 },
    ])).toBe(true);
    expect(spoilers.isArcHidden([{ media_external_id: 'manga:10', ep_start: 200 }])).toBe(false);
  });

  it('shields a character of a protected franchise: stats always, biography in strict mode', () => {
    const normal = evaluator(watchingS1).characterShield(['anime:1', 'anime:2', 'manga:10']);
    expect(normal).toMatchObject({ hideSensitiveStats: true, hideBiography: false, hideImage: false, lateDebutWorkId: null });
    expect(normal?.franchise.name).toBe('Jujutsu Kaisen');
    const strict = evaluator(watchingS1, { level: 'strict' }).characterShield(['anime:1']);
    expect(strict?.hideBiography).toBe(true);
    expect(evaluator([]).characterShield(['anime:1'])).toBeNull();
  });

  it('blurs a late-debut character and names the work they appear in', () => {
    const shield = evaluator(watchingS1).characterShield(['anime:2', 'anime:3']);
    expect(shield).toMatchObject({ hideImage: true, hideBiography: true, lateDebutWorkId: 'anime:2' });
  });

  it('lifts the shield for a character from a chain the user completed', () => {
    const library = [row('manga:10', 'completed', 271), row('anime:1', 'watching', 3)];
    expect(evaluator(library).characterShield(['anime:1', 'manga:10'])).toBeNull();
  });

  it('compares the cast of an unstarted season with the started ones', () => {
    const spoilers = evaluator(watchingS1);
    expect(spoilers.castComparisonWorks('anime:2')).toEqual(['anime:1']);
    expect(spoilers.castComparisonWorks('anime:1')).toBeNull();
  });
});
