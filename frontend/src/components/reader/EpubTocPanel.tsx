import type { EpubBookmark, EpubTocEntry } from '../../lib/tauri/epub-reader';
import { formatPercent } from '../../lib/reader/epub-pagination';
import { IconX, IconTrash } from '../local/ui/icons';
import { getT } from '../../i18n/runtime';

interface Props {
  toc: EpubTocEntry[];
  activeTocIndex: number;
  bookmarks: EpubBookmark[];
  chapterTitle: (index: number) => string;
  onOpenHref: (href: string) => void;
  onOpenBookmark: (bookmark: EpubBookmark) => void;
  onDeleteBookmark: (id: number) => void;
  onClose: () => void;
}

// Table of contents + bookmarks side panel of the EPUB reader.
export function EpubTocPanel({ toc, activeTocIndex, bookmarks, chapterTitle, onOpenHref, onOpenBookmark, onDeleteBookmark, onClose }: Props) {
  const t = getT().reader;
  return (
    <aside className="epub-panel epub-panel--toc" aria-label={t.epub_toc_title}>
      <div className="epub-panel-header">
        <span className="epub-panel-title">{t.epub_toc_title}</span>
        <button type="button" className="comic-reader-header-btn" onClick={onClose} aria-label={t.close_title} title={t.close_title}>
          <IconX />
        </button>
      </div>
      <div className="epub-panel-scroll">
        {toc.length === 0 ? (
          <p className="epub-panel-empty">{t.epub_toc_empty}</p>
        ) : (
          <ul className="epub-toc-list">
            {toc.map((entry, i) => (
              <li key={`${entry.href}-${i}`} style={{ paddingLeft: `${Math.min(entry.depth, 5) * 14}px` }}>
                <button
                  type="button"
                  className={`epub-toc-item${i === activeTocIndex ? ' epub-toc-item--active' : ''}`}
                  aria-current={i === activeTocIndex ? 'true' : undefined}
                  onClick={() => onOpenHref(entry.href)}
                >
                  {entry.title}
                </button>
              </li>
            ))}
          </ul>
        )}

        {bookmarks.length > 0 && (
          <>
            <div className="epub-panel-subtitle">{t.epub_bookmarks_title}</div>
            <ul className="epub-toc-list">
              {bookmarks.map(bm => (
                <li key={bm.id} className="epub-bookmark-row">
                  <button type="button" className="epub-toc-item" onClick={() => onOpenBookmark(bm)}>
                    {t.epub_bookmark_label
                      .replace('{chapter}', bm.label || chapterTitle(bm.chapter_index))
                      .replace('{percent}', formatPercent(bm.chapter_fraction))}
                  </button>
                  <button
                    type="button"
                    className="epub-bookmark-delete"
                    onClick={() => onDeleteBookmark(bm.id)}
                    aria-label={t.epub_bookmark_delete}
                    title={t.epub_bookmark_delete}
                  >
                    <IconTrash size={12} />
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </aside>
  );
}
