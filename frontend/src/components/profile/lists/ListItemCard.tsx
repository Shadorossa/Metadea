import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { ListItemFull } from '../../../lib/tauri';
import { getT } from '../../../i18n/runtime';
import { fallbackGradient, type ListItemDisplay } from '../../../lib/profile/list-display';

type P = ReturnType<typeof getT>['profile'];

// Everything inside the card except the sortable wrapper div itself — shared
// between the live grid card (wrapped by SortableListItemCard below, with
// real drag listeners) and the DragOverlay clone (a plain floating visual,
// no listeners of its own).
export function ListItemCardBody({ item, display, index, isRanked, readOnly, p, onRemove }: {
  item: ListItemFull;
  display: ListItemDisplay;
  index: number;
  isRanked: boolean;
  readOnly?: boolean;
  p: P;
  onRemove: (id: string) => void;
}) {
  const { cover, url, epBadge, title } = display;
  return (
    <>
      {/* Purely a visual hint now — the whole card is grabbable (see
          SortableListItemCard), not just this handle. */}
      {!readOnly && <span className="list-item-drag-handle" title={p.lists_drag_reorder}>⠿</span>}
      <a className="list-item-cover-link" href={url} draggable={false}>
        {epBadge && <span className="list-item-episode-badge">{epBadge}</span>}
        {cover
          ? <img className="list-item-cover" src={cover} alt={title} loading="lazy" decoding="async" draggable={false} />
          : <div className="list-item-cover list-item-cover--fallback" style={{ background: fallbackGradient(item.media_type) }}><span>{title.slice(0, 2).toUpperCase()}</span></div>}
        <div className="list-item-info">
          <span className="list-item-title">{title}</span>
        </div>
      </a>
      {isRanked && (
        <div className="list-item-rank-bar">
          <span className={`list-item-rank-num${index < 3 ? ` list-item-rank-num--top${index + 1}` : ''}`}>
            <span className="list-item-rank-prefix">#</span>
            <span className="list-item-rank-val">{index + 1}</span>
          </span>
        </div>
      )}
      {!readOnly && (
        <button className="list-item-remove" title={p.lists_remove} onClick={() => onRemove(item.external_id)}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
        </button>
      )}
    </>
  );
}

export function SortableListItemCard({ item, display, index, isRanked, readOnly, p, onRemove }: {
  item: ListItemFull;
  display: ListItemDisplay;
  index: number;
  isRanked: boolean;
  readOnly?: boolean;
  p: P;
  onRemove: (id: string) => void;
}) {
  // Grabbable from anywhere on the card (matching the old implementation),
  // not just the ⠿ handle — the handle is a low-opacity, top-corner-only
  // hint that's easy to miss/miss-click, so attributes/listeners go on the
  // whole card instead. PointerSensor's activationConstraint (see
  // ListDetail's dndSensors) is what actually distinguishes a click on the
  // cover link/remove button from a drag start now, so this doesn't need
  // its own click-vs-drag suppression the way the old manual implementation
  // did (its didDrag flag + capture-phase click handler).
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.external_id,
    disabled: readOnly,
  });
  return (
    <div
      ref={setNodeRef}
      className={`list-item-card${display.isEpItem ? ' list-item-card--episode' : ''}${isDragging ? ' list-item-card--ghost' : ''}`}
      data-id={item.external_id}
      style={{
        transform: isDragging ? undefined : CSS.Transform.toString(transform),
        transition,
      }}
      {...attributes}
      {...listeners}
    >
      <ListItemCardBody
        item={item} display={display} index={index} isRanked={isRanked} readOnly={readOnly} p={p} onRemove={onRemove}
      />
    </div>
  );
}
