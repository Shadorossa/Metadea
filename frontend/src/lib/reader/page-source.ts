// Where the image reader (ReaderModal's ComicReaderModal) gets its pages.
// A source lists opaque page tokens; when it has `resolvePage`, each token
// is turned into a displayable URL on demand (and preloaded around the
// current spread), otherwise the token is a local file path shown through
// the asset protocol. Local archives and folders use archivePageSource;
// plugin sources (lib/plugins/plugin-page-source.ts) resolve remote pages.
import { extractComicArchive } from '../tauri/comic-reader';

export interface ReaderPageSource {
  /** Changes when the pages change (the reader reloads on a new key). */
  key: string;
  listPages(): Promise<string[]>;
  /** data:/asset URL for a token; absent = the token is a file path. */
  resolvePage?(token: string): Promise<string>;
}

export function archivePageSource(filePath: string): ReaderPageSource {
  return {
    key: `file:${filePath}`,
    listPages: () => extractComicArchive(filePath).then(res => res.pages),
  };
}
