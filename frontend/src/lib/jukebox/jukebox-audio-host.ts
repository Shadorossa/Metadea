// The window's one jukebox audio element, shared by every copy of
// jukebox-engine.ts that gets evaluated in it. A second copy appears when
// the dev server hot-reloads the engine (or anything it imports), or when a
// page's island imports it under another URL; that copy used to silence the
// playing element and start a fresh one, so the music stopped and `ended`
// went to a module nobody drove any more. Now the newest copy takes the
// element over: the previous copy's listeners come off, its own go on, and
// whatever is playing keeps playing.
export const JUKEBOX_RUNTIME_KEY = '__metadeaJukeboxRuntime';
export const JUKEBOX_BOOTED_KEY = '__metadeaJukeboxBooted';

export type AudioListeners = Array<[type: string, listener: EventListener]>;

interface JukeboxRuntime<T extends EventTarget> {
  element: T;
  // Removes the listeners of the copy that claimed the element last.
  detach: () => void;
}

type RuntimeHost<T extends EventTarget> = {
  [JUKEBOX_RUNTIME_KEY]?: JukeboxRuntime<T>;
  [JUKEBOX_BOOTED_KEY]?: boolean;
};

/** Returns the window's element (creating it the first time) with exactly
 *  `listeners` attached; `adopted` says it already existed. */
export function claimJukeboxAudio<T extends EventTarget>(
  host: object,
  create: () => T,
  listeners: (element: T) => AudioListeners,
): { element: T; adopted: boolean } {
  const runtimeHost = host as RuntimeHost<T>;
  const existing = runtimeHost[JUKEBOX_RUNTIME_KEY];
  const element = existing ? existing.element : create();
  existing?.detach();
  const attached = listeners(element);
  for (const [type, listener] of attached) element.addEventListener(type, listener);
  runtimeHost[JUKEBOX_RUNTIME_KEY] = {
    element,
    detach: () => {
      for (const [type, listener] of attached) element.removeEventListener(type, listener);
    },
  };
  return { element, adopted: !!existing };
}

/** True the first time per window: the boot work (preferences, favourites,
 *  document listeners) runs once, whichever module copy asks first. */
export function claimJukeboxBoot(host: object): boolean {
  const runtimeHost = host as RuntimeHost<EventTarget>;
  if (runtimeHost[JUKEBOX_BOOTED_KEY]) return false;
  runtimeHost[JUKEBOX_BOOTED_KEY] = true;
  return true;
}
