import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { nextCanonInQueue, shouldShowFillerCard } from '../../../lib/player/filler-next';
import type { PlayerSessionInfo, PlayerStatus } from '../../../lib/player/player-status';
import { playerPlayIndex } from '../../../lib/tauri/player';

/** Within this many seconds of the end, a track change counts as the
 *  episode finishing on its own (not a manual jump). */
const NATURAL_END_SECS = 3;

// "Next canon episode: N (skipping K filler)" for entries set to "Filler:
// Skipped" (lib/player/filler-next.ts). The card shows near the end of the
// episode and never acts on its own mid-credits: only when it was shown,
// left unanswered, and the episode then really ended and rolled into the
// next (filler) queue entry does the player jump to N. There is no
// "autoplay next" setting — the queue always advances — so the jump follows
// the same rule. "Watch filler anyway" keeps the queue as it is.
export function usePlayerFillerNext(status: PlayerStatus, session: PlayerSessionInfo | null, inEnding: boolean) {
  const index = Math.max(0, status.playlist_index);
  const next = useMemo(
    () => nextCanonInQueue(session?.external_id, session?.episode_numbers ?? [], session?.filler_episodes, index),
    [session, index],
  );
  const [keptFillerAt, setKeptFillerAt] = useState<number | null>(null);
  const keepsFiller = keptFillerAt === index;
  const visible = next !== null && !keepsFiller && status.state !== 'idle'
    && shouldShowFillerCard(status.position_secs, status.duration_secs, inEnding);

  // What the previous status tick saw, to tell a natural end from a jump.
  const previous = useRef({ index, nearEnd: false, target: null as number | null, shown: false });
  useEffect(() => {
    const before = previous.current;
    const rolledOn = index === before.index + 1 && before.nearEnd;
    if (rolledOn && before.shown && before.target !== null) {
      playerPlayIndex(before.target).catch(err => console.error('Jump to canon episode failed', err));
    }
    const remaining = status.duration_secs - status.position_secs;
    previous.current = {
      index,
      nearEnd: status.duration_secs > 0 && remaining <= NATURAL_END_SECS,
      target: next && !keepsFiller ? next.queueIndex : null,
      // Sticky per episode: the card was on screen at some point and was
      // not answered with "Watch filler anyway".
      shown: before.index === index ? before.shown || visible : visible,
    };
  });

  const playCanon = useCallback(() => {
    if (next) playerPlayIndex(next.queueIndex).catch(err => console.error('Jump to canon episode failed', err));
  }, [next]);
  const watchFiller = useCallback(() => setKeptFillerAt(index), [index]);

  return { next: visible ? next : null, playCanon, watchFiller };
}
