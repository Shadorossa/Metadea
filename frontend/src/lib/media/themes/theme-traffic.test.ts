import { describe, it, expect, vi } from 'vitest';

const { cancelThemeVideoDownloads } = vi.hoisted(() => ({ cancelThemeVideoDownloads: vi.fn(() => Promise.resolve()) }));
vi.mock('../../tauri/themes', () => ({ cancelThemeVideoDownloads }));

import {
  isThemeTrafficSuspended,
  resumeThemeBackgroundTraffic,
  subscribeThemeTraffic,
  suspendThemeBackgroundTraffic,
  themeBackgroundSignal,
} from './theme-traffic';

describe('theme background traffic', () => {
  it('aborts background work and cancels Rust downloads on suspend, with a fresh signal on resume', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeThemeTraffic(listener);
    const running = themeBackgroundSignal();

    suspendThemeBackgroundTraffic();
    expect(isThemeTrafficSuspended()).toBe(true);
    expect(running.aborted).toBe(true);
    expect(cancelThemeVideoDownloads).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledTimes(1);

    // Idempotent: a second overlay effect run doesn't cancel twice.
    suspendThemeBackgroundTraffic();
    expect(cancelThemeVideoDownloads).toHaveBeenCalledTimes(1);

    resumeThemeBackgroundTraffic();
    expect(isThemeTrafficSuspended()).toBe(false);
    expect(themeBackgroundSignal().aborted).toBe(false);
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
  });
});
