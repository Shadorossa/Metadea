import { useCallback, useEffect, useRef, useState } from 'react';
import { useKeyedState } from '../../shared/hooks/useKeyedState';
import type { MediaTheme } from '../../../lib/tauri';
import { wrapAssetUrl } from '../../../lib/tauri';
import { deleteCachedThemeVideo, getThemeVideoPath } from '../../../lib/tauri/themes';
import { acquireForUrl } from '../../../lib/api/rate-limiter';
import {
  buildThemeSourceChain,
  nextThemeSourceStep,
  type ThemeSource,
  type ThemeSourceCursor,
  type ThemeSourceKind,
} from '../../../lib/media/themes/theme-source-chain';
import { resumeThemeBackgroundTraffic, suspendThemeBackgroundTraffic } from '../../../lib/media/themes/theme-traffic';

interface Params {
  currentId: string;
  themes: MediaTheme[];
}

/** One load attempt of the overlay's <video>; `loadKey` remounts the element. */
export interface ThemeVideoSource {
  url: string;
  kind: ThemeSourceKind;
  /** The version actually playing: a fallback may play another than the selected one. */
  version: number;
  loadKey: number;
  /** Where to resume after a mid-play failure of the same video. */
  startAt: number;
}

interface ChainRun {
  id: number;
  // The Retry button's run: the cached file already failed or is suspect.
  skipCache: boolean;
}

// The OP/ED player overlay's own state: which theme is open, which version
// of it, and the video source it is playing. The source walks the chain in
// lib/media/themes/theme-source-chain.ts (disk cache → remote, retried →
// other versions) and only surfaces `playerError` once that is exhausted.
// While the overlay is open every other request the page makes to the video
// CDN is suspended (theme-traffic.ts). The themes list itself is loaded by
// useMediaPageData.
export function useThemePlayer({ currentId, themes }: Params) {
  // The player closes on navigation — all of it is keyed on the current work.
  const [playingTheme,         setPlayingThemeState]   = useKeyedState<MediaTheme | null>(currentId, null);
  const [selectedThemeVersion, setSelectedVersionState] = useKeyedState<number>(currentId, 1);
  const [videoSource,          setVideoSource]          = useKeyedState<ThemeVideoSource | null>(currentId, null);
  const [playerError,          setPlayerError]          = useKeyedState<boolean>(currentId, false);
  const [chainRun,             setChainRun]             = useState<ChainRun>({ id: 0, skipCache: false });
  const loadKeyRef = useRef(0);
  // Set by the running chain; the overlay's <video> onError lands here.
  const onSourceErrorRef = useRef<((loadKey: number, position: number) => void) | null>(null);

  // Switching theme resets everything in the same render: no frame shows
  // the previous theme's video under the new theme, and a v2 picked on the
  // previous theme doesn't carry over (which also skipped the cache).
  const setPlayingTheme = useCallback((theme: MediaTheme | null) => {
    setPlayingThemeState(theme);
    setSelectedVersionState(1);
    setVideoSource(null);
    setPlayerError(false);
    setChainRun(run => ({ id: run.id + 1, skipCache: false }));
  }, [setPlayingThemeState, setSelectedVersionState, setVideoSource, setPlayerError]);

  const selectVersion = useCallback((version: number) => {
    setSelectedVersionState(version);
    setVideoSource(null);
    setPlayerError(false);
    setChainRun(run => ({ id: run.id + 1, skipCache: false }));
  }, [setSelectedVersionState, setVideoSource, setPlayerError]);

  const retry = useCallback(() => {
    setVideoSource(null);
    setPlayerError(false);
    setChainRun(run => ({ id: run.id + 1, skipCache: true }));
  }, [setVideoSource, setPlayerError]);

  const onVideoError = useCallback((loadKey: number, position: number) => {
    onSourceErrorRef.current?.(loadKey, position);
  }, []);

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
  }, [playingTheme, themes, setPlayingTheme]);

  const overlayOpen = playingTheme !== null;
  useEffect(() => {
    if (!overlayOpen) return;
    suspendThemeBackgroundTraffic();
    return () => resumeThemeBackgroundTraffic();
  }, [overlayOpen]);

  useEffect(() => {
    if (!playingTheme) return;
    const theme = playingTheme;
    const run = new AbortController();
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let chain: ThemeSource[] = [];
    let cursor: ThemeSourceCursor = { index: 0, retries: 0 };
    let activeLoadKey = -1;

    const load = async (startAt: number) => {
      const source = chain[cursor.index];
      // A remote load takes a 'user' slot on the CDN budget: ahead of any
      // queued background work, and never a request the CDN would 503.
      if (source.kind === 'remote') {
        try {
          await acquireForUrl(source.url, 'user', run.signal);
        } catch {
          return;
        }
      }
      if (run.signal.aborted) return;
      activeLoadKey = ++loadKeyRef.current;
      setVideoSource({ url: source.url, kind: source.kind, version: source.version, loadKey: activeLoadKey, startAt });
    };

    onSourceErrorRef.current = (loadKey, position) => {
      if (run.signal.aborted || loadKey !== activeLoadKey) return;
      activeLoadKey = -1;
      const failed = chain[cursor.index];
      // A cached file that doesn't play is broken: drop it so neither this
      // chain's next run nor the jukebox picks it up again.
      if (failed.kind === 'cache') deleteCachedThemeVideo(theme.external_id, theme.slug).catch(() => {});
      const step = nextThemeSourceStep(chain, cursor);
      if (step.type === 'exhausted') {
        setVideoSource(null);
        setPlayerError(true);
        return;
      }
      cursor = step.cursor;
      const resumeAt = chain[cursor.index].version === failed.version ? position : 0;
      setVideoSource(null);
      if (step.type === 'retry') {
        retryTimer = setTimeout(() => { void load(resumeAt); }, step.delayMs);
      } else {
        void load(resumeAt);
      }
    };

    (async () => {
      const cachedPath = chainRun.skipCache
        ? null
        : await getThemeVideoPath(theme.external_id, theme.slug).catch(() => null);
      if (run.signal.aborted) return;
      chain = buildThemeSourceChain(theme, selectedThemeVersion, cachedPath ? wrapAssetUrl(cachedPath) : null);
      if (chain.length === 0) {
        setPlayerError(true);
        return;
      }
      await load(0);
    })();

    return () => {
      run.abort();
      clearTimeout(retryTimer);
      onSourceErrorRef.current = null;
    };
  }, [playingTheme, selectedThemeVersion, chainRun, setVideoSource, setPlayerError]);

  return {
    playingTheme, setPlayingTheme,
    selectedThemeVersion, selectVersion,
    videoSource,
    playerError,
    onVideoError,
    retry,
  };
}
