import { memo, type KeyboardEvent, type MouseEvent } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { CoverImage } from '../shared/CoverImage';
import { toMediumCover, toSmallCover } from '../../lib/media/small-cover';
import { wrapAssetUrl } from '../../lib/tauri/bridge';
import type { TierItemMeta } from '../../lib/tier/tier-board';
import type { ThumbSize } from '../../lib/tier/tier-settings';

// One cover on the board. Sortable (dnd-kit) for pointer, touch and
// keyboard; click selects, Ctrl/Shift+click extends the selection,
// double-click sends it back to the item bank. The hover/focus caption
// shows the title and the user's own rating.

export interface TierTileProps {
  id: string;
  containerId: string;
  meta: TierItemMeta | undefined;
  ratingLabel: string | null;
  untitled: string;
  selected: boolean;
  /** Part of a multi-item drag that isn't the tile under the pointer. */
  carried: boolean;
  thumbSize: ThumbSize;
  showTitle: boolean;
  onSelect: (id: string, event: MouseEvent | KeyboardEvent) => void;
  onSendToPool: (id: string) => void;
}

export function tileCoverSrc(cover: string | null | undefined, size: ThumbSize): string {
  if (!cover) return '';
  const local = wrapAssetUrl(cover);
  return size === 'large' ? toMediumCover(local) : toSmallCover(local);
}

export function TierTileFace({ id, meta, thumbSize, showTitle, untitled }: Pick<TierTileProps, 'id' | 'meta' | 'thumbSize' | 'showTitle' | 'untitled'>) {
  const title = meta?.title || untitled;
  const src = tileCoverSrc(meta?.cover, thumbSize);
  return (
    <>
      {src
        ? <CoverImage externalId={id} src={src} alt="" className="tier-tile-img cover-image-fill" draggable={false} loading="lazy" />
        : <span className="tier-tile-fallback" aria-hidden="true">{title.slice(0, 2).toUpperCase()}</span>}
      {showTitle && <span className="tier-tile-title" aria-hidden="true">{title}</span>}
    </>
  );
}

function TierTileBase(props: TierTileProps) {
  const { id, containerId, meta, ratingLabel, untitled, selected, carried, thumbSize, showTitle, onSelect, onSendToPool } = props;
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id, data: { containerId } });
  const title = meta?.title || untitled;
  const label = ratingLabel ? `${title} — ${ratingLabel}` : title;

  return (
    <div
      ref={setNodeRef}
      data-tile-id={id}
      className={[
        'tier-tile',
        selected && 'tier-tile--selected',
        (isDragging || carried) && 'tier-tile--dragging',
        showTitle && 'tier-tile--titled',
      ].filter(Boolean).join(' ')}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      {...attributes}
      {...listeners}
      aria-label={label}
      aria-pressed={selected}
      onClick={event => onSelect(id, event)}
      onDoubleClick={() => onSendToPool(id)}
    >
      <TierTileFace id={id} meta={meta} thumbSize={thumbSize} showTitle={showTitle} untitled={untitled} />
      <span className="tier-tile-caption" aria-hidden="true">
        <span className="tier-tile-caption-title">{title}</span>
        {ratingLabel && <span className="tier-tile-caption-rating">{ratingLabel}</span>}
      </span>
    </div>
  );
}

export const TierTile = memo(TierTileBase);
