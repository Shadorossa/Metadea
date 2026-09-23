import { tauriCmd, tauriRun } from './bridge';

export interface ComicPages {
  pages: string[];
  cache_dir: string;
}

// Extracts (or reuses the already-extracted cache of) a comic/manga archive
// into a sorted list of page image paths — see comic_reader.rs. CBR/CBZ;
// EPUB has its own path (epub-reader.ts) and PDF is read client-side.
export async function extractComicArchive(path: string): Promise<ComicPages> {
  return tauriCmd<ComicPages>('extract_comic_archive', { pages: [], cache_dir: '' }, { path });
}

export async function readComicBinaryFile(path: string): Promise<Uint8Array> {
  const res = await tauriCmd<ArrayBuffer | Uint8Array | number[]>('read_comic_binary_file', new Uint8Array(), { path });
  if (res instanceof Uint8Array) return res;
  if (res instanceof ArrayBuffer) return new Uint8Array(res);
  return new Uint8Array(res as any);
}

// One row per (work, file). Comics fill pageNumber/totalPages; EPUBs fill
// chapterIndex/chapterFraction/percent as well (and mirror chapterIndex + 1
// into pageNumber). A row saved by the comic reader has the EPUB fields null.
export interface ReadingProgressRow {
  pageNumber: number;
  totalPages: number | null;
  chapterIndex: number | null;
  chapterFraction: number | null;
  percent: number | null;
}

interface ReadingProgressWire {
  page_number: number;
  total_pages: number | null;
  chapter_index: number | null;
  chapter_fraction: number | null;
  percent: number | null;
}

export async function getReadingProgress(externalId: string, episodeNumber: number): Promise<ReadingProgressRow | null> {
  const res = await tauriCmd<ReadingProgressWire | null>('get_reading_progress', null, { externalId, episodeNumber });
  return res
    ? {
        pageNumber: res.page_number,
        totalPages: res.total_pages,
        chapterIndex: res.chapter_index ?? null,
        chapterFraction: res.chapter_fraction ?? null,
        percent: res.percent ?? null,
      }
    : null;
}

export async function saveReadingProgress(externalId: string, episodeNumber: number, pageNumber: number, totalPages?: number): Promise<void> {
  return tauriRun('save_reading_progress', { externalId, episodeNumber, pageNumber, totalPages: totalPages ?? null });
}

export interface EpubProgressPosition {
  chapterIndex: number;
  chapterFraction: number;
  percent: number;
  totalChapters: number;
}

export async function saveEpubReadingProgress(externalId: string, episodeNumber: number, pos: EpubProgressPosition): Promise<void> {
  return tauriRun('save_reading_progress', {
    externalId,
    episodeNumber,
    pageNumber: pos.chapterIndex + 1,
    totalPages: pos.totalChapters,
    chapterIndex: pos.chapterIndex,
    chapterFraction: pos.chapterFraction,
    percent: pos.percent,
  });
}

export async function clearReadingProgress(externalId: string, episodeNumber: number): Promise<void> {
  return tauriRun('clear_reading_progress', { externalId, episodeNumber });
}

export async function getComicBookmarks(externalId: string, episodeNumber: number): Promise<number[]> {
  return tauriCmd<number[]>('get_comic_bookmarks', [], { externalId, episodeNumber });
}

export async function toggleComicBookmark(externalId: string, episodeNumber: number, pageNumber: number): Promise<boolean> {
  return tauriCmd<boolean>('toggle_comic_bookmark', false, { externalId, episodeNumber, pageNumber });
}

export async function saveComicPageAsPng(sourcePagePath: string, title: string, pageNumber: number): Promise<string> {
  return tauriCmd<string>('save_comic_page_as_png', '', { sourcePagePath, title, pageNumber });
}
