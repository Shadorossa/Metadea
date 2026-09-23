// The theme cards' preview-frame capture: for each OP/ED without a saved
// frame, Rust downloads the video to the disk cache (cache_theme_video), it
// plays offscreen from a blob and the middle frame is saved as the card's
// still. One item at a time with a gap in between, each download taking a
// 'background' slot on the v.animethemes.moe budget; the whole queue stops
// (and the running download is cancelled and re-queued) while the OP/ED
// overlay has background traffic suspended — see theme-traffic.ts.
//
// Also home of the hover warm-up: a card hovered long enough gets its video
// cached ahead of a click, so the overlay then plays it from disk.
import { cacheThemeVideo, getThemePreviewFrame, getThemeVideoPath, saveThemePreviewFrame } from '../../tauri/themes';
import { isTauri, wrapAssetUrl } from '../../tauri/bridge';
import { acquireForUrl } from '../../api/rate-limiter';
import { isThemeTrafficSuspended, subscribeThemeTraffic, themeBackgroundSignal } from './theme-traffic';

export interface ThemeCaptureTarget {
  externalId: string;
  slug: string;
  /** The theme's remote video_url. */
  src: string;
}

type CaptureListener = (frameUrl: string, videoUrl?: string) => void;

interface QueueItem extends ThemeCaptureTarget {
  key: string;
  retryCount: number;
}

const MAX_CAPTURE_RETRIES = 2;
const CAPTURE_RETRY_DELAY_MS = 2000;
// Pause between two items that touched the network.
const CAPTURE_ITEM_GAP_MS = 1500;
const OFFSCREEN_CAPTURE_TIMEOUT_MS = 25000;

const captureQueue: QueueItem[] = [];
const listeners = new Map<string, CaptureListener>();
// A capture or a warm-up download is in flight (only one at a time).
let busy = false;
let nextTimer: ReturnType<typeof setTimeout> | null = null;

export function themeCaptureKey(externalId: string, slug: string): string {
  return `${externalId}::${slug}`;
}

function scheduleNext(delayMs: number): void {
  if (nextTimer !== null) clearTimeout(nextTimer);
  nextTimer = setTimeout(() => {
    nextTimer = null;
    void processNextQueueItem();
  }, delayMs);
}

subscribeThemeTraffic(() => {
  if (!isThemeTrafficSuspended()) scheduleNext(CAPTURE_ITEM_GAP_MS);
});

export function subscribeToThemeCapture(key: string, listener: CaptureListener): void {
  listeners.set(key, listener);
}

export function unsubscribeFromThemeCapture(key: string): void {
  listeners.delete(key);
}

export function enqueueThemeCapture(target: ThemeCaptureTarget, retryCount = 0): void {
  // The download and the frame save are Rust commands.
  if (!isTauri()) return;
  const key = themeCaptureKey(target.externalId, target.slug);
  if (captureQueue.some(q => q.key === key)) return;
  captureQueue.push({ ...target, key, retryCount });
  void processNextQueueItem();
}

function abortError(): DOMException {
  return new DOMException('Aborted', 'AbortError');
}

// Local path of the theme's cached video, downloading it first (one
// 'background' slot on the CDN budget) when it isn't cached yet.
async function ensureCachedThemeVideo(target: ThemeCaptureTarget, signal: AbortSignal): Promise<string> {
  const cached = await getThemeVideoPath(target.externalId, target.slug).catch(() => null);
  if (cached) return cached;
  await acquireForUrl(target.src, 'background', signal);
  if (signal.aborted) throw abortError();
  const path = await cacheThemeVideo(target.src, target.externalId, target.slug);
  if (!path) throw new Error('Empty cached video path');
  return path;
}

// Plays the cached file offscreen (from a same-origin blob, so the canvas
// isn't tainted) and saves its middle frame.
async function captureMiddleFrame(item: QueueItem, localVideoPath: string): Promise<void> {
  const listener = listeners.get(item.key);
  const assetUrl = wrapAssetUrl(localVideoPath);
  const resp = await fetch(assetUrl);
  const blob = await resp.blob();
  const blobUrl = URL.createObjectURL(blob);

  await new Promise<void>((resolve, reject) => {
    const offscreenVideo = document.createElement('video');
    offscreenVideo.muted = true;
    offscreenVideo.playsInline = true;
    offscreenVideo.src = blobUrl;

    let settled = false;
    const cleanup = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      offscreenVideo.removeAttribute('src');
      offscreenVideo.load();
      URL.revokeObjectURL(blobUrl);
    };

    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('Offscreen capture timeout'));
    }, OFFSCREEN_CAPTURE_TIMEOUT_MS);

    const doCapture = async () => {
      try {
        const vw = offscreenVideo.videoWidth || 1280;
        const vh = offscreenVideo.videoHeight || 720;
        const targetWidth = Math.min(1280, vw);
        const aspect = vh / vw;
        const canvas = document.createElement('canvas');
        canvas.width = targetWidth;
        canvas.height = Math.round(targetWidth * aspect);
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(offscreenVideo, 0, 0, canvas.width, canvas.height);
          const dataUrl = canvas.toDataURL('image/webp', 0.90);
          const savedPath = await saveThemePreviewFrame(item.externalId, item.slug, dataUrl);
          if (savedPath && listener) listener(wrapAssetUrl(savedPath), assetUrl);
        }
        cleanup();
        resolve();
      } catch (e) {
        cleanup();
        reject(e);
      }
    };

    offscreenVideo.onloadedmetadata = () => {
      const dur = offscreenVideo.duration;
      offscreenVideo.currentTime = (dur && isFinite(dur) && dur > 2) ? Math.floor(dur / 2) : 1;
    };
    offscreenVideo.onseeked = () => { void doCapture(); };
    offscreenVideo.onerror = () => {
      cleanup();
      reject(new Error('Offscreen video load error'));
    };
  });
}

async function processNextQueueItem(): Promise<void> {
  if (isThemeTrafficSuspended() || busy) return;
  const item = captureQueue.shift();
  if (!item) return;
  busy = true;
  const signal = themeBackgroundSignal();
  let touchedNetwork = false;
  let requeue = false;

  try {
    const existing = await getThemePreviewFrame(item.externalId, item.slug).catch(() => null);
    if (existing) {
      listeners.get(item.key)?.(wrapAssetUrl(existing));
      return;
    }
    touchedNetwork = true;
    const localVideoPath = await ensureCachedThemeVideo(item, signal);
    await captureMiddleFrame(item, localVideoPath);
  } catch (err) {
    if (signal.aborted) {
      // Suspended by the overlay, not a failure: pick it up again first.
      requeue = true;
    } else {
      console.warn(`[ThemePreview] Capture failed for ${item.key}:`, err);
      if (item.retryCount < MAX_CAPTURE_RETRIES) {
        setTimeout(() => enqueueThemeCapture(item, item.retryCount + 1), CAPTURE_RETRY_DELAY_MS);
      }
    }
  } finally {
    busy = false;
    if (requeue) captureQueue.unshift(item);
    scheduleNext(touchedNetwork ? CAPTURE_ITEM_GAP_MS : 0);
  }
}

/**
 * Caches a hovered theme's video ahead of a click, when nothing else is
 * downloading and the overlay isn't open. Resolves to the playable local
 * URL, or null when skipped or failed (the card keeps its still frame).
 */
export async function warmThemeVideo(target: ThemeCaptureTarget): Promise<string | null> {
  if (!isTauri() || isThemeTrafficSuspended() || busy) return null;
  busy = true;
  try {
    return wrapAssetUrl(await ensureCachedThemeVideo(target, themeBackgroundSignal()));
  } catch {
    return null;
  } finally {
    busy = false;
    scheduleNext(CAPTURE_ITEM_GAP_MS);
  }
}
