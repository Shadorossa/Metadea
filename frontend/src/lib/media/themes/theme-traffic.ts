// Background traffic to v.animethemes.moe from the media page — the preview
// capture queue's downloads, the hover warm-up, the card preview videos and
// their blob copies — and the switch the OP/ED overlay flips while it is
// open. The CDN answers 503 after a handful of requests per minute from one
// IP (see HOST_BUDGETS in lib/api/rate-limiter.ts), so while the overlay
// plays nothing else on the page may spend that budget: suspending aborts
// every background signal, cancels Rust's in-flight download, and tells the
// cards to unload their videos until the overlay closes.
import { cancelThemeVideoDownloads } from '../../tauri/themes';

let suspended = false;
let backgroundController = new AbortController();
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export function isThemeTrafficSuspended(): boolean {
  return suspended;
}

/** useSyncExternalStore-shaped subscription to suspend/resume. */
export function subscribeThemeTraffic(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Signal for one piece of background work: aborted when the overlay opens. */
export function themeBackgroundSignal(): AbortSignal {
  return backgroundController.signal;
}

export function suspendThemeBackgroundTraffic(): void {
  if (suspended) return;
  suspended = true;
  backgroundController.abort();
  // Best effort: outside Tauri there is nothing to cancel.
  cancelThemeVideoDownloads().catch(() => {});
  emit();
}

export function resumeThemeBackgroundTraffic(): void {
  if (!suspended) return;
  suspended = false;
  backgroundController = new AbortController();
  emit();
}
