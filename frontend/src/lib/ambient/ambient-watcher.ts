// Wires the pure idle controller to the app: passive input listeners, the
// window's fullscreen/focus/visibility, Big Picture, the settings, the
// gamepad activity Big Picture reports, and the Jukebox session that runs
// while the screensaver is up. Installed once by components/ambient/
// AmbientModeIsland; nothing here polls — between inputs the only thing
// alive is one pending timeout (and none at all outside fullscreen / Big Picture).
import { bigPictureStore } from '../big-picture/big-picture-state';
import { isWindowFullscreen } from '../big-picture/window-mode';
import { jukeboxStore } from '../jukebox/jukebox-store';
import { pause as pauseJukebox, resume as resumeJukebox, setDuckFactor } from '../jukebox/jukebox-engine';
import {
  AMBIENT_MODE_CHANGED_EVENT, getAmbientIdleMinutes, isAmbientJukeboxEnabled, isAmbientModeEnabled,
} from '../storage/preferences';
import { collectAmbientBlockers, readAmbientBlockerSnapshot } from './ambient-blockers';
import { createAmbientIdleController } from './ambient-idle';
import { startAmbientJukebox, type AmbientJukeboxSession } from './ambient-jukebox';
import { AMBIENT_PREVIEW_EVENT, ambientActiveStore, enterAmbient, onAmbientActivity } from './ambient-state';

const ACTIVITY_EVENTS = ['pointermove', 'pointerdown', 'wheel', 'keydown', 'touchstart'] as const;
// Fullscreen toggles arrive as a burst of resize events.
const RESIZE_SETTLE_MS = 250;

function startJukeboxSession(fromFactor: number): AmbientJukeboxSession {
  return startAmbientJukebox({
    isPlaying: () => {
      const status = jukeboxStore.get().status;
      return status === 'playing' || status === 'loading';
    },
    hasQueue: () => jukeboxStore.get().queue.length > 0,
    play: resumeJukebox,
    stop: pauseJukebox,
    setDuck: setDuckFactor,
    setTimeout: (callback, ms) => window.setTimeout(callback, ms),
    clearTimeout: handle => window.clearTimeout(handle as number),
  }, { autoplay: isAmbientJukeboxEnabled(), fromFactor });
}

export function installAmbientWatcher(): () => void {
  if (typeof window === 'undefined') return () => {};
  let fullscreen = false;
  let resizeTimer: number | null = null;
  let jukebox: AmbientJukeboxSession | null = null;

  const controller = createAmbientIdleController({
    clock: {
      now: () => performance.now(),
      setTimeout: (callback, ms) => window.setTimeout(callback, ms),
      clearTimeout: handle => window.clearTimeout(handle as number),
    },
    readGate: () => ({
      enabled: isAmbientModeEnabled(),
      fullscreen,
      bigPicture: bigPictureStore.get(),
      visible: document.visibilityState === 'visible',
      focused: document.hasFocus(),
    }),
    readDelayMs: () => getAmbientIdleMinutes() * 60_000,
    readBlockers: () => collectAmbientBlockers(readAmbientBlockerSnapshot()),
    onIdle: enterAmbient,
  });

  const onActivity = () => controller.activity();
  const onGateChange = () => controller.refresh();
  const syncFullscreen = () => {
    isWindowFullscreen().then(value => {
      fullscreen = value;
      controller.refresh();
    }, () => {});
  };
  const onResize = () => {
    if (resizeTimer !== null) window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => { resizeTimer = null; syncFullscreen(); }, RESIZE_SETTLE_MS);
  };
  const onPreview = () => enterAmbient();

  const listenerOptions: AddEventListenerOptions = { capture: true, passive: true };
  for (const type of ACTIVITY_EVENTS) window.addEventListener(type, onActivity, listenerOptions);
  window.addEventListener('focus', onGateChange);
  window.addEventListener('blur', onGateChange);
  document.addEventListener('visibilitychange', onGateChange);
  window.addEventListener('resize', onResize);
  document.addEventListener('fullscreenchange', syncFullscreen);
  window.addEventListener(AMBIENT_MODE_CHANGED_EVENT, onGateChange);
  window.addEventListener('storage', onGateChange);
  window.addEventListener(AMBIENT_PREVIEW_EVENT, onPreview);
  const unsubscribers = [
    onAmbientActivity(onActivity),
    bigPictureStore.subscribe(onGateChange),
    ambientActiveStore.subscribe(() => {
      if (ambientActiveStore.get()) {
        controller.suspend();
        const carried = jukebox?.abort() ?? 1;
        jukebox = startJukeboxSession(carried);
      } else {
        jukebox?.end();
        controller.resume();
      }
    }),
  ];
  syncFullscreen();

  return () => {
    for (const type of ACTIVITY_EVENTS) window.removeEventListener(type, onActivity, listenerOptions);
    window.removeEventListener('focus', onGateChange);
    window.removeEventListener('blur', onGateChange);
    document.removeEventListener('visibilitychange', onGateChange);
    window.removeEventListener('resize', onResize);
    document.removeEventListener('fullscreenchange', syncFullscreen);
    window.removeEventListener(AMBIENT_MODE_CHANGED_EVENT, onGateChange);
    window.removeEventListener('storage', onGateChange);
    window.removeEventListener(AMBIENT_PREVIEW_EVENT, onPreview);
    for (const unsubscribe of unsubscribers) unsubscribe();
    if (resizeTimer !== null) window.clearTimeout(resizeTimer);
    jukebox?.end();
    controller.dispose();
  };
}
