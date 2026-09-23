import { useEffect, useState } from 'react';
import type { MediaTheme } from '../../../lib/tauri';
import { wrapAssetUrl } from '../../../lib/tauri';
import { getThemeVideoPath } from '../../../lib/tauri/themes';
import { pauseThemeCaptureQueue, resumeThemeCaptureQueue } from '../ThemePreviewCardVideo';

interface Params {
  currentId: string;
  previewMode: boolean;
  themes: MediaTheme[];
}

// The OP/ED player overlay's own state: which theme is open, which version
// of it, the resolved video source, and the error/retry pair the overlay's
// retry button drives. The themes list itself is loaded by useMediaPageData.
export function useThemePlayer({ currentId, previewMode, themes }: Params) {
  const [playingTheme,          setPlayingTheme]          = useState<MediaTheme | null>(null);
  const [selectedThemeVersion,  setSelectedThemeVersion]  = useState<number>(1);
  const [playingVideoSrc,       setPlayingVideoSrc]       = useState<string | null>(null);
  const [playerError,        setPlayerError]        = useState(false);
  const [playerRetryKey,     setPlayerRetryKey]     = useState(0);

  // Close the player on navigation — same trigger and guards as the main
  // load effect this reset used to be part of.
  useEffect(() => {
    if (previewMode) return;
    if (!currentId) return;
    setPlayingTheme(null);
    setPlayingVideoSrc(null);
  }, [currentId, previewMode]);

  useEffect(() => {
    if (!playingTheme) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') {
        const idx = themes.findIndex(t => t.slug === playingTheme.slug);
        if (idx > 0) setPlayingTheme(themes[idx - 1]);
      } else if (e.key === 'ArrowRight') {
        const idx = themes.findIndex(t => t.slug === playingTheme.slug);
        if (idx >= 0 && idx < themes.length - 1) setPlayingTheme(themes[idx + 1]);
      } else if (e.key === 'Escape') {
        setPlayingTheme(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [playingTheme, themes]);

  useEffect(() => {
    if (!playingTheme) {
      resumeThemeCaptureQueue();
      setPlayingVideoSrc(null);
      setPlayerError(false);
      return;
    }

    pauseThemeCaptureQueue();
    setPlayerError(false);

    let cancelled = false;

    let targetVideoUrl = playingTheme.video_url;
    if (playingTheme.versions) {
      try {
        const parsed = JSON.parse(playingTheme.versions);
        if (Array.isArray(parsed)) {
          const vObj = parsed.find((v: any) => v.version === selectedThemeVersion) || parsed[0];
          if (vObj?.videoUrl) targetVideoUrl = vObj.videoUrl;
        }
      } catch {}
    }

    if (selectedThemeVersion === 1) {
      getThemeVideoPath(playingTheme.external_id, playingTheme.slug)
        .then(path => {
          if (cancelled) return;
          if (path) {
            setPlayingVideoSrc(wrapAssetUrl(path));
          } else if (targetVideoUrl) {
            setPlayingVideoSrc(targetVideoUrl);
          } else {
            setPlayingVideoSrc(null);
            setPlayerError(true);
          }
        })
        .catch(() => {
          if (cancelled) return;
          if (targetVideoUrl) {
            setPlayingVideoSrc(targetVideoUrl);
          } else {
            setPlayingVideoSrc(null);
            setPlayerError(true);
          }
        });
    } else {
      if (targetVideoUrl) {
        setPlayingVideoSrc(targetVideoUrl);
      } else {
        setPlayingVideoSrc(null);
        setPlayerError(true);
      }
    }

    return () => {
      cancelled = true;
    };
  }, [playingTheme, playerRetryKey, selectedThemeVersion]);

  return {
    playingTheme, setPlayingTheme,
    selectedThemeVersion, setSelectedThemeVersion,
    playingVideoSrc, setPlayingVideoSrc,
    playerError, setPlayerError,
    playerRetryKey, setPlayerRetryKey,
  };
}
