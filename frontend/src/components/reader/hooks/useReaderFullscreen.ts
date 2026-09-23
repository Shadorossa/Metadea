import { useCallback, useEffect, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';

// Window fullscreen for the readers (comic + EPUB share it): Tauri's window
// API first, the DOM Fullscreen API as the browser fallback.
export function useReaderFullscreen() {
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const appWindow = getCurrentWindow();
    appWindow.isFullscreen().then(setIsFullscreen).catch(() => {});
  }, []);

  const toggleFullscreen = useCallback(async () => {
    try {
      const appWindow = getCurrentWindow();
      const current = await appWindow.isFullscreen();
      await appWindow.setFullscreen(!current);
      setIsFullscreen(!current);
    } catch {
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().then(() => setIsFullscreen(true)).catch(() => {});
      } else {
        document.exitFullscreen().then(() => setIsFullscreen(false)).catch(() => {});
      }
    }
  }, []);

  /** Leaves fullscreen if active; resolves true when it did (so an Escape
   *  press stops there instead of also closing the reader). */
  const exitFullscreen = useCallback(async (): Promise<boolean> => {
    try {
      const appWindow = getCurrentWindow();
      if (await appWindow.isFullscreen()) {
        await appWindow.setFullscreen(false);
        setIsFullscreen(false);
        return true;
      }
    } catch {}
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
      setIsFullscreen(false);
      return true;
    }
    return false;
  }, []);

  return { isFullscreen, toggleFullscreen, exitFullscreen };
}

// Hides the page scrollbar while a reader covers the page (reader.css).
export function useReaderActiveClass() {
  useEffect(() => {
    document.documentElement.classList.add('comic-reader-active');
    return () => {
      document.documentElement.classList.remove('comic-reader-active');
    };
  }, []);
}
