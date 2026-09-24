// The spoiler shield's decisions: given the franchise index, the settings
// and the franchise-level reveals, what gets hidden on a page. Item-level
// (session) reveals are applied by the caller on top of these answers.
// Pure — tested in spoiler-evaluator.test.ts.
import type { SpoilerFranchise, SpoilerIndex } from './spoiler-franchises';
import type { SpoilerSettings } from './spoiler-settings';
import {
  episodeOffsets,
  episodePositionInWork,
  isRangeAhead,
  isUnitAhead,
  primaryUnitForType,
  type NumberedEpisode,
} from './spoiler-progress';
import { detectLateDebut } from './spoiler-late-debut';

export interface SpoilerArcItem {
  media_external_id: string;
  ep_start: number | null;
}

export interface CharacterShield {
  franchise: SpoilerFranchise;
  /** Status and the other sensitive stat lines (lib/spoilers/spoiler-stat-lines). */
  hideSensitiveStats: boolean;
  hideBiography: boolean;
  hideImage: boolean;
  /** The first work of the story the character appears in, when none of
   *  them was consumed by the user ("Appears in <work>"); may be of another
   *  medium than the works the user follows (the manga after the anime). */
  lateDebutWorkId: string | null;
}

/** Where in a work (1-based episode/chapter) the character debuts, when the
 *  caller knows it; null/undefined means "judge the work as a whole". */
export type CharacterDebutLookup = (workId: string) => number | null | undefined;

export interface SpoilerEvaluator {
  settings: SpoilerSettings;
  /** The protected, not-revealed franchise `id` belongs to; null when the
   *  shield is off or nothing about `id` needs hiding. */
  activeFranchise: (id: string) => SpoilerFranchise | null;
  /** The protected, not-revealed cross-medium story `id` belongs to. */
  activeStory: (id: string) => SpoilerFranchise | null;
  /** A later work of an active franchise the user has not started while an
   *  earlier one (per the chain, or `earlierIds` when given) is unfinished. */
  isFutureWork: (id: string, earlierIds?: readonly string[]) => boolean;
  isSynopsisHidden: (id: string, earlierIds?: readonly string[]) => boolean;
  isCoverHidden: (id: string, earlierIds?: readonly string[]) => boolean;
  /** Per-work numbering shifts of one episode list (see episodeOffsets). */
  episodeOffsets: (episodes: readonly NumberedEpisode[], pageId: string) => Map<string, number>;
  /** `offsets` from this evaluator's episodeOffsets() over the same list. */
  isEpisodeHidden: (episode: NumberedEpisode, pageId: string, offsets: ReadonlyMap<string, number>) => boolean;
  isArcHidden: (items: readonly SpoilerArcItem[]) => boolean;
  characterShield: (appearanceIds: readonly string[], debutOf?: CharacterDebutLookup) => CharacterShield | null;
  /** The consumed works of `workId`'s story (any medium) when `workId`
   *  itself is an unconsumed work of an active story (in the library or
   *  not) — the cast of such a page is compared against theirs. */
  castComparisonWorks: (workId: string) => string[] | null;
}

export interface SpoilerEvaluatorInput {
  index: SpoilerIndex;
  settings: SpoilerSettings;
  isFranchiseRevealed: (memberIds: readonly string[]) => boolean;
}

export function createSpoilerEvaluator({ index, settings, isFranchiseRevealed }: SpoilerEvaluatorInput): SpoilerEvaluator {
  const activeFranchise = (id: string): SpoilerFranchise | null => {
    if (!settings.enabled || !id) return null;
    const franchise = index.franchiseOf(id);
    if (!franchise.isProtected || isFranchiseRevealed(franchise.memberIds)) return null;
    return franchise;
  };

  const activeStory = (id: string): SpoilerFranchise | null => {
    if (!settings.enabled || !id) return null;
    const story = index.storyOf(id);
    if (!story.isProtected || isFranchiseRevealed(story.memberIds)) return null;
    return story;
  };

  const isFutureWork = (id: string, earlierIds?: readonly string[]): boolean => {
    const franchise = activeFranchise(id);
    if (!franchise || index.isStarted(id)) return false;
    const members = new Set(franchise.memberIds);
    const earlier = earlierIds
      ? earlierIds.filter(earlierId => earlierId !== id && (members.has(earlierId) || activeFranchise(earlierId) === franchise))
      : [...index.predecessorsOf(id)];
    return earlier.some(earlierId => !index.isCompleted(earlierId));
  };

  const isEpisodeHidden = (episode: NumberedEpisode, pageId: string, offsets: ReadonlyMap<string, number>): boolean => {
    const workId = episode.external_id || pageId;
    if (!activeFranchise(workId) || index.isCompleted(workId)) return false;
    const position = episodePositionInWork(episode, offsets, pageId);
    // Specials have no place in the progress count: hidden until the work is done.
    if (position === null) return true;
    return isUnitAhead(position, index.libraryRow(workId), index.typeOf(workId), 'episodes');
  };

  const isArcItemAhead = (item: SpoilerArcItem): boolean => {
    const workId = item.media_external_id;
    if (index.isCompleted(workId)) return false;
    if (isFutureWork(workId)) return true;
    const type = index.typeOf(workId);
    const unit = primaryUnitForType(type);
    return unit !== null && isRangeAhead(item.ep_start, index.libraryRow(workId), type, unit);
  };

  const isArcHidden = (items: readonly SpoilerArcItem[]): boolean => {
    // Only the items of an active franchise say anything about the user's
    // position; an arc also listed on an untouched adaptation is judged by
    // the chain the user follows.
    const relevant = items.filter(item => activeFranchise(item.media_external_id));
    return relevant.length > 0 && relevant.every(isArcItemAhead);
  };

  const characterShield = (appearanceIds: readonly string[], debutOf?: CharacterDebutLookup): CharacterShield | null => {
    if (!settings.enabled) return null;
    const franchises = new Map<string, SpoilerFranchise>();
    const stories = new Map<string, SpoilerFranchise>();
    for (const id of appearanceIds) {
      // Someone who finished a whole chain featuring the character knows
      // how their story goes.
      if (index.franchiseOf(id).isCompleted) return null;
      const franchise = activeFranchise(id);
      if (franchise && !franchises.has(franchise.id)) franchises.set(franchise.id, franchise);
      const story = activeStory(id);
      if (story && !stories.has(story.id)) stories.set(story.id, story);
    }
    const isConsumed = (workId: string): boolean => {
      const debut = debutOf?.(workId);
      return debut != null && debut > 0 ? index.isConsumedPast(workId, debut) : index.isConsumed(workId);
    };
    const lateDebut = detectLateDebut([...stories.values()], appearanceIds, isConsumed);
    // Status/biography rules still follow the per-medium franchises; a late
    // debut (possibly only through the story) hides the whole character.
    const active = [...franchises.values()];
    if (active.length === 0 && !lateDebut) return null;
    return {
      franchise: lateDebut?.franchise ?? active[0],
      hideSensitiveStats: true,
      hideBiography: settings.level === 'strict' || lateDebut !== null,
      hideImage: lateDebut !== null,
      lateDebutWorkId: lateDebut?.firstWorkId ?? null,
    };
  };

  const castComparisonWorks = (workId: string): string[] | null => {
    const story = activeStory(workId);
    if (!story || index.isConsumed(workId)) return null;
    const consumed = story.memberIds.filter(id => id !== workId && index.isConsumed(id));
    return consumed.length > 0 ? consumed : null;
  };

  return {
    settings,
    activeFranchise,
    activeStory,
    isFutureWork,
    isSynopsisHidden: isFutureWork,
    isCoverHidden: (id, earlierIds) => settings.hideFutureCovers && isFutureWork(id, earlierIds),
    episodeOffsets: (episodes, pageId) => episodeOffsets(episodes, pageId, index.totalCountOf),
    isEpisodeHidden,
    isArcHidden,
    characterShield,
    castComparisonWorks,
  };
}
