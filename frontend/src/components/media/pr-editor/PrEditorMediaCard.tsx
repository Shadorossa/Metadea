import type { ReactNode } from 'react';
import type { DragHandlers } from '../hooks/useDragReorder';

interface Props {
  externalId: string;
  title?: string | null;
  cover?: string | null;
  isDragging: boolean;
  dragHandlers: DragHandlers;
  onRemove: (externalId: string) => void;
  children?: ReactNode;
}

export function PrEditorMediaCard({
  externalId,
  title,
  cover,
  isDragging,
  dragHandlers,
  onRemove,
  children,
}: Props) {
  return (
    <div
      className={'pr-editor-media-card' + (isDragging ? ' pr-editor-media-card--dragging' : '')}
      {...dragHandlers}
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
    </div>
  );
}
