// Late-debut characters: someone who only shows up in works of a followed
// franchise the user has not reached yet, so even their face is news.
// Judged per work (the finest the data goes — there is no "first episode"
// per character). Pure — tested in spoiler-late-debut.test.ts.
import type { SpoilerFranchise } from './spoiler-franchises';

export interface LateDebut {
  franchise: SpoilerFranchise;
  /** The earliest of the character's works in that franchise (chain order). */
  firstWorkId: string;
}

/** A late debut when, in every one of `franchises` the character appears
 *  in, the user has started some work but none of the character's. A
 *  franchise the user has not started at all says nothing (every character
 *  would qualify), so it is left out of the judgement. */
export function detectLateDebut(
  franchises: readonly SpoilerFranchise[],
  appearanceIds: readonly string[],
  isStarted: (workId: string) => boolean,
): LateDebut | null {
  const appearances = new Set(appearanceIds);
  let result: LateDebut | null = null;
  for (const franchise of franchises) {
    if (!franchise.memberIds.some(isStarted)) continue;
    const ownWorks = franchise.memberIds.filter(id => appearances.has(id));
    if (ownWorks.length === 0) continue;
    if (ownWorks.some(isStarted)) return null;
    result ??= { franchise, firstWorkId: ownWorks[0] };
  }
  return result;
}

/** Cast members of an unstarted work missing from every cast list of the
 *  works the user did start. `knownCastIds` is null when any of those lists
 *  is not cached locally — then nothing can be told apart and none is. */
export function lateDebutCastIds(
  castIds: readonly string[],
  knownCastIds: ReadonlySet<string> | null,
): Set<string> {
  if (!knownCastIds || knownCastIds.size === 0) return new Set();
  return new Set(castIds.filter(id => id && !knownCastIds.has(id)));
}
