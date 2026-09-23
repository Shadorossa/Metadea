import { useCallback, useEffect, useRef, useState } from 'react';
import { openEpub, getEpubChapter, type EpubBook, type EpubChapterContent } from '../../../lib/tauri/epub-reader';
import { getReadingProgress } from '../../../lib/tauri/comic-reader';
import { resumePositionFrom } from '../../../lib/reader/epub-pagination';
import { formatAppError } from '../../../lib/errors/format-error';
import { getT } from '../../../i18n/runtime';

export type LoadState = 'loading' | 'ready' | 'error';

/** Where to land inside a chapter once it is laid out. */
export interface ChapterTarget {
  fraction?: number;
  fragment?: string | null;
}

const CHAPTER_CACHE_LIMIT = 8;

// Opens the book, resumes the saved position and serves chapter contents
// (cached per book) to EpubReaderView. Navigation state (which chapter,
// where inside it to land) lives here; the layout hook consumes `target`.
export function useEpubBook(filePath: string, externalId: string, episodeNumber: number) {
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [errorMsg, setErrorMsg] = useState('');
  const [book, setBook] = useState<EpubBook | null>(null);
  const [chapterIndex, setChapterIndex] = useState(0);
  const [chapter, setChapter] = useState<EpubChapterContent | null>(null);
  const [chapterLoading, setChapterLoading] = useState(false);
  const [target, setTarget] = useState<ChapterTarget>({ fraction: 0 });
  const cacheRef = useRef<Map<number, EpubChapterContent>>(new Map());
  const requestRef = useRef(0);

  const loadChapter = useCallback(async (bookId: string, index: number): Promise<EpubChapterContent> => {
    const cached = cacheRef.current.get(index);
    if (cached) return cached;
    const content = await getEpubChapter(bookId, index);
    const cache = cacheRef.current;
    cache.set(index, content);
    if (cache.size > CHAPTER_CACHE_LIMIT) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
    return content;
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoadState('loading');
    setErrorMsg('');
    setBook(null);
    setChapter(null);
    cacheRef.current = new Map();

    (async () => {
      try {
        const opened = await openEpub(filePath);
        if (cancelled) return;
        if (!opened || opened.chapters.length === 0) {
          setErrorMsg(getT().reader.archive_no_pages);
          setLoadState('error');
          return;
        }
        const progress = await getReadingProgress(externalId, episodeNumber).catch(() => null);
        if (cancelled) return;
        const resume = resumePositionFrom(progress, opened.chapters.length);
        const content = await loadChapter(opened.book_id, resume.chapterIndex);
        if (cancelled) return;
        setBook(opened);
        setChapterIndex(resume.chapterIndex);
        setTarget({ fraction: resume.fraction });
        setChapter(content);
        setLoadState('ready');
      } catch (err) {
        if (cancelled) return;
        setErrorMsg(formatAppError(err, getT()));
        setLoadState('error');
      }
    })();

    return () => { cancelled = true; };
  }, [filePath, externalId, episodeNumber, loadChapter]);

  const openChapter = useCallback((index: number, nextTarget: ChapterTarget = { fraction: 0 }) => {
    if (!book) return;
    const clamped = Math.min(book.chapters.length - 1, Math.max(0, index));
    const request = ++requestRef.current;
    setChapterLoading(true);
    loadChapter(book.book_id, clamped)
      .then(content => {
        if (request !== requestRef.current) return;
        setChapterIndex(clamped);
        setTarget(nextTarget);
        setChapter(content);
        setChapterLoading(false);
      })
      .catch(err => {
        if (request !== requestRef.current) return;
        setChapterLoading(false);
        setErrorMsg(formatAppError(err, getT()));
        setLoadState('error');
      });
  }, [book, loadChapter]);

  // Warm the next chapter so a page turn across the boundary is instant.
  useEffect(() => {
    if (!book || loadState !== 'ready') return;
    const next = chapterIndex + 1;
    if (next < book.chapters.length && !cacheRef.current.has(next)) {
      loadChapter(book.book_id, next).catch(() => {});
    }
  }, [book, chapterIndex, loadState, loadChapter]);

  return { loadState, errorMsg, book, chapterIndex, chapter, chapterLoading, target, openChapter };
}
