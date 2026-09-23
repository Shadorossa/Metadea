import { useRef, useEffect, useState, useSyncExternalStore } from 'react';
import { getThemePreviewFrame, getThemeVideoPath } from '../../lib/tauri/themes';
import { wrapAssetUrl } from '../../lib/tauri';
import { getCachedThemeVideo, cacheThemeVideo as cacheThemeVideoBlob } from '../../lib/media/themes/theme-video-cache';
import {
  enqueueThemeCapture,
  subscribeToThemeCapture,
  themeCaptureKey,
  unsubscribeFromThemeCapture,
  warmThemeVideo,
} from '../../lib/media/themes/theme-capture-queue';
import { isThemeTrafficSuspended, subscribeThemeTraffic, themeBackgroundSignal } from '../../lib/media/themes/theme-traffic';

interface Props {
  externalId: string;
  slug: string;
  src?: string;
  initialPreviewUrl?: string;
  fallbackUrl?: string;
  isHovered?: boolean;
}

const PREVIEW_SECONDS = 3;
// How long a card has to stay hovered before its video is cached ahead of a
// click (see warmThemeVideo).
const HOVER_WARMUP_MS = 400;

// A theme card's still frame and, on hover, a few looping seconds of its
// video. The hover video only ever plays a local copy (the disk cache, or
// its IndexedDB blob): streaming v.animethemes.moe from every card spent
// the CDN's tiny per-IP budget and made the OP/ED overlay's own stream fail.
// An uncached card caches its video after a short hover instead.
export function ThemePreviewCardVideo({ externalId, slug, src, initialPreviewUrl, fallbackUrl, isHovered }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const midpointRef = useRef(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [localFrameUrl, setLocalFrameUrl] = useState<string | null>(
    () => initialPreviewUrl ? wrapAssetUrl(initialPreviewUrl) : null,
  );
  const [localVideoSrc, setLocalVideoSrc] = useState<string | null>(null);
  const trafficSuspended = useSyncExternalStore(subscribeThemeTraffic, isThemeTrafficSuspended, () => false);

  const taskKey = themeCaptureKey(externalId, slug);

  useEffect(() => {
    let cancelled = false;
    let blobUrl: string | null = null;
    // The IndexedDB copy made after a capture; aborted with the card or when
    // the overlay suspends background work.
    const blobCopy = new AbortController();
    const background = themeBackgroundSignal();
    const stopBlobCopy = () => blobCopy.abort();
    background.addEventListener('abort', stopBlobCopy, { once: true });

    const loadVideo = async () => {
      const cachedBlob = await getCachedThemeVideo(taskKey);
      if (cancelled) return;
      if (cachedBlob) {
        blobUrl = URL.createObjectURL(cachedBlob);
        setLocalVideoSrc(blobUrl);
        return;
      }
      getThemeVideoPath(externalId, slug).then(path => {
        if (!cancelled && path) setLocalVideoSrc(wrapAssetUrl(path));
      }).catch(() => {});
    };

    void loadVideo();

    if (initialPreviewUrl) {
      setLocalFrameUrl(wrapAssetUrl(initialPreviewUrl));
    } else {
      getThemePreviewFrame(externalId, slug).then(path => {
        if (cancelled) return;
        if (path) {
          setLocalFrameUrl(wrapAssetUrl(path));
        } else if (src) {
          subscribeToThemeCapture(taskKey, (url, videoUrl) => {
            if (cancelled) return;
            setLocalFrameUrl(url);
            if (!videoUrl) return;
            setLocalVideoSrc(videoUrl);
            if (blobCopy.signal.aborted) return;
            fetch(videoUrl, { signal: blobCopy.signal })
              .then(r => r.blob())
              .then(blob => cacheThemeVideoBlob(taskKey, blob))
              .catch(() => {});
          });
          enqueueThemeCapture({ externalId, slug, src });
        }
      }).catch(() => {});
    }

    return () => {
      cancelled = true;
      blobCopy.abort();
      background.removeEventListener('abort', stopBlobCopy);
      unsubscribeFromThemeCapture(taskKey);
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [externalId, slug, initialPreviewUrl, src, taskKey]);

  // Hover warm-up: cache the video so hovering previews it and a click plays
  // it from disk.
  useEffect(() => {
    if (!isHovered || localVideoSrc || !src || trafficSuspended) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      warmThemeVideo({ externalId, slug, src }).then(url => {
        if (!cancelled && url) setLocalVideoSrc(url);
      });
    }, HOVER_WARMUP_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [isHovered, localVideoSrc, src, trafficSuspended, externalId, slug]);

  // Unloaded while the overlay is open.
  const videoSrc = trafficSuspended ? null : localVideoSrc;

  // Releases the element's media resource when its source goes away (or the
  // card unmounts) instead of waiting for garbage collection.
  useEffect(() => {
    const video = videoRef.current;
    midpointRef.current = 0;
    if (!video) return;
    return () => {
      video.pause();
      video.removeAttribute('src');
      video.load();
    };
  }, [videoSrc]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !videoSrc) return;

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
  }, [isHovered, videoSrc]);

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

  const showVideo = !!videoSrc && !!isHovered && isPlaying;
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
      {videoSrc && (
        <video
          key={videoSrc}
          ref={videoRef}
          className={`media-theme-preview-video${showVideo ? ' is-playing' : ' is-idle'}`}
          src={videoSrc}
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
