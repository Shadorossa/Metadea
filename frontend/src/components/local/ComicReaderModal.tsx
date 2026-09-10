import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { extractComicArchive, getReadingProgress, saveReadingProgress, wrapAssetUrl, type LibraryEntry } from '../../lib/tauri';
import { markChapterRead } from '../../lib/local/reading-service';
import { useClosingTransition } from '../../lib/shared/useClosingTransition';
import { IconX } from './ui/icons';

interface Props {
  externalId:    string;
  title:         string;
  filePath:      string;
  episodeNumber: number;
  totalCount:    number | null;
  libraryEntry:  LibraryEntry;
  onClose:       () => void;
  onProgressSaved: () => void;
}

type LoadState = 'loading' | 'ready' | 'error';

// Full-screen paginated image viewer for a CBR/CBZ/etc. archive — extraction
// and page listing live in comic_reader.rs (extractComicArchive), this only
// ever deals with the already-resolved list of page image paths.
export function ComicReaderModal({ externalId, title, filePath, episodeNumber, totalCount, libraryEntry, onClose, onProgressSaved }: Props) {
  const { isClosing, close: handleClose } = useClosingTransition(onClose);

  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [errorMsg, setErrorMsg] = useState('');
  const [pages, setPages] = useState<string[]>([]);
  const [pageIndex, setPageIndex] = useState(0);
  // Guards markChapterRead against firing more than once per session (the
  // user can sit on the last page, flip back, and forward again) and against
  // running before the initial resume position (also landing on the last
  // page for an already-finished reread) has actually been applied.
  const markedRef = useRef(false);
  const resumedRef = useRef(false);

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
        const resumeIndex = progress ? Math.min(Math.max(progress.pageNumber - 1, 0), res.pages.length - 1) : 0;
        resumedRef.current = true;
        setPageIndex(resumeIndex);
        setLoadState('ready');
      })
      .catch(err => {
        if (cancelled) return;
        setErrorMsg(err instanceof Error ? err.message : String(err));
        setLoadState('error');
      });

    return () => { cancelled = true; };
  }, [filePath, externalId, episodeNumber]);

  // Persists on every page change (not debounced — a page turn is a
  // discrete user action, not a continuous stream like video seconds, so
  // there's nothing to coalesce) and auto-marks the chapter read the first
  // time the last page is actually reached, same "finishing" rule
  // markEpisodeWatched uses for video.
  useEffect(() => {
    if (loadState !== 'ready' || !resumedRef.current || pages.length === 0) return;
    saveReadingProgress(externalId, episodeNumber, pageIndex + 1, pages.length).catch(() => {});

    if (pageIndex === pages.length - 1 && !markedRef.current) {
      markedRef.current = true;
      markChapterRead(externalId, libraryEntry, episodeNumber, totalCount)
        .then(onProgressSaved)
        .catch(err => console.error('Failed to mark chapter read', err));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageIndex, loadState, pages.length]);

  const goPrev = useCallback(() => setPageIndex(i => Math.max(0, i - 1)), []);
  const goNext = useCallback(() => setPageIndex(i => Math.min(pages.length - 1, i + 1)), [pages.length]);

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
          <span className="comic-reader-page-count">{pageIndex + 1} / {pages.length}</span>
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
            <img
              className="comic-reader-page"
              src={wrapAssetUrl(pages[pageIndex])}
              alt={`Página ${pageIndex + 1}`}
              draggable={false}
            />
            <button
              type="button"
              className="comic-reader-nav comic-reader-nav--prev"
              onClick={e => { e.stopPropagation(); goPrev(); }}
              disabled={pageIndex === 0}
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
              disabled={pageIndex === pages.length - 1}
              aria-label="Página siguiente"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
          </div>
        )}
      </div>

      {loadState === 'ready' && pages.length > 1 && (
        <div className="comic-reader-progress-bar">
          <div className="comic-reader-progress-fill" style={{ width: `${((pageIndex + 1) / pages.length) * 100}%` }} />
        </div>
      )}
    </div>,
    document.body,
  );
}
