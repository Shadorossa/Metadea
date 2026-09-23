import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { SortableHandleProps } from '../../shared/SortableList';
import { getT } from '../../../i18n/runtime';

interface Props {
  externalId: string;
  title?: string | null;
  cover?: string | null;
  isDragging: boolean;
  // The props SortableItem hands out (ref, aria attributes, pointer/keyboard
  // listeners, transform style), spread on the card root.
  handleProps: SortableHandleProps;
  onRemove: (externalId: string) => void;
  onEditWork?: (externalId: string) => void;
  children?: ReactNode;
}

export function PrEditorMediaCard({
  externalId,
  title,
  cover,
  isDragging,
  handleProps,
  onRemove,
  onEditWork,
  children,
}: Props) {
  const pe = getT().pr_editor;
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') close(); };
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [contextMenu]);

  return (
    <div
      className={'pr-editor-media-card' + (isDragging ? ' pr-editor-media-card--dragging' : '')}
      onContextMenu={event => {
        if (!onEditWork) return;
        event.preventDefault();
        event.stopPropagation();
        setContextMenu({ x: event.clientX, y: event.clientY });
      }}
      {...handleProps}
    >
      <div className="pr-editor-media-card-cover">
        {cover
          ? <img className="cover-image-fill" src={cover} alt="" draggable={false} />
          : <div className="pr-editor-media-card-placeholder" />}
        <button
          type="button"
          className="pr-editor-media-card-remove"
          onClick={() => onRemove(externalId)}
        >
          x
        </button>
      </div>
      {children}
      <div className="pr-editor-media-card-title" title={title || externalId}>
        {title || externalId}
      </div>
      {contextMenu && onEditWork && createPortal(
        <div
          className="pr-editor-saga-context-menu"
          role="menu"
          style={{ left: Math.min(contextMenu.x, window.innerWidth - 210), top: Math.min(contextMenu.y, window.innerHeight - 60) }}
          onPointerDown={event => event.stopPropagation()}
        >
          <button type="button" role="menuitem" onClick={() => { onEditWork(externalId); setContextMenu(null); }}>
            {pe.edit_work}
          </button>
        </div>,
        document.body,
      )}
    </div>
  );
}
