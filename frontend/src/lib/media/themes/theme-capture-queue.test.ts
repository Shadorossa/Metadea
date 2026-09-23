import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const tauri = vi.hoisted(() => {
  const pending: Array<(reason: unknown) => void> = [];
  return {
    pending,
    getThemePreviewFrame: vi.fn(() => Promise.resolve(null)),
    getThemeVideoPath: vi.fn(() => Promise.resolve<string | null>(null)),
    saveThemePreviewFrame: vi.fn(() => Promise.resolve('')),
    // Never resolves on its own: stands in for a download still running.
    cacheThemeVideo: vi.fn(() => new Promise<string>((_resolve, reject) => { pending.push(reject); })),
    // What Rust does on cancel: every running download fails.
    cancelThemeVideoDownloads: vi.fn(() => {
      pending.splice(0).forEach(reject => reject('E_THEME_VIDEO_CANCELLED'));
      return Promise.resolve();
    }),
  };
});
vi.mock('../../tauri/themes', () => tauri);
vi.mock('../../tauri/bridge', () => ({ isTauri: () => true, wrapAssetUrl: (path: string) => path }));
const acquireForUrl = vi.hoisted(() => vi.fn((_url: string, _priority: string, signal?: AbortSignal) =>
  signal?.aborted ? Promise.reject(new DOMException('Aborted', 'AbortError')) : Promise.resolve()));
vi.mock('../../api/rate-limiter', () => ({ acquireForUrl }));

import { enqueueThemeCapture, warmThemeVideo } from './theme-capture-queue';
import { resumeThemeBackgroundTraffic, suspendThemeBackgroundTraffic } from './theme-traffic';

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

const flush = () => vi.advanceTimersByTimeAsync(0);
const OP1 = { externalId: 'anime:185874', slug: 'OP1', src: 'https://v.animethemes.moe/Bleach2026-OP1.webm' };
const ED1 = { externalId: 'anime:185874', slug: 'ED1', src: 'https://v.animethemes.moe/Bleach2026-ED1.webm' };

describe('theme capture queue', () => {
  it('downloads one theme at a time as background work, and requeues the running one when the overlay opens', async () => {
    enqueueThemeCapture(OP1);
    enqueueThemeCapture(ED1);
    await flush();
    expect(tauri.cacheThemeVideo).toHaveBeenCalledTimes(1);
    expect(tauri.cacheThemeVideo).toHaveBeenLastCalledWith(OP1.src, OP1.externalId, OP1.slug);
    expect(acquireForUrl).toHaveBeenLastCalledWith(OP1.src, 'background', expect.any(AbortSignal));

    suspendThemeBackgroundTraffic();
    expect(tauri.cancelThemeVideoDownloads).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(10_000);
    // Nothing starts while suspended, and the hover warm-up is refused too.
    expect(tauri.cacheThemeVideo).toHaveBeenCalledTimes(1);
    expect(await warmThemeVideo(ED1)).toBeNull();

    resumeThemeBackgroundTraffic();
    await vi.advanceTimersByTimeAsync(2_000);
    // The cancelled item goes first, not to the back and not as a failure.
    expect(tauri.cacheThemeVideo).toHaveBeenCalledTimes(2);
    expect(tauri.cacheThemeVideo).toHaveBeenLastCalledWith(OP1.src, OP1.externalId, OP1.slug);
  });
});
