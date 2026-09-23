import type { LibraryEntry, CatalogEntryLike } from '../tauri';

export interface LocalMediaItem {
  externalId:   string;
  title:        string;
  titleRomaji:  string | null;
  titleNative:  string | null;
  cover:        string | null;
  status:       string;
  progress:     number;
  libraryEntry: LibraryEntry;
  // A full media_catalog row on the Local page (its detail panels read
  // banners_csv/shop_links_csv/synopsis), the profile's CatalogSummary
  // projection when built by library-playability.ts — every reader treats
  // the columns outside the summary as optional.
  catalogEntry: CatalogEntryLike | undefined;
}
