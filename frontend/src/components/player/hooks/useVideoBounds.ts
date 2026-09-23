import { useEffect, type RefObject } from 'react';
import { playerSetVideoBounds } from '../../../lib/tauri/player';

// Reports where the video area sits inside the main window (CSS px of the
// WebView, which Rust scales to physical px at the moment of the call) so
// the native surface and the overlay window follow it. Coalesced to one
// report per animation frame; a zero rect on unmount hides both.
//
// Triggers: the element resizing (ResizeObserver), the window resizing or
// scrolling, and a DPR change (moving the window to another monitor keeps
// the CSS rect identical, so nothing else would fire — but Rust must
// re-scale it). Rust's own window-event hook covers the OS-side move.
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
      const x = Math.round(rect.left);
      const y = Math.round(rect.top);
      const width = Math.round(rect.width);
      const height = Math.round(rect.height);
      const key = `${x},${y},${width},${height}@${window.devicePixelRatio}`;
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
