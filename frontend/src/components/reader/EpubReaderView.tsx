import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ModalShell } from '../shared/ModalShell';
import { useClosingTransition } from '../shared/hooks/useClosingTransition';
import { useReaderFullscreen, useReaderActiveClass } from './hooks/useReaderFullscreen';
import { useEpubBook } from './hooks/useEpubBook';
import { useEpubLayout } from './hooks/useEpubLayout';
import { EpubTocPanel } from './EpubTocPanel';
import { EpubTypographyPanel } from './EpubTypographyPanel';
import type { ReaderProps } from './reader-props';
import { addEpubBookmark, deleteEpubBookmark, getEpubBookmarks, type EpubBookmark } from '../../lib/tauri/epub-reader';
import { saveEpubReadingProgress } from '../../lib/tauri/comic-reader';
import { openExternalUrl } from '../../lib/tauri/game-launch';
import { markChapterRead } from '../../lib/reader/reading-service';
import { bookPercent, formatPercent, isBookFinished, resolveSpineTarget, tocIndexForChapter } from '../../lib/reader/epub-pagination';
import { loadReaderPreferences, saveReaderPreferences, withFontSizeDelta, type ReaderPreferences } from '../../lib/reader/reader-preferences';
import { setReadingPresence, clearReadingPresence } from '../../lib/local/discord-presence';
import { toMediumCover } from '../../lib/media/small-cover';
import { IconX } from '../local/ui/icons';
import { getT } from '../../i18n/runtime';

const PROGRESS_SAVE_DEBOUNCE_MS = 600;

function localStorageOrNull(): Storage | null {
  try { return window.localStorage; } catch { return null; }
}

// EPUB counterpart of ReaderModal: same shell, header and keyboard
// conventions, but the content is a chapter rendered in a shadow root
// (useEpubLayout) and progress is chapter + fraction instead of a page.
export function EpubReaderView({
  externalId, title, filePath, episodeNumber, totalCount, libraryEntry, isSingleTomo, cover, onClose, onStandBy, onProgressSaved,
}: ReaderProps) {
  const t = getT().reader;
  const { isClosing, close: handleClose } = useClosingTransition(onClose);
  const { isFullscreen, toggleFullscreen, exitFullscreen } = useReaderFullscreen();
  useReaderActiveClass();

  const [prefs, setPrefs] = useState<ReaderPreferences>(() => loadReaderPreferences(localStorageOrNull()));
  const [tocOpen, setTocOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [bookmarks, setBookmarks] = useState<EpubBookmark[]>([]);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const toastTimeoutRef = useRef<number | null>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const markedRef = useRef(false);

  const { loadState, errorMsg, book, chapterIndex, chapter, chapterLoading, target, openChapter } =
    useEpubBook(filePath, externalId, episodeNumber);

  const chapterTitle = useCallback((index: number): string => {
    const info = book?.chapters[index];
    return info?.title || t.epub_chapter_fallback.replace('{n}', String(index + 1));
  }, [book, t]);

  const onBoundary = useCallback((direction: 'prev' | 'next') => {
    if (!book) return;
    if (direction === 'next' && chapterIndex < book.chapters.length - 1) openChapter(chapterIndex + 1, { fraction: 0 });
    if (direction === 'prev' && chapterIndex > 0) openChapter(chapterIndex - 1, { fraction: 1 });
  }, [book, chapterIndex, openChapter]);

  const layoutRef = useRef<ReturnType<typeof useEpubLayout> | null>(null);
  const onInternalLink = useCallback((href: string) => {
    if (href.startsWith('#')) {
      layoutRef.current?.goToFragment(href.slice(1));
      return;
    }
    const spineTarget = book ? resolveSpineTarget(book.chapters, href) : null;
    if (!spineTarget) return;
    if (spineTarget.index === chapterIndex && spineTarget.fragment) layoutRef.current?.goToFragment(spineTarget.fragment);
    else openChapter(spineTarget.index, { fraction: 0, fragment: spineTarget.fragment });
  }, [book, chapterIndex, openChapter]);
  const onExternalLink = useCallback((url: string) => { openExternalUrl(url).catch(err => console.error('Failed to open link', err)); }, []);

  const layout = useEpubLayout({
    hostRef, chapter, chapterKey: `${book?.book_id ?? ''}:${chapterIndex}`, target, prefs, onBoundary, onInternalLink, onExternalLink,
  });
  layoutRef.current = layout;
  const { state: position, next, prev, goStart, goEnd, goToFraction } = layout;

  const chapterBytes = useMemo(() => book?.chapters.map(c => c.bytes) ?? [], [book]);
  const percent = bookPercent(chapterBytes, chapterIndex, position.fraction);
  const percentLabel = t.epub_percent.replace('{percent}', formatPercent(percent));
  const activeTocIndex = book ? tocIndexForChapter(book.toc, book.chapters[chapterIndex]?.href ?? '') : -1;

  const showToast = useCallback((msg: string) => {
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    setToastMsg(msg);
    toastTimeoutRef.current = window.setTimeout(() => setToastMsg(null), 2500);
  }, []);

  const updatePrefs = useCallback((nextPrefs: ReaderPreferences) => {
    setPrefs(nextPrefs);
    saveReaderPreferences(localStorageOrNull(), nextPrefs);
  }, []);

  useEffect(() => {
    if (loadState !== 'ready') return;
    let cancelled = false;
    getEpubBookmarks(externalId, episodeNumber).then(list => { if (!cancelled) setBookmarks(list); }).catch(() => {});
    return () => { cancelled = true; };
  }, [loadState, externalId, episodeNumber]);

  // Position → reading_progress (debounced) and, past the threshold, the
  // library's "read" mark — one whole EPUB counts as one volume/issue.
  useEffect(() => {
    if (loadState !== 'ready' || !book) return;
    const timer = window.setTimeout(() => {
      saveEpubReadingProgress(externalId, episodeNumber, {
        chapterIndex, chapterFraction: position.fraction, percent, totalChapters: book.chapters.length,
      }).catch(err => console.error('Failed to save reading progress', err));
    }, PROGRESS_SAVE_DEBOUNCE_MS);
    if (isBookFinished(percent) && !markedRef.current) {
      markedRef.current = true;
      const finishNumber = isSingleTomo && totalCount ? totalCount : episodeNumber;
      markChapterRead(externalId, libraryEntry, finishNumber, totalCount, episodeNumber)
        .then(onProgressSaved)
        .catch(err => console.error('Failed to mark book read', err));
    }
    return () => window.clearTimeout(timer);
  }, [loadState, book, chapterIndex, position.fraction, percent, externalId, episodeNumber, isSingleTomo, totalCount, libraryEntry, onProgressSaved]);

  const readingStartRef = useRef(Math.floor(Date.now() / 1000));
  useEffect(() => {
    if (loadState !== 'ready') return;
    const coverUrl = cover && cover.startsWith('http') ? toMediumCover(cover) : undefined;
    const timer = setTimeout(() => setReadingPresence({ title, pageLabel: percentLabel, coverUrl, startTime: readingStartRef.current }), 800);
    return () => clearTimeout(timer);
  }, [loadState, percentLabel, title, cover]);
  useEffect(() => () => { clearReadingPresence(); }, []);

  const handleAddBookmark = async () => {
    try {
      const label = chapterTitle(chapterIndex);
      const id = await addEpubBookmark(externalId, episodeNumber, chapterIndex, position.fraction, label);
      setBookmarks(prev => [...prev, { id, chapter_index: chapterIndex, chapter_fraction: position.fraction, label }]
        .sort((a, b) => a.chapter_index - b.chapter_index || a.chapter_fraction - b.chapter_fraction));
      showToast(t.epub_bookmark_added);
    } catch {
      showToast(t.bookmark_error);
    }
  };
  const handleDeleteBookmark = async (id: number) => {
    try {
      await deleteEpubBookmark(id);
      setBookmarks(prev => prev.filter(b => b.id !== id));
    } catch {
      showToast(t.bookmark_error);
    }
  };
  const openBookmark = (bm: EpubBookmark) => {
    if (bm.chapter_index === chapterIndex) goToFraction(bm.chapter_fraction);
    else openChapter(bm.chapter_index, { fraction: bm.chapter_fraction });
  };

  useEffect(() => {
    const onKey = async (e: KeyboardEvent) => {
      const editing = e.target instanceof HTMLElement && ['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName);
      if (e.key === 'Escape') {
        if (settingsOpen || tocOpen) { setSettingsOpen(false); setTocOpen(false); return; }
        if (await exitFullscreen()) return;
        handleClose();
        return;
      }
      if (editing) return;
      if (e.key === 'F11') { e.preventDefault(); toggleFullscreen(); return; }
      if (loadState !== 'ready') return;
      if (e.ctrlKey && e.key === 'ArrowRight') { e.preventDefault(); onBoundary('next'); return; }
      if (e.ctrlKey && e.key === 'ArrowLeft') { e.preventDefault(); onBoundary('prev'); return; }
      if (e.key === 'ArrowRight' || e.key === 'PageDown' || (e.key === ' ' && !e.shiftKey)) { e.preventDefault(); next(); return; }
      if (e.key === 'ArrowLeft' || e.key === 'PageUp' || (e.key === ' ' && e.shiftKey)) { e.preventDefault(); prev(); return; }
      if (e.key === 'Home') { e.preventDefault(); goStart(); return; }
      if (e.key === 'End') { e.preventDefault(); goEnd(); return; }
      if (e.key === '+' || e.key === '=') { e.preventDefault(); updatePrefs(withFontSizeDelta(prefs, 1)); return; }
      if (e.key === '-' || e.key === '_') { e.preventDefault(); updatePrefs(withFontSizeDelta(prefs, -1)); return; }
      if (e.key === 't' || e.key === 'T') { e.preventDefault(); setTocOpen(open => !open); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [settingsOpen, tocOpen, exitFullscreen, handleClose, toggleFullscreen, loadState, onBoundary, next, prev, goStart, goEnd, prefs, updatePrefs]);

  const handleStandBy = () => {
    onStandBy?.(chapterIndex, book?.chapters.length ?? 1, book?.chapters.length ?? 1);
    handleClose();
  };

  return (
    <ModalShell
      overlay={false}
      onClose={handleClose}
      label={title}
      panelClassName={`comic-reader-overlay epub-reader-overlay epub-theme-${prefs.theme}${isClosing ? ' comic-reader-overlay--closing' : ''}${isFullscreen ? ' comic-reader-overlay--fullscreen' : ''}`}
      closeOnEscape={false}
      closeOnBackdrop={false}
      stopPanelPropagation={false}
    >
      <div className="comic-reader-header">
        <span className="comic-reader-title" title={title}>
          {title}
          {loadState === 'ready' && <span className="epub-reader-chapter"> · {chapterTitle(chapterIndex)}</span>}
        </span>
        {loadState === 'ready' && <span className="comic-reader-page-count">{percentLabel}</span>}
        {loadState === 'ready' && (
          <>
            <button type="button" className="comic-reader-header-btn" onClick={handleAddBookmark} title={t.epub_bookmark_add} aria-label={t.epub_bookmark_add}>
              <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
            </button>
            <button type="button" className={`comic-reader-header-btn${tocOpen ? ' is-active' : ''}`} onClick={() => { setTocOpen(o => !o); setSettingsOpen(false); }} title={t.epub_toc_toggle} aria-label={t.epub_toc_toggle} aria-pressed={tocOpen}>
              <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
            </button>
            <button type="button" className={`comic-reader-header-btn${settingsOpen ? ' is-active' : ''}`} onClick={() => { setSettingsOpen(o => !o); setTocOpen(false); }} title={t.epub_settings_toggle} aria-label={t.epub_settings_toggle} aria-pressed={settingsOpen}>
              <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
            </button>
          </>
        )}
        {onStandBy && (
          <button type="button" className="comic-reader-header-btn" onClick={handleStandBy} title={t.standby_title} aria-label={t.standby_aria}>
            <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>
          </button>
        )}
        <button type="button" className="comic-reader-header-btn" onClick={toggleFullscreen} title={isFullscreen ? t.fullscreen_exit_title : t.fullscreen_title} aria-label={isFullscreen ? t.fullscreen_exit_aria : t.fullscreen_aria}>
          {isFullscreen ? (
            <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M8 3v3a2 2 0 0 1-2 2H3M21 8h-3a2 2 0 0 1-2-2V3M3 16h3a2 2 0 0 1 2 2v3M16 21v-3a2 2 0 0 1 2-2h3"/></svg>
          ) : (
            <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3"/></svg>
          )}
        </button>
        <button type="button" className="comic-reader-close" onClick={handleClose} title={t.close_title}>
          <IconX />
        </button>
      </div>

      <div className="comic-reader-body epub-reader-body">
        {tocOpen && book && (
          <EpubTocPanel
            toc={book.toc}
            activeTocIndex={activeTocIndex}
            bookmarks={bookmarks}
            chapterTitle={chapterTitle}
            onOpenHref={onInternalLink}
            onOpenBookmark={openBookmark}
            onDeleteBookmark={handleDeleteBookmark}
            onClose={() => setTocOpen(false)}
          />
        )}

        <div className="epub-reader-stage">
          <div ref={hostRef} className="epub-reader-host" />
          {loadState === 'loading' && (
            <div className="comic-reader-state epub-reader-state"><div className="spinner" /><p>{t.epub_loading}</p></div>
          )}
          {loadState === 'ready' && chapterLoading && (
            <div className="epub-reader-chapter-loading">{t.epub_chapter_loading}</div>
          )}
          {loadState === 'error' && (
            <div className="comic-reader-state comic-reader-state--error epub-reader-state">
              <p>{t.open_error}</p>
              <p className="comic-reader-error-detail">{errorMsg}</p>
            </div>
          )}
          {loadState === 'ready' && prefs.flow === 'paginated' && (
            <>
              <button type="button" className="comic-reader-nav comic-reader-nav--prev" onClick={prev} disabled={chapterIndex === 0 && position.page === 0} aria-label={t.prev_page_aria}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
              </button>
              <button type="button" className="comic-reader-nav comic-reader-nav--next" onClick={next} disabled={!!book && chapterIndex === book.chapters.length - 1 && position.page === position.pageCount - 1} aria-label={t.next_page_aria}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
              </button>
            </>
          )}
        </div>

        {settingsOpen && <EpubTypographyPanel prefs={prefs} onChange={updatePrefs} onClose={() => setSettingsOpen(false)} />}
      </div>

      {loadState === 'ready' && (
        <div className="comic-reader-progress-bar">
          <div className="comic-reader-progress-fill" style={{ width: `${percent * 100}%` }} />
        </div>
      )}

      {toastMsg && (
        <div className="comic-reader-toast">
          <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><polyline points="20 6 9 17 4 12" /></svg>
          <span>{toastMsg}</span>
        </div>
      )}
    </ModalShell>
  );
}
