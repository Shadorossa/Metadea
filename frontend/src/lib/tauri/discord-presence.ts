import { tauriRun } from './bridge';
// ── Discord Rich Presence ────────────────────────────────────────────────────

// A second presence button after "Try Metadea" — Discord shows it only
// with an https URL (src-tauri/src/discord.rs drops anything else).
export interface PresenceButton {
  label: string;
  url: string;
}

// Update Discord Rich Presence details and status state
export async function updateDiscordPresence(
  details: string,
  state: string,
  startTime?: number,
  endTime?: number,
  largeImage?: string,
  largeText?: string,
  smallImage?: string,
  smallText?: string,
  // Discord activity type: 'playing' (default) | 'watching' | 'listening'.
  activityType?: 'playing' | 'watching' | 'listening',
  button?: PresenceButton,
): Promise<void> {
  presenceQueue.push({
    details,
    state,
    startTime,
    endTime,
    largeImage,
    largeText,
    smallImage,
    smallText,
    activityType,
    buttonLabel: button?.label,
    buttonUrl: button?.url,
  });
}

// Discord accepts about 5 activity updates per 20 s and silently drops the
// rest — a burst (page switches restoring the game, player ticks) left the
// small profile popout on a half-applied, empty card. Identical payloads are
// never resent, and changes are coalesced to one send per interval, always
// the latest.
export const PRESENCE_MIN_INTERVAL_MS = 4000;

export function createPresenceQueue(
  send: (payload: Record<string, unknown>) => Promise<void>,
  now: () => number = Date.now,
  schedule: (fn: () => void, ms: number) => unknown = (fn, ms) => setTimeout(fn, ms),
) {
  let lastKey: string | null = null;
  let lastSentAt = -Infinity;
  let pending: Record<string, unknown> | null = null;
  let timerSet = false;
  const flush = () => {
    timerSet = false;
    if (!pending) return;
    const payload = pending;
    pending = null;
    const key = JSON.stringify(payload);
    if (key === lastKey) return;
    lastKey = key;
    lastSentAt = now();
    void send(payload).catch(() => { lastKey = null; });
  };
  return {
    push(payload: Record<string, unknown>) {
      if (JSON.stringify(payload) === lastKey) { pending = null; return; }
      pending = payload;
      const wait = PRESENCE_MIN_INTERVAL_MS - (now() - lastSentAt);
      if (wait <= 0) { flush(); return; }
      if (!timerSet) { timerSet = true; schedule(flush, wait); }
    },
    /** Forget the last payload (after a reset, the next one must be sent). */
    reset() { lastKey = null; pending = null; },
  };
}

const presenceQueue = createPresenceQueue(payload => tauriRun('update_presence', payload));

// Reset Discord Rich Presence to default browsing state
export async function resetDiscordPresence(): Promise<void> {
  presenceQueue.reset();
  return tauriRun('reset_presence');
}
