import { useRef, useEffect, useState } from 'react';
import { getThemePreviewFrame, saveThemePreviewFrame, cacheThemeVideo, getThemeVideoPath } from '../../lib/tauri/misc-commands';
import { wrapAssetUrl } from '../../lib/tauri';
import { getCachedThemeVideo, cacheThemeVideo as cacheThemeVideoBlob } from '../../lib/media/themeVideoCache';

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
const queueListeners = new Map<string, (frameUrl: string, videoUrl?: string) => void>();
let isQueueProcessing = false;

function subscribeToCapture(key: string, callback: (frameUrl: string, videoUrl?: string) => void) {
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
              listener(wrapAssetUrl(savedPath), assetUrl);
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
  const [localVideoSrc, setLocalVideoSrc] = useState<string | null>(null);

  const taskKey = `${externalId}::${slug}`;

  useEffect(() => {
    let cancelled = false;

    const loadVideo = async () => {
      // Try cache first
      const cacheKey = `${externalId}::${slug}`;
      const cachedBlob = await getCachedThemeVideo(cacheKey);
      if (!cancelled && cachedBlob) {
        const blobUrl = URL.createObjectURL(cachedBlob);
        setLocalVideoSrc(blobUrl);
        return;
      }

      // Fall back to Tauri filesystem cache
      getThemeVideoPath(externalId, slug).then(path => {
        if (!cancelled && path) {
          setLocalVideoSrc(wrapAssetUrl(path));
        }
      }).catch(() => {});
    };

    loadVideo();

    if (initialPreviewUrl) {
      setLocalFrameUrl(wrapAssetUrl(initialPreviewUrl));
      return () => { cancelled = true; };
    }

    getThemePreviewFrame(externalId, slug).then(path => {
      if (cancelled) return;
      if (path) {
        setLocalFrameUrl(wrapAssetUrl(path));
      } else if (src) {
        subscribeToCapture(taskKey, (url, videoUrl) => {
          if (!cancelled) {
            setLocalFrameUrl(url);
            if (videoUrl) {
              setLocalVideoSrc(videoUrl);
              // Also cache this video blob for future use
              fetch(videoUrl)
                .then(r => r.blob())
                .then(blob => cacheThemeVideoBlob(`${externalId}::${slug}`, blob))
                .catch(() => {});
            }
          }
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

  const activeVideoSrc = localVideoSrc || src;

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !activeVideoSrc) return;

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
  }, [isHovered, activeVideoSrc]);

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
    if (video.currentTime >= midpointRef.current + PREVIEW_SECONDS) {
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
      {activeVideoSrc && (
        <video
          ref={videoRef}
          className={`media-theme-preview-video${showVideo ? ' is-playing' : ' is-idle'}`}
          src={activeVideoSrc}
          muted
          playsInline
          preload="auto"
          onLoadedMetadata={handleLoadedMetadata}
          onTimeUpdate={handleTimeUpdate}
          onPlaying={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
        />
      )}
    </>
  );
}
