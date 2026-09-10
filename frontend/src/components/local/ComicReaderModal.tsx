import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { extractComicArchive, getReadingProgress, saveReadingProgress, wrapAssetUrl, updateDiscordPresence, resetDiscordPresence, type LibraryEntry } from '../../lib/tauri';
import { markChapterRead } from '../../lib/local/reading-service';
import { useClosingTransition } from '../../lib/shared/useClosingTransition';
import { toSmallCover } from '../../lib/shared/small-cover';
import { IconX } from './ui/icons';

interface Props {
  externalId:    string;
  title:         string;
  filePath:      string;
  episodeNumber: number;
  totalCount:    number | null;
  libraryEntry:  LibraryEntry;
  cover:         string | null;
  // True when this one file/volume actually covers the whole catalog
  // entry (a single-tomo edition of an otherwise multi-issue series) — see
  // LocalMediaDetailPanel's isSingleEpisode. Finishing it then has to mark
  // the *whole* work complete (progress = totalCount), not just this one
  // "episode" number.
  isSingleTomo:  boolean;
  onClose:       () => void;
  onProgressSaved: () => void;
}

type LoadState = 'loading' | 'ready' | 'error';

// Page 0 (the cover) reads alone; every pair after that is a spread —
// (1,2), (3,4), (5,6)... same convention most comic/manga readers use so a
// two-page splash panel doesn't get cut in half across two spreads.
function buildSpreads(pageCount: number): number[][] {
  if (pageCount === 0) return [];
  const spreads: number[][] = [[0]];
  for (let i = 1; i < pageCount; i += 2) {
    spreads.push(i + 1 < pageCount ? [i, i + 1] : [i]);
  }
  return spreads;
}

// Full-screen paginated image viewer for a CBR/CBZ/etc. archive — extraction
// and page listing live in comic_reader.rs (extractComicArchive), this only
// ever deals with the already-resolved list of page image paths.
export function ComicReaderModal({ externalId, title, filePath, episodeNumber, totalCount, libraryEntry, isSingleTomo, cover, onClose, onProgressSaved }: Props) {
  const { isClosing, close: handleClose } = useClosingTransition(onClose);

  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [errorMsg, setErrorMsg] = useState('');
  const [pages, setPages] = useState<string[]>([]);
  const [spreadIndex, setSpreadIndex] = useState(0);
  // Guards markChapterRead against firing more than once per session (the
  // user can sit on the last spread, flip back, and forward again) and
  // against running before the initial resume position (also landing on
  // the last spread for an already-finished reread) has actually been
  // applied.
  const markedRef = useRef(false);
  const resumedRef = useRef(false);

  const spreads = useMemo(() => buildSpreads(pages.length), [pages.length]);
  const currentSpread = spreads[spreadIndex] ?? [];
  const pageLabel = currentSpread.length === 2
    ? `${currentSpread[0] + 1}-${currentSpread[1] + 1} / ${pages.length}`
    : `${(currentSpread[0] ?? 0) + 1} / ${pages.length}`;

  useEffect(() => {
    let cancelled = false;
    setLoadState('loading');
    setErrorMsg('');
    markedRef.current = false;
    resumedRef.current = false;

    extractComicArchive(filePath)
      .then(async res => {
        if (cancelled) return;
        if (!res.pages.length) { setErrorMsg('No se encontraron páginas en el archivo.'); setLoadState('error'); return; }
        setPages(res.pages);

        const progress = await getReadingProgress(externalId, episodeNumber).catch(() => null);
        if (cancelled) return;
        const savedSpreads = buildSpreads(res.pages.length);
        const savedPage0 = progress ? Math.min(Math.max(progress.pageNumber - 1, 0), res.pages.length - 1) : 0;
        const resumeSpread = Math.max(0, savedSpreads.findIndex(s => s.includes(savedPage0)));
        resumedRef.current = true;
        setSpreadIndex(resumeSpread);
        setLoadState('ready');
      })
      .catch(err => {
        if (cancelled) return;
        setErrorMsg(err instanceof Error ? err.message : String(err));
        setLoadState('error');
      });

    return () => { cancelled = true; };
  }, [filePath, externalId, episodeNumber]);

  // Persists on every spread change (not debounced — a page turn is a
  // discrete user action, not a continuous stream like video seconds, so
  // there's nothing to coalesce) and auto-marks the chapter read the first
  // time the last spread is actually reached, same "finishing" rule
  // markEpisodeWatched uses for video. A single-tomo edition completes the
  // *whole* catalog entry (progress = totalCount) instead of just this one
  // file's own episode number, since reading it through means the whole
  // work is done, not just "episode 1" of it.
  useEffect(() => {
    if (loadState !== 'ready' || !resumedRef.current || currentSpread.length === 0) return;
    saveReadingProgress(externalId, episodeNumber, currentSpread[0] + 1, pages.length).catch(() => {});

    if (currentSpread.includes(pages.length - 1) && !markedRef.current) {
      markedRef.current = true;
      const finishNumber = isSingleTomo && totalCount ? totalCount : episodeNumber;
      markChapterRead(externalId, libraryEntry, finishNumber, totalCount, episodeNumber)
        .then(onProgressSaved)
        .catch(err => console.error('Failed to mark chapter read', err));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spreadIndex, loadState, pages.length]);

  const goPrev = useCallback(() => setSpreadIndex(i => Math.max(0, i - 1)), []);
  const goNext = useCallback(() => setSpreadIndex(i => Math.min(spreads.length - 1, i + 1)), [spreads.length]);

  // The flicker on page turn was the browser reading+decoding each page
  // fresh off disk the moment it became visible — however fast that is,
  // it's still a blank frame between the old <img> unmounting (a new page
  // index is a new React key, so it's a fresh element, not a src swap on
  // the same one) and the new one finishing its first paint. Warms the
  // browser's own image cache for a small window around the current spread
  // ahead of time so that by the time the user actually turns to one of
  // these, the <img> just paints an already-decoded bitmap instantly
  // instead of decoding on demand.
  const preloadedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (loadState !== 'ready') return;
    for (let si = spreadIndex - 1; si <= spreadIndex + 2; si++) {
      const spread = spreads[si];
      if (!spread) continue;
      for (const pageIdx of spread) {
        const url = wrapAssetUrl(pages[pageIdx]);
        if (preloadedRef.current.has(url)) continue;
        preloadedRef.current.add(url);
        const img = new Image();
        img.src = url;
      }
    }
  }, [spreadIndex, loadState, spreads, pages]);

  // Same idea as playback-service.ts's own updateDiscordForTick for
  // watching — "Reading {title}" / "Page X of Y" instead of "Watching
  // {title} - Episode N" / a video time range. No start/end timestamps
  // (no progress bar): those are what Discord uses to render a countdown,
  // which only makes sense for something with an actual continuous
  // position like video playback, not a page-turner.
  useEffect(() => {
    if (loadState !== 'ready') return;
    const coverUrl = cover && cover.startsWith('http') ? toSmallCover(cover) : undefined;
    updateDiscordPresence(`Reading ${title}`, `Page ${pageLabel}`, undefined, undefined, coverUrl, title, 'metadea', 'Metadea').catch(() => {});
  }, [loadState, pageLabel, title, cover]);

  useEffect(() => {
    return () => { resetDiscordPresence().catch(() => {}); };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { handleClose(); return; }
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === ' ') { e.preventDefault(); goNext(); return; }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); goPrev(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [goNext, goPrev, handleClose]);

  const handleImageClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    if (clickX < rect.width * 0.45) goPrev();
    else if (clickX > rect.width * 0.55) goNext();
  };

  return createPortal(
    <div className={`comic-reader-overlay${isClosing ? ' comic-reader-overlay--closing' : ''}`}>
      <div className="comic-reader-header">
        <span className="comic-reader-title" title={title}>{title}</span>
        {loadState === 'ready' && (
          <span className="comic-reader-page-count">{pageLabel}</span>
        )}
        <button type="button" className="comic-reader-close" onClick={handleClose} title="Cerrar (Esc)">
          <IconX />
        </button>
      </div>

      <div className="comic-reader-body">
        {loadState === 'loading' && (
          <div className="comic-reader-state">
            <div className="spinner" />
            <p>Extrayendo páginas…</p>
          </div>
        )}

        {loadState === 'error' && (
          <div className="comic-reader-state comic-reader-state--error">
            <p>No se pudo abrir el archivo.</p>
            <p className="comic-reader-error-detail">{errorMsg}</p>
          </div>
        )}

        {loadState === 'ready' && (
          <div className="comic-reader-page-wrap" onClick={handleImageClick}>
            <div className={`comic-reader-spread${currentSpread.length === 2 ? ' comic-reader-spread--double' : ''}`}>
              {currentSpread.map(idx => (
                <img
                  key={idx}
                  className="comic-reader-page"
                  src={wrapAssetUrl(pages[idx])}
                  alt={`Página ${idx + 1}`}
                  draggable={false}
                />
              ))}
            </div>
            <button
              type="button"
              className="comic-reader-nav comic-reader-nav--prev"
              onClick={e => { e.stopPropagation(); goPrev(); }}
              disabled={spreadIndex === 0}
              aria-label="Página anterior"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>
            <button
              type="button"
              className="comic-reader-nav comic-reader-nav--next"
              onClick={e => { e.stopPropagation(); goNext(); }}
              disabled={spreadIndex === spreads.length - 1}
              aria-label="Página siguiente"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
          </div>
        )}
      </div>

      {loadState === 'ready' && spreads.length > 1 && (
        <div className="comic-reader-progress-bar">
          <div className="comic-reader-progress-fill" style={{ width: `${(((currentSpread[currentSpread.length - 1] ?? 0) + 1) / pages.length) * 100}%` }} />
        </div>
      )}
    </div>,
    document.body,
  );
}
