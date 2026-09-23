// Whether the Ambient TV screensaver is up, plus the one entry point other
// input sources (Big Picture's gamepad loop) use to report activity: while
// the screensaver shows, that input only closes it and must not also act on
// the page underneath. Module-level so it survives Astro page swaps.
import { createExternalStore } from '../shared/state/external-store';

export const ambientActiveStore = createExternalStore<boolean>(false);

/** Settings › "Preview" asks the mounted island to start right away. */
export const AMBIENT_PREVIEW_EVENT = 'metadea:ambient-preview';

// After closing, input that belongs to the same gesture (the click after the
// pointerdown that closed it, a held pad button) is still swallowed.
const SWALLOW_AFTER_EXIT_MS = 450;

let swallowUntil = 0;
const activityListeners = new Set<() => void>();

export function enterAmbient(): void {
  if (!ambientActiveStore.get()) ambientActiveStore.set(true);
}

export function exitAmbient(now: number = Date.now()): void {
  if (!ambientActiveStore.get()) return;
  swallowUntil = now + SWALLOW_AFTER_EXIT_MS;
  ambientActiveStore.set(false);
}

/** Whether input arriving now belongs to the gesture that closed the screensaver. */
export function isWithinExitGesture(now: number = Date.now()): boolean {
  return now < swallowUntil;
}

/** Subscribes the idle watcher to activity reported from outside the DOM
 *  events it already listens to (gamepad). */
export function onAmbientActivity(listener: () => void): () => void {
  activityListeners.add(listener);
  return () => { activityListeners.delete(listener); };
}

/** Call on every non-DOM user input (a gamepad action). Returns true when
 *  the input was consumed by Ambient mode — it closed the screensaver, or
 *  belongs to the gesture that just did — and must be ignored by the
 *  caller; otherwise it counts as activity and the caller handles it. */
export function interceptAmbientInput(now: number = Date.now()): boolean {
  if (ambientActiveStore.get()) {
    exitAmbient(now);
    return true;
  }
  if (isWithinExitGesture(now)) return true;
  for (const listener of activityListeners) listener();
  return false;
}

export function requestAmbientPreview(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(AMBIENT_PREVIEW_EVENT));
}
