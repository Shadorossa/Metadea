import { useCallback, useEffect, useRef } from 'react';
import type { MediaTheme } from '../../../lib/tauri';
import { setThemePresence, clearThemePresence } from '../../../lib/local/discord-presence';
import { buildPresenceSnapshot, shouldResendPresence, type PresenceSnapshot } from '../../../lib/player/presence-sync';
import { toMediumCover } from '../../../lib/media/small-cover';

interface Params {
  theme: MediaTheme;
  mediaTitle: string;
  cover?: string | null;
}

// Discord "Listening <song>" presence for the theme player's <video>: the
// returned handlers go straight on the element. Timestamps follow the
// element's own currentTime/duration/playbackRate so seeks and speed changes
// keep the countdown honest; presence is cleared when the theme changes or
// the overlay unmounts.
export function useThemePresence({ theme, mediaTitle, cover }: Params) {
  const lastSent = useRef<PresenceSnapshot | null>(null);

  const publish = useCallback((video: HTMLVideoElement) => {
    const status = video.paused || video.ended ? 'paused' : 'playing';
    const snapshot = buildPresenceSnapshot(status, Math.floor(Date.now() / 1000), video.currentTime, video.duration, video.playbackRate);
    if (!shouldResendPresence(lastSent.current, snapshot)) return;
    lastSent.current = snapshot;
    setThemePresence({
      themeLabel: `${theme.theme_type}${theme.sequence}`,
      songTitle: theme.song_title,
      artists: theme.artists,
      mediaTitle,
      status: snapshot.status,
      startTime: snapshot.startTime,
      endTime: snapshot.endTime,
      coverUrl: cover && cover.startsWith('http') ? toMediumCover(cover) : undefined,
    });
  }, [theme.theme_type, theme.sequence, theme.song_title, theme.artists, mediaTitle, cover]);

  useEffect(() => {
    lastSent.current = null;
    return () => {
      lastSent.current = null;
      clearThemePresence();
    };
  }, [theme.slug]);

  const onEvent = useCallback((event: React.SyntheticEvent<HTMLVideoElement>) => publish(event.currentTarget), [publish]);

  return {
    onPlay: onEvent,
    onPause: onEvent,
    onSeeked: onEvent,
    onRateChange: onEvent,
    onLoadedMetadata: onEvent,
    onEnded: onEvent,
  };
}
