import { useRef, useEffect, useState } from 'react';
import { getThemePreviewFrame, saveThemePreviewFrame, cacheThemeVideo, deleteCachedThemeVideo } from '../../lib/tauri/misc-commands';
import { wrapAssetUrl } from '../../lib/tauri';

interface Props {
  externalId: string;
  slug: string;
  src?: string;
  initialPreviewUrl?: string;
  fallbackUrl?: string;
  isHovered?: boolean;
}

const PREVIEW_SECONDS = 3;

type QueueItem = {
  key: string;
  externalId: string;
  slug: string;
  src: string;
  retryCount: number;
};

const captureQueue: QueueItem[] = [];
const queueListeners = new Map<string, (url: string) => void>();
let isQueueProcessing = false;

function subscribeToCapture(key: string, callback: (url: string) => void) {
  queueListeners.set(key, callback);
}

function unsubscribeFromCapture(key: string) {
  queueListeners.delete(key);
}

function enqueueCapture(item: QueueItem) {
  if (captureQueue.some(q => q.key === item.key)) return;
  captureQueue.push(item);
  processNextQueueItem();
}

async function processNextQueueItem() {
  if (isQueueProcessing || captureQueue.length === 0) return;
  isQueueProcessing = true;

  const item = captureQueue.shift()!;
  const listener = queueListeners.get(item.key);

  try {
    const existing = await getThemePreviewFrame(item.externalId, item.slug).catch(() => null);
    if (existing) {
      if (listener) listener(wrapAssetUrl(existing));
      isQueueProcessing = false;
      processNextQueueItem();
      return;
    }

    const localVideoPath = await cacheThemeVideo(item.src, item.externalId, item.slug);
    if (!localVideoPath) {
      throw new Error('Empty cached video path');
    }

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
        offscreenVideo.src = '';
        URL.revokeObjectURL(blobUrl);
        deleteCachedThemeVideo(item.externalId, item.slug).catch(() => {});
      };

      const timer = setTimeout(() => {
        cleanup();
        reject(new Error('Offscreen capture timeout'));
      }, 25000);

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
            if (savedPath && listener) {
              listener(wrapAssetUrl(savedPath));
            }
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

      offscreenVideo.onseeked = () => {
        doCapture();
      };

      offscreenVideo.onerror = () => {
        cleanup();
        reject(new Error('Offscreen video load error'));
      };
    });
  } catch (err) {
    console.warn(`[ThemePreview] Capture failed for ${item.key}:`, err);
    if (item.retryCount < 2) {
      setTimeout(() => {
        enqueueCapture({ ...item, retryCount: item.retryCount + 1 });
      }, 2000);
    }
  } finally {
    isQueueProcessing = false;
    processNextQueueItem();
  }
}

export function ThemePreviewCardVideo({ externalId, slug, src, initialPreviewUrl, fallbackUrl, isHovered }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const midpointRef = useRef(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [localFrameUrl, setLocalFrameUrl] = useState<string | null>(
    () => initialPreviewUrl ? wrapAssetUrl(initialPreviewUrl) : null,
  );

  const taskKey = `${externalId}::${slug}`;

  useEffect(() => {
    if (initialPreviewUrl) {
      setLocalFrameUrl(wrapAssetUrl(initialPreviewUrl));
      return;
    }

    let cancelled = false;
    getThemePreviewFrame(externalId, slug).then(path => {
      if (cancelled) return;
      if (path) {
        setLocalFrameUrl(wrapAssetUrl(path));
      } else if (src) {
        subscribeToCapture(taskKey, url => {
          if (!cancelled) setLocalFrameUrl(url);
        });
        enqueueCapture({
          key: taskKey,
          externalId,
          slug,
          src,
          retryCount: 0,
        });
      }
    }).catch(() => {});

    return () => {
      cancelled = true;
      unsubscribeFromCapture(taskKey);
    };
  }, [externalId, slug, initialPreviewUrl, src, taskKey]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !src) return;

    if (isHovered) {
      if (midpointRef.current > 0) {
        video.currentTime = midpointRef.current;
      }
      const playPromise = video.play();
      if (playPromise !== undefined) {
        playPromise.then(() => setIsPlaying(true)).catch(() => {});
      }
    } else {
      video.pause();
      setIsPlaying(false);
      if (midpointRef.current > 0) {
        video.currentTime = midpointRef.current;
      }
    }
  }, [isHovered, src]);

  const handleLoadedMetadata = () => {
    const video = videoRef.current;
    if (!video || midpointRef.current > 0) return;
    const dur = video.duration;
    if (!dur) return;
    midpointRef.current = (isFinite(dur) && dur > 2) ? Math.floor(dur / 2) : 1;
    video.currentTime = midpointRef.current;
    if (isHovered) {
      video.play().then(() => setIsPlaying(true)).catch(() => {});
    }
  };

  const handleTimeUpdate = () => {
    const video = videoRef.current;
    if (!video || midpointRef.current <= 0) return;
    if (video.currentTime - midpointRef.current >= PREVIEW_SECONDS || video.currentTime < midpointRef.current) {
      video.currentTime = midpointRef.current;
    }
  };

  const showVideo = isHovered && isPlaying;
  const displayImage = localFrameUrl || fallbackUrl;

  return (
    <>
      {displayImage && (
        <img
          src={displayImage}
          alt=""
          className={`media-theme-preview-img${showVideo ? ' is-hidden' : ''}`}
          loading="lazy"
          onError={() => {
            if (localFrameUrl) setLocalFrameUrl(null);
          }}
        />
      )}
      {src && (
        <video
          ref={videoRef}
          className={`media-theme-preview-video${showVideo ? ' is-playing' : ' is-idle'}`}
          src={src}
          muted
          playsInline
          preload="metadata"
          onLoadedMetadata={handleLoadedMetadata}
          onTimeUpdate={handleTimeUpdate}
          onPlaying={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
        />
      )}
    </>
  );
}
