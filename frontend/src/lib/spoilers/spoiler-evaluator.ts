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
  /** The first work of the franchise the character appears in, when every
   *  one of them is still ahead of the user ("Appears in <work>"). */
  lateDebutWorkId: string | null;
}

export interface SpoilerEvaluator {
  settings: SpoilerSettings;
  /** The protected, not-revealed franchise `id` belongs to; null when the
   *  shield is off or nothing about `id` needs hiding. */
  activeFranchise: (id: string) => SpoilerFranchise | null;
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
  characterShield: (appearanceIds: readonly string[]) => CharacterShield | null;
  /** The started works of `workId`'s franchise when `workId` itself is an
   *  unstarted work in an active franchise — the cast of such a page is
   *  compared against them. */
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

  const characterShield = (appearanceIds: readonly string[]): CharacterShield | null => {
    if (!settings.enabled) return null;
    const franchises = new Map<string, SpoilerFranchise>();
    for (const id of appearanceIds) {
      // Someone who finished a whole chain featuring the character knows
      // how their story goes.
      if (index.franchiseOf(id).isCompleted) return null;
      const franchise = activeFranchise(id);
      if (franchise && !franchises.has(franchise.id)) franchises.set(franchise.id, franchise);
    }
    const active = [...franchises.values()];
    if (active.length === 0) return null;
    const lateDebut = detectLateDebut(active, appearanceIds, index.isStarted);
    return {
      franchise: lateDebut?.franchise ?? active[0],
      hideSensitiveStats: true,
      hideBiography: settings.level === 'strict' || lateDebut !== null,
      hideImage: lateDebut !== null,
      lateDebutWorkId: lateDebut?.firstWorkId ?? null,
    };
  };

  const castComparisonWorks = (workId: string): string[] | null => {
    const franchise = activeFranchise(workId);
    if (!franchise || index.isStarted(workId)) return null;
    const started = franchise.memberIds.filter(index.isStarted);
    return started.length > 0 ? started : null;
  };

  return {
    settings,
    activeFranchise,
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
