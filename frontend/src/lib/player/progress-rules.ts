// The "when does an episode count as watched" rules, shared by the VLC
// polling path and the built-in player's event path in playback-service.

// Fraction of the file the user has to reach for an episode to be marked
// watched — leaves room for trailing credits / next-episode previews.
export const AUTO_MARK_THRESHOLD = 0.8;

export function positionFraction(timeSecs: number, lengthSecs: number): number {
  if (!Number.isFinite(timeSecs) || !Number.isFinite(lengthSecs) || lengthSecs <= 0) return 0;
  return Math.min(1, Math.max(0, timeSecs / lengthSecs));
}

export function hasReachedWatchedThreshold(timeSecs: number, lengthSecs: number): boolean {
  return positionFraction(timeSecs, lengthSecs) >= AUTO_MARK_THRESHOLD;
}

// Whether the resume point is still worth persisting — once past the
// threshold the episode is about to be marked watched and the resume
// position gets cleared anyway.
export function shouldPersistResumePosition(timeSecs: number, lengthSecs: number): boolean {
  return positionFraction(timeSecs, lengthSecs) < AUTO_MARK_THRESHOLD;
}

// Which queue indices to mark watched when the engine reports it has moved
// from `fromIndex` to `toIndex`: the episode that just ended (only if it
// really reached the threshold) plus every one skipped over in between —
// an engine that advanced two files at once did play the middle one to its
// end, otherwise it could not have reached the third.
export function indicesToMarkOnAdvance(
  fromIndex: number,
  toIndex: number,
  currentReachedThreshold: boolean,
): number[] {
  if (toIndex <= fromIndex) return [];
  const marks: number[] = [];
  if (currentReachedThreshold) marks.push(fromIndex);
  for (let i = fromIndex + 1; i < toIndex; i++) marks.push(i);
  return marks;
}
