import { useEffect, type RefObject } from 'react';
import { playerSetVideoBounds } from '../../../lib/tauri/player';
import { toPhysicalRect } from '../../../lib/ui-scale/ui-scale';

// Reports where the video area sits inside the main window, in physical px
// (the CSS rect × devicePixelRatio, which covers both the monitor scale and
// the Interface scale zoom), so the native surface and the overlay window
// follow it. Coalesced to one report per animation frame; a zero rect on
// unmount hides both.
//
// Triggers: the element resizing (ResizeObserver), the window resizing or
// scrolling, and a DPR change (moving the window to another monitor or
// changing the Interface scale can keep the CSS rect identical, so nothing
// else would fire). Rust's own window-event hook covers the OS-side move.
export function useVideoBounds(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    let frame: number | null = null;
    let last = '';
    let dprQuery: MediaQueryList | null = null;

    const report = () => {
      frame = null;
      const rect = element.getBoundingClientRect();
      const { x, y, width, height } = toPhysicalRect(
        { x: rect.left, y: rect.top, width: rect.width, height: rect.height },
        window.devicePixelRatio,
      );
      const key = `${x},${y},${width},${height}`;
      if (key === last) return;
      last = key;
      playerSetVideoBounds(x, y, width, height).catch(err => console.error('Video bounds update failed', err));
    };
    const schedule = () => {
      if (frame === null) frame = window.requestAnimationFrame(report);
    };
    // A media query that stops matching exactly when the DPR changes; it is
    // re-armed for the new ratio after every change.
    const watchDpr = () => {
      dprQuery?.removeEventListener('change', onDprChange);
      dprQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
      dprQuery.addEventListener('change', onDprChange);
    };
    const onDprChange = () => {
      watchDpr();
      schedule();
    };

    const observer = new ResizeObserver(schedule);
    observer.observe(element);
    window.addEventListener('resize', schedule);
    window.addEventListener('scroll', schedule, true);
    watchDpr();
    schedule();

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', schedule);
      window.removeEventListener('scroll', schedule, true);
      dprQuery?.removeEventListener('change', onDprChange);
      if (frame !== null) window.cancelAnimationFrame(frame);
      playerSetVideoBounds(0, 0, 0, 0).catch(() => {});
    };
  }, [ref]);
}
