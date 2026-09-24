import type { LibraryEntry } from '../../lib/tauri';
import type { ReaderPageSource } from '../../lib/reader/page-source';

// Shared props of the reader surfaces (ReaderModal for images/CBZ/CBR/PDF,
// EpubReaderView for EPUB) — a leaf module so neither imports the other
// for a type.
export interface ReaderProps {
  externalId:    string;
  title:         string;
  filePath:      string;
  episodeNumber: number;
  totalCount:    number | null;
  libraryEntry:  LibraryEntry;
  cover:         string | null;
  isSingleTomo:  boolean;
  onClose:       () => void;
  /** (current spread/chapter, total spreads/chapters, page/chapter count) */
  onStandBy?:    (spreadIndex: number, totalSpreads: number, pageCount: number) => void;
  onProgressSaved: () => void;
  /** Where the pages come from; defaults to the archive/folder at filePath
   *  (a plugin chapter passes its own, and a synthetic filePath). */
  pageSource?: ReaderPageSource;
  /** 'chapters': episodeNumber is a chapter number written to library
   *  progress (plugin sources) instead of the file-based default. */
  progressUnit?: 'chapters';
}

export function isEpubPath(filePath: string): boolean {
  return filePath.toLowerCase().endsWith('.epub');
}
