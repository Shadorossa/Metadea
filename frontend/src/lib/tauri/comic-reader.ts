import { tauriCmd, tauriRun } from './core';

export interface ComicPages {
  pages: string[];
  cache_dir: string;
}

// Extracts (or reuses the already-extracted cache of) a comic/manga archive
// into a sorted list of page image paths — see comic_reader.rs. CBR only for
// now; other formats (CBZ, PDF, EPUB) reject with an error until their own
// extraction path is added there.
export async function extractComicArchive(path: string): Promise<ComicPages> {
  return tauriCmd<ComicPages>('extract_comic_archive', { pages: [], cache_dir: '' }, { path });
}

export async function readComicBinaryFile(path: string): Promise<Uint8Array> {
  const bytes = await tauriCmd<Uint8Array | number[]>('read_comic_binary_file', [], { path });
  return bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
}

export async function getReadingProgress(externalId: string, episodeNumber: number): Promise<{ pageNumber: number; totalPages: number | null } | null> {
  const res = await tauriCmd<{ page_number: number; total_pages: number | null } | null>('get_reading_progress', null, { externalId, episodeNumber });
  return res ? { pageNumber: res.page_number, totalPages: res.total_pages } : null;
}

export async function saveReadingProgress(externalId: string, episodeNumber: number, pageNumber: number, totalPages?: number): Promise<void> {
  return tauriRun('save_reading_progress', { externalId, episodeNumber, pageNumber, totalPages: totalPages ?? null });
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

