import { useEffect, useLayoutEffect, useState } from 'react';

const NAV_SLOT_ID = 'nav-center-slot';
const MAX_LOOKUP_ATTEMPTS = 60;

/**
 * Resolves the navbar portal target without reading the DOM during render.
 * The retry is needed after Astro view-transition navigation, where the
 * island can mount before the navbar has recreated its target element.
 */
export function useNavSlot(): HTMLElement | null {
  const [navSlot, setNavSlot] = useState<HTMLElement | null>(null);

  useLayoutEffect(() => {
    const element = document.getElementById(NAV_SLOT_ID);
    if (element) setNavSlot(element);
  }, []);

  useEffect(() => {
    let frameId: number | undefined;
    let attempts = 0;

    const findSlot = () => {
      const element = document.getElementById(NAV_SLOT_ID);
      if (element) {
        setNavSlot(element);
      } else if (attempts++ < MAX_LOOKUP_ATTEMPTS) {
        frameId = requestAnimationFrame(findSlot);
      }
    };

    findSlot();
    return () => {
      if (frameId !== undefined) cancelAnimationFrame(frameId);
    };
  }, []);

  return navSlot;
}
