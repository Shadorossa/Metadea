import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import {
  isTextlessEligibleId,
  selectDisplayCover,
  textlessOf,
  textlessCoverStore,
  TEXTLESS_DISABLED,
  type DisplayCover,
  type TextlessSnapshot,
} from '../../../lib/media/textless-covers';

// One IntersectionObserver for every cover on the page: a cover only asks
// for its textless version once it is (about to be) on screen, and all the
// covers that become visible in the same pass share one IPC batch.
type VisibleCallback = () => void;
const watched = new Map<Element, VisibleCallback>();
let sharedObserver: IntersectionObserver | null = null;

function observeOnce(el: Element, onVisible: VisibleCallback): () => void {
  if (typeof IntersectionObserver === 'undefined') {
    onVisible();
    return () => {};
  }
  sharedObserver ??= new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const cb = watched.get(entry.target);
      watched.delete(entry.target);
      sharedObserver?.unobserve(entry.target);
      cb?.();
    }
  }, { rootMargin: '300px' });
  watched.set(el, onVisible);
  sharedObserver.observe(el);
  return () => {
    watched.delete(el);
    sharedObserver?.unobserve(el);
  };
}

export interface TextlessCoverResult extends DisplayCover {
  /** Ref for the element whose visibility triggers the lookup. */
  observe: (el: Element | null) => void;
}

/** The cover to render for a work: its textless version when "Prefer clean
 *  covers" is on and one exists (resolved lazily once visible), else
 *  `originalUrl` unchanged. The original always paints first. */
export function useTextlessCover(externalId: string | null | undefined, originalUrl: string | null | undefined): TextlessCoverResult {
  const id = isTextlessEligibleId(externalId) ? externalId : null;
  const snapshot = useSyncExternalStore<TextlessSnapshot>(
    textlessCoverStore.subscribe,
    () => (id ? textlessCoverStore.snapshot(id) : TEXTLESS_DISABLED),
    () => TEXTLESS_DISABLED,
  );
  const enabled = snapshot !== TEXTLESS_DISABLED;
  const [element, setElement] = useState<Element | null>(null);
  const [visible, setVisible] = useState(false);
  const manual = enabled && id ? textlessCoverStore.manualCover(id) : null;

  useEffect(() => {
    if (!enabled || !id || visible || !element) return;
    return observeOnce(element, () => setVisible(true));
  }, [enabled, id, visible, element]);

  useEffect(() => {
    if (enabled && id && visible && !manual && snapshot === undefined) textlessCoverStore.request(id);
  }, [enabled, id, visible, manual, snapshot]);

  const observe = useCallback((el: Element | null) => setElement(el), []);
  return { ...selectDisplayCover({ original: originalUrl, manual, textless: textlessOf(snapshot), enabled }), observe };
}
