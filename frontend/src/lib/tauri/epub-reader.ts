import { tauriCmd, tauriRun } from './bridge';

// IPC surface of src-tauri/src/epub_reader: the book is extracted once
// into the comic cache dir and parsed into this manifest; chapters come
// back already sanitised (see the module's URL contract) so the reader
// only has to turn `data-epub-src` paths into asset URLs.

export interface EpubChapterInfo {
  index: number;
  href: string;
  title: string | null;
  bytes: number;
}

export interface EpubTocEntry {
  title: string;
  href: string;
  depth: number;
}

export interface EpubBook {
  book_id: string;
  title: string;
  author: string | null;
  language: string | null;
  chapters: EpubChapterInfo[];
  toc: EpubTocEntry[];
  cover_path: string | null;
}

export interface EpubChapterContent {
  html: string;
  css: string[];
}

export interface EpubBookmark {
  id: number;
  chapter_index: number;
  chapter_fraction: number;
  label: string | null;
}

export async function openEpub(path: string): Promise<EpubBook | null> {
  return tauriCmd<EpubBook | null>('epub_open', null, { path });
}

export async function getEpubChapter(bookId: string, index: number): Promise<EpubChapterContent> {
  return tauriCmd<EpubChapterContent>('epub_chapter', { html: '', css: [] }, { bookId, index });
}

export async function getEpubBookmarks(externalId: string, episodeNumber: number): Promise<EpubBookmark[]> {
  return tauriCmd<EpubBookmark[]>('get_epub_bookmarks', [], { externalId, episodeNumber });
}

export async function addEpubBookmark(
  externalId: string,
  episodeNumber: number,
  chapterIndex: number,
  chapterFraction: number,
  label: string | null,
): Promise<number> {
  return tauriCmd<number>('add_epub_bookmark', -1, { externalId, episodeNumber, chapterIndex, chapterFraction, label });
}

export async function deleteEpubBookmark(id: number): Promise<void> {
  return tauriRun('delete_epub_bookmark', { id });
}
