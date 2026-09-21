import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { IconExternalLink, IconPencil, IconTrash } from '../local/ui/icons';

interface Props {
  id: string;
  title: string;
  cover: string | null | undefined;
  editLabel: string;
  deleteLabel: string;
  openMediaLabel: string;
  onEdit: () => void;
  onDelete: () => void;
  mediaPageUrl?: string;
  editDisabled?: boolean;
  blocked?: boolean;
}

// Shared card shape for catalog entries. The cover opens the editor on click;
// its context menu contains edit, navigation, and delete actions.
export function CatalogEntryCard({
  id, title, cover, editLabel, deleteLabel, openMediaLabel, onEdit, onDelete,
  mediaPageUrl, editDisabled, blocked,
}: Props) {
  const [menuPosition, setMenuPosition] = useState<{ x: number; y: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuPosition) return;

    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuPosition(null);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuPosition(null);
    };
    const close = () => setMenuPosition(null);

    window.addEventListener('pointerdown', closeOnOutsidePointer);
    window.addEventListener('keydown', closeOnEscape);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);
    return () => {
      window.removeEventListener('pointerdown', closeOnOutsidePointer);
      window.removeEventListener('keydown', closeOnEscape);
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [menuPosition]);

  const showMenuAt = (x: number, y: number) => {
    const menuWidth = 210;
    const menuHeight = mediaPageUrl ? 142 : 100;
    setMenuPosition({
      x: Math.max(4, Math.min(x, window.innerWidth - menuWidth - 4)),
      y: Math.max(4, Math.min(y, window.innerHeight - menuHeight - 4)),
    });
  };

  const openContextMenu = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    showMenuAt(event.clientX, event.clientY);
  };

  const menu = menuPosition && typeof document !== 'undefined' ? createPortal(
    <div
      ref={menuRef}
      className="catalog-admin-context-menu"
      role="menu"
      style={{ left: menuPosition.x, top: menuPosition.y }}
      onClick={event => event.stopPropagation()}
    >
      <button
        type="button"
        role="menuitem"
        className="catalog-admin-context-menu-item"
        disabled={editDisabled}
        onClick={() => { setMenuPosition(null); onEdit(); }}
      >
        <IconPencil size={15} />
        <span>{editLabel}</span>
      </button>
      {mediaPageUrl && (
        <a
          role="menuitem"
          className="catalog-admin-context-menu-item"
          href={mediaPageUrl}
          onClick={() => setMenuPosition(null)}
        >
          <IconExternalLink size={15} />
          <span>{openMediaLabel}</span>
        </a>
      )}
      <button
        type="button"
        role="menuitem"
        className="catalog-admin-context-menu-item catalog-admin-context-menu-item--delete"
        onClick={() => { setMenuPosition(null); onDelete(); }}
      >
        <IconTrash size={15} />
        <span>{deleteLabel}</span>
      </button>
    </div>,
    document.body,
  ) : null;

  return (
    <>
    <article className={`catalog-admin-card${blocked ? ' catalog-admin-card--blocked' : ''}`}>
      <button
        type="button"
        className="catalog-admin-card-cover"
        aria-label={`${editLabel}: ${title}`}
        title={editLabel}
        disabled={editDisabled}
        onClick={onEdit}
        onContextMenu={openContextMenu}
        onKeyDown={event => {
          if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
            event.preventDefault();
            const bounds = event.currentTarget.getBoundingClientRect();
            showMenuAt(bounds.left, bounds.bottom);
          }
        }}
      >
        {cover
          ? <img src={cover} alt="" loading="lazy" />
          : <span className="catalog-admin-card-no-cover">-</span>}
      </button>
      <div className="pr-editor-search-result-info">
        <div className="pr-editor-search-result-id">{id}</div>
        <div className="pr-editor-search-result-title">{title}</div>
      </div>
    </article>
    {menu}
    </>
  );
}
