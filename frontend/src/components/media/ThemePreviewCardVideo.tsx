import { useRef, useEffect, useState } from 'react';
import { getThemePreviewFrame, saveThemePreviewFrame, fetchThemeVideoBlob } from '../../lib/tauri/misc-commands';
import { wrapAssetUrl } from '../../lib/tauri';

interface Props {
  externalId: string;
  slug: string;
  src?: string;
  initialPreviewUrl?: string;
  isHovered?: boolean;
}

const PREVIEW_SECONDS = 3;

export function ThemePreviewCardVideo({ externalId, slug, src, initialPreviewUrl, isHovered }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const midpointRef = useRef(0);
  const isCapturingRef = useRef(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [localFrameUrl, setLocalFrameUrl] = useState<string | null>(
    () => initialPreviewUrl ? wrapAssetUrl(initialPreviewUrl) : null,
  );

  useEffect(() => {
    if (initialPreviewUrl) {
      setLocalFrameUrl(wrapAssetUrl(initialPreviewUrl));
      return;
    }
    let cancelled = false;
    getThemePreviewFrame(externalId, slug).then(path => {
      if (!cancelled && path) {
        setLocalFrameUrl(wrapAssetUrl(path));
      }
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [externalId, slug, initialPreviewUrl]);

  const captureAndSaveFrame = async (video: HTMLVideoElement) => {
    if (localFrameUrl || isCapturingRef.current) return;
    isCapturingRef.current = true;

    try {
      const canvas = document.createElement('canvas');
      const targetWidth = 320;
      const aspect = (video.videoWidth && video.videoHeight) ? (video.videoHeight / video.videoWidth) : (9 / 16);
      canvas.width = targetWidth;
      canvas.height = Math.round(targetWidth * aspect);
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        isCapturingRef.current = false;
        return;
      }

      try {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL('image/webp', 0.75);
        const path = await saveThemePreviewFrame(externalId, slug, dataUrl);
        if (path) {
          setLocalFrameUrl(wrapAssetUrl(path));
          isCapturingRef.current = false;
          return;
        }
      } catch {
        // Tainted canvas due to cross-origin video. Fallback to fetching via Tauri
      }

      if (!src) {
        isCapturingRef.current = false;
        return;
      }

      // Fetch video data URL via Rust backend (bypasses browser CORS policy completely)
      const cleanDataUrl = await fetchThemeVideoBlob(src);
      const offscreenVideo = document.createElement('video');
      offscreenVideo.muted = true;
      offscreenVideo.playsInline = true;
      offscreenVideo.src = cleanDataUrl;

      offscreenVideo.onloadedmetadata = () => {
        const mid = Math.floor((offscreenVideo.duration || 0) / 2);
        offscreenVideo.currentTime = mid;
      };

      offscreenVideo.onseeked = async () => {
        try {
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(offscreenVideo, 0, 0, canvas.width, canvas.height);
          const dataUrl = canvas.toDataURL('image/webp', 0.75);
          const path = await saveThemePreviewFrame(externalId, slug, dataUrl);
          if (path) {
            setLocalFrameUrl(wrapAssetUrl(path));
          }
        } catch (e) {
          console.error('Failed to capture frame from offscreen video', e);
        } finally {
          offscreenVideo.src = '';
          isCapturingRef.current = false;
        }
      };
    } catch {
      isCapturingRef.current = false;
    }
  };

  const initMidpoint = () => {
    const video = videoRef.current;
    if (!video || midpointRef.current > 0 || !video.duration) return;
    midpointRef.current = Math.floor(video.duration / 2);
    video.currentTime = midpointRef.current;
  };

  const handleLoadedMetadata = () => {
    initMidpoint();
  };

  const handleLoadedData = () => {
    initMidpoint();
  };

  const handleSeeked = () => {
    const video = videoRef.current;
    if (!video || midpointRef.current <= 0) return;
    if (!localFrameUrl) {
      captureAndSaveFrame(video);
    }
  };

  const handleTimeUpdate = () => {
    const video = videoRef.current;
    if (!video || midpointRef.current <= 0) return;
    if (video.currentTime - midpointRef.current >= PREVIEW_SECONDS || video.currentTime < midpointRef.current) {
      video.currentTime = midpointRef.current;
    }
  };

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !src) return;

    if (isHovered) {
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

  return (
    <>
      {localFrameUrl && (
        <img
          src={localFrameUrl}
          alt=""
          className="media-theme-preview-img"
          loading="lazy"
        />
      )}
      {src && (
        <video
          ref={videoRef}
          className={`media-theme-preview-video${isPlaying ? ' is-playing' : ' is-idle'}`}
          src={src}
          muted
          playsInline
          preload="auto"
          onLoadedMetadata={handleLoadedMetadata}
          onLoadedData={handleLoadedData}
          onSeeked={handleSeeked}
          onTimeUpdate={handleTimeUpdate}
        />
      )}
    </>
  );
}



