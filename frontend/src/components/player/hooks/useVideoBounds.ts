import { useEffect, type RefObject } from 'react';
import { playerSetVideoBounds } from '../../../lib/tauri/player';

// Reports where the video area sits inside the main window (CSS px of the
// WebView, which Rust scales to physical px) so the native surface and the
// overlay window follow it. Coalesced to one report per animation frame;
// a zero rect on unmount hides both.
export function useVideoBounds(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    let frame: number | null = null;
    let last = '';

    const report = () => {
      frame = null;
      const rect = element.getBoundingClientRect();
      const x = Math.round(rect.left);
      const y = Math.round(rect.top);
      const width = Math.round(rect.width);
      const height = Math.round(rect.height);
      const key = `${x},${y},${width},${height}`;
      if (key === last) return;
      last = key;
      playerSetVideoBounds(x, y, width, height).catch(err => console.error('Video bounds update failed', err));
    };
    const schedule = () => {
      if (frame === null) frame = window.requestAnimationFrame(report);
    };

    const observer = new ResizeObserver(schedule);
    observer.observe(element);
    window.addEventListener('resize', schedule);
    window.addEventListener('scroll', schedule, true);
    schedule();

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', schedule);
      window.removeEventListener('scroll', schedule, true);
      if (frame !== null) window.cancelAnimationFrame(frame);
      playerSetVideoBounds(0, 0, 0, 0).catch(() => {});
    };
  }, [ref]);
}
