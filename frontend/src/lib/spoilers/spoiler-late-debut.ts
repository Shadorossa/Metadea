// Late-debut characters: someone who only shows up in works of a followed
// story the user has not consumed yet, so even their face is news. The
// judgement runs over cross-medium stories (SpoilerIndex.storyOf): anime
// seasons the user watched make their cast known on the manga's side too,
// and a character only the unread manga has is a late debut. Judged per
// work unless the caller knows where in a work the character debuts.
// Pure — tested in spoiler-late-debut.test.ts.
import type { SpoilerFranchise } from './spoiler-franchises';

export interface LateDebut {
  franchise: SpoilerFranchise;
  /** The earliest of the character's works in that story (its order). */
  firstWorkId: string;
}

/** A late debut when, in every one of `stories` the character appears in,
 *  the user has consumed some work but none of the character's (so the
 *  story still holds unconsumed material they appear in, and nothing the
 *  user consumed introduced them). A story the user has consumed nothing
 *  of says nothing (every character would qualify), so it is left out of
 *  the judgement. `isConsumed` may be per character (past their debut). */
export function detectLateDebut(
  stories: readonly SpoilerFranchise[],
  appearanceIds: readonly string[],
  isConsumed: (workId: string) => boolean,
): LateDebut | null {
  const appearances = new Set(appearanceIds);
  let result: LateDebut | null = null;
  for (const story of stories) {
    if (!story.memberIds.some(isConsumed)) continue;
    const ownWorks = story.memberIds.filter(id => appearances.has(id));
    if (ownWorks.length === 0) continue;
    if (ownWorks.some(isConsumed)) return null;
    result ??= { franchise: story, firstWorkId: ownWorks[0] };
  }
  return result;
}

/** Cast members of an unconsumed work missing from every cast list of the
 *  works the user did consume (any medium of the story). `knownCastIds` is
 *  null when any of those lists is not cached locally — then nothing can be
 *  told apart and none is. */
export function lateDebutCastIds(
  castIds: readonly string[],
  knownCastIds: ReadonlySet<string> | null,
): Set<string> {
  if (!knownCastIds || knownCastIds.size === 0) return new Set();
  return new Set(castIds.filter(id => id && !knownCastIds.has(id)));
}
