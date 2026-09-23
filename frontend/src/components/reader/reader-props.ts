import type { LibraryEntry } from '../../lib/tauri';

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
}

export function isEpubPath(filePath: string): boolean {
  return filePath.toLowerCase().endsWith('.epub');
}
