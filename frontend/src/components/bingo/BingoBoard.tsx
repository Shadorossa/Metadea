// The Yearly Bingo grid, shared by the Home modal (edit/view/result), the
// profile tab and other users' profiles (view/result). ceil(sqrt(size))
// columns (lib/bingo/bingo-grid.ts); the CSS centres an incomplete last row
// and shrinks cells on big boards. Editing reorders cells with the shared
// SortableList (drag, or keyboard: Space to pick up, arrows, Space to drop);
// "+" on an empty cell asks the parent to pick a work for it.
import type { CSSProperties } from 'react';
import { getT } from '../../i18n/runtime';
import type { BingoCell } from '../../lib/tauri/yearly-bingo';
import type { BingoResult } from '../../lib/bingo/bingo-result';
import { bingoColumns } from '../../lib/bingo/bingo-grid';
import { formatRatingHtml, type RatingSystem } from '../../lib/media/rating-utils';
import { getTypeLabel } from '../../lib/media/media-types';
import { toMediumCover } from '../../lib/media/small-cover';
import { wrapAssetUrl } from '../../lib/tauri/bridge';
import { typeIconMap } from '../../lib/dom/icon-strings';
import { interpolate } from '../../lib/shared/text/interpolate';
import { CoverImage } from '../shared/CoverImage';
import { SortableItem, SortableList, type SortableHandleProps } from '../shared/SortableList';

const TYPE_ICON = typeIconMap(12);
/** From this many columns on, cells drop the caption to stay legible. */
const DENSE_COLUMNS = 6;

export interface BingoSlot {
  /** Stable across reorders (the work's id, or a generated one for an empty cell). */
  key: string;
  item: BingoCell;
}

interface CellProps {
  item: BingoCell;
  index: number;
  editable: boolean;
  result: BingoResult | null;
  inLine: boolean;
  ratingSystem: RatingSystem;
  handleProps?: SortableHandleProps;
  dragging?: boolean;
  onAdd?: (index: number) => void;
  onRemove?: (index: number) => void;
}

function BingoCellView({ item, index, editable, result, inLine, ratingSystem, handleProps, dragging, onAdd, onRemove }: CellProps) {
  const b = getT().bingo;
  if (!item) {
    return (
      <li {...handleProps} className={`bingo-cell bingo-cell--empty${dragging ? ' is-dragging' : ''}`}>
        {editable && (
          <button type="button" className="bingo-cell-add" onClick={() => onAdd?.(index)} aria-label={b.add_work} title={b.add_work}>
            <span aria-hidden="true">+</span>
          </button>
        )}
      </li>
    );
  }
  const cellResult = result?.cells[index] ?? null;
  const classes = [
    'bingo-cell',
    cellResult?.done ? 'is-done' : '',
    result && !cellResult?.done ? 'is-missed' : '',
    inLine ? 'in-line' : '',
    dragging ? 'is-dragging' : '',
  ].filter(Boolean).join(' ');
  const cover = item.cover_url
    ? <CoverImage externalId={item.external_id} className="bingo-cell-cover" src={wrapAssetUrl(toMediumCover(item.cover_url))} alt="" loading="lazy" decoding="async" draggable={false} />
    : <span className="bingo-cell-cover bingo-cell-cover--empty" aria-hidden="true">{item.title.slice(0, 2).toUpperCase()}</span>;
  const body = (
    <>
      {cover}
      <span className="bingo-cell-type" title={getTypeLabel(item.media_type)} aria-hidden="true" dangerouslySetInnerHTML={{ __html: TYPE_ICON[item.media_type] ?? '' }} />
      {cellResult && (
        <span className="bingo-cell-status" title={cellResult.done ? b.done : b.not_done}>
          <span aria-hidden="true">{cellResult.done ? '✓' : '–'}</span>
          <span className="bingo-sr-only">{cellResult.done ? b.done : b.not_done}</span>
        </span>
      )}
      <span className="bingo-cell-caption">
        <span className="bingo-cell-title">{item.title || item.external_id}</span>
        {cellResult?.rating != null && (
          <span className="bingo-cell-score" title={b.score_label} dangerouslySetInnerHTML={{ __html: formatRatingHtml(cellResult.rating, ratingSystem, 'bingo-cell-rating') }} />
        )}
      </span>
    </>
  );
  return (
    <li {...handleProps} className={classes}>
      {editable ? (
        <>
          <div className="bingo-cell-body">{body}</div>
          <button
            type="button"
            className="bingo-cell-remove"
            aria-label={interpolate(b.remove_work, { title: item.title })}
            title={interpolate(b.remove_work, { title: item.title })}
            onClick={() => onRemove?.(index)}
          >
            ×
          </button>
        </>
      ) : (
        <a className="bingo-cell-body" href={`/media?id=${encodeURIComponent(item.external_id)}`}>{body}</a>
      )}
    </li>
  );
}

interface Props {
  slots: BingoSlot[];
  editable: boolean;
  result: BingoResult | null;
  ratingSystem: RatingSystem;
  onAdd?: (index: number) => void;
  onRemove?: (index: number) => void;
  onReorder?: (from: number, to: number) => void;
}

export function BingoBoard({ slots, editable, result, ratingSystem, onAdd, onRemove, onReorder }: Props) {
  const b = getT().bingo;
  const inLine = new Set(result?.lines.flat() ?? []);
  const columns = bingoColumns(slots.length);
  const boardClass = `bingo-board${columns >= DENSE_COLUMNS ? ' is-dense' : ''}`;
  const boardStyle = { '--bingo-cols': columns } as CSSProperties;
  const cellProps = (slot: BingoSlot, index: number) => ({
    item: slot.item, index, editable, result, inLine: inLine.has(index), ratingSystem, onAdd, onRemove,
  });

  if (!editable || !onReorder) {
    return (
      <ol className={boardClass} style={boardStyle}>
        {slots.map((slot, index) => <BingoCellView key={slot.key} {...cellProps(slot, index)} />)}
      </ol>
    );
  }
  return (
    <SortableList
      ids={slots.map(s => s.key)}
      onReorder={onReorder}
      getLabel={key => slots.find(s => s.key === key)?.item?.title ?? b.add_work}
    >
      <ol className={`${boardClass} is-editable`} style={boardStyle}>
        {slots.map((slot, index) => (
          <SortableItem key={slot.key} id={slot.key}>
            {({ handleProps, isDragging }) => <BingoCellView {...cellProps(slot, index)} handleProps={handleProps} dragging={isDragging} />}
          </SortableItem>
        ))}
      </ol>
    </SortableList>
  );
}
