// Main-window fullscreen for Big Picture: Tauri's window API (the same one
// the readers use), the DOM Fullscreen API outside Tauri.
import { getCurrentWindow } from '@tauri-apps/api/window';

export async function isWindowFullscreen(): Promise<boolean> {
  try {
    return await getCurrentWindow().isFullscreen();
  } catch {
    return typeof document !== 'undefined' && !!document.fullscreenElement;
  }
}

export async function setWindowFullscreen(next: boolean): Promise<void> {
  try {
    await getCurrentWindow().setFullscreen(next);
    return;
  } catch {}
  if (typeof document === 'undefined') return;
  try {
    if (next && !document.fullscreenElement) await document.documentElement.requestFullscreen();
    else if (!next && document.fullscreenElement) await document.exitFullscreen();
  } catch {}
}

/** Closes the app (Start menu › Quit). */
export async function quitApp(): Promise<void> {
  const { exit } = await import('@tauri-apps/plugin-process');
  await exit(0);
}
