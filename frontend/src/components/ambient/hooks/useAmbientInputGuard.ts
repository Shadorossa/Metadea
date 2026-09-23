import { useEffect } from 'react';
import { ambientActiveStore, exitAmbient, isWithinExitGesture } from '../../../lib/ambient/ambient-state';
import { bigPictureStore } from '../../../lib/big-picture/big-picture-state';
import { createGamepadLoop, hasConnectedGamepad, readNavigatorGamepads } from '../../../lib/big-picture/gamepad';

// Input that closes the screensaver: keys, buttons, wheel, touch, and a
// pointer that really moved (a nudged mouse or a jittery sensor shouldn't).
const EXIT_EVENTS = ['keydown', 'pointerdown', 'mousedown', 'wheel', 'touchstart'] as const;
// The rest of a gesture that already closed it: swallowed, never acted on.
const TRAILING_EVENTS = ['keyup', 'keypress', 'pointerup', 'mouseup', 'click', 'dblclick', 'auxclick', 'contextmenu', 'touchend'] as const;
const POINTER_EXIT_DISTANCE = 24;
// The hand that just pressed "Preview" is still on the mouse.
const POINTER_GRACE_MS = 1000;
// Pad polling while the screensaver shows outside Big Picture (Big Picture's
// own loop reports its pad input through interceptAmbientInput instead).
const PAD_POLL_MS = 100;

function swallow(event: Event): void {
  if (event.cancelable) event.preventDefault();
  event.stopImmediatePropagation();
}

/** While `shown`, captures every input at the window before anything else
 *  sees it: the first one closes the screensaver and nothing underneath
 *  receives it (keyboard shortcuts, clicks, Big Picture's key bindings). */
export function useAmbientInputGuard(shown: boolean): void {
  useEffect(() => {
    if (!shown) return;
    let origin: { x: number; y: number } | null = null;
    const shownAt = performance.now();

    const onExitInput = (event: Event) => {
      swallow(event);
      exitAmbient();
    };
    const onTrailing = (event: Event) => {
      if (ambientActiveStore.get() || isWithinExitGesture()) swallow(event);
    };
    const onPointerMove = (event: PointerEvent) => {
      if (!ambientActiveStore.get() || performance.now() - shownAt < POINTER_GRACE_MS) return;
      if (!origin) {
        origin = { x: event.clientX, y: event.clientY };
        return;
      }
      if (Math.hypot(event.clientX - origin.x, event.clientY - origin.y) >= POINTER_EXIT_DISTANCE) exitAmbient();
    };

    const options: AddEventListenerOptions = { capture: true, passive: false };
    const onExit = (event: Event) => {
      if (ambientActiveStore.get()) onExitInput(event);
      else onTrailing(event);
    };
    for (const type of EXIT_EVENTS) window.addEventListener(type, onExit, options);
    for (const type of TRAILING_EVENTS) window.addEventListener(type, onTrailing, options);
    window.addEventListener('pointermove', onPointerMove, { capture: true, passive: true });

    const pad = createGamepadLoop({
      getGamepads: readNavigatorGamepads,
      onActions: () => {
        if (!bigPictureStore.get() && document.hasFocus()) exitAmbient();
      },
      schedule: tick => window.setTimeout(tick, PAD_POLL_MS),
      cancel: handle => window.clearTimeout(handle),
      now: () => performance.now(),
    });
    if (!bigPictureStore.get() && hasConnectedGamepad()) pad.start();

    return () => {
      for (const type of EXIT_EVENTS) window.removeEventListener(type, onExit, options);
      for (const type of TRAILING_EVENTS) window.removeEventListener(type, onTrailing, options);
      window.removeEventListener('pointermove', onPointerMove, { capture: true });
      pad.stop();
    };
  }, [shown]);
}
