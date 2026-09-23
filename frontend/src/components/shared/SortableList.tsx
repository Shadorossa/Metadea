import {
  createContext, useCallback, useContext, useEffect, useRef, useState,
  type CSSProperties, type HTMLAttributes, type PointerEvent as ReactPointerEvent, type ReactNode, type RefCallback,
} from 'react';
import { createPortal } from 'react-dom';
import {
  DndContext, KeyboardSensor, PointerSensor, closestCenter, pointerWithin, useSensor, useSensors,
  type Announcements, type CollisionDetection, type DragEndEvent, type DragMoveEvent, type DragOverEvent, type DragStartEvent,
  type PointerSensorOptions, type UniqueIdentifier,
} from '@dnd-kit/core';
import { SortableContext, rectSortingStrategy, sortableKeyboardCoordinates, useSortable, type SortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { getT } from '../../i18n/runtime';
import { classifyDropZone, fillTemplate, resolveDrop, type DropSide, type GroupState } from './sortable-list-logic';

// Reorderable list on @dnd-kit, shared by the PR editor's saga chain,
// relation card grids and story-arc units. Each call site keeps its own
// markup: wrap the items in <SortableList>, and render each one through
// <SortableItem>, whose render prop hands back the props to spread on the
// node (ref, aria attributes, pointer/keyboard listeners, transform style)
// plus the drag/drop state to derive classes from.
//
// Keyboard path (dnd-kit's KeyboardSensor): Tab to an item, Space/Enter to
// pick it up, arrow keys to move it, Space/Enter to drop, Escape to cancel.
// Lists that pass `onGroup` add one key: while an item is picked up, G
// toggles "group with the highlighted item" for the next drop — the same
// outcome the mouse gets by dwelling (`groupTrigger: 'dwell'`) or by hovering
// the middle of a card (`groupTrigger: 'zone'`). Every item's
// aria-describedby points at instructions that spell this out, and moves are
// announced through DndContext's live region with i18n strings.

export interface SortableListActions {
  onReorder: (fromIndex: number, toIndex: number) => void;
  onGroup?: (fromIndex: number, toIndex: number) => void;
  canGroup?: (fromIndex: number, toIndex: number) => boolean;
}

export type GroupTrigger = 'dwell' | 'zone';

export interface SortableHandleProps extends HTMLAttributes<HTMLElement> {
  ref: RefCallback<HTMLElement>;
}

export interface SortableItemState {
  handleProps: SortableHandleProps;
  isDragging: boolean;
  // This item is the current drop target of another item.
  isOver: boolean;
  // 'pending' while a dwell timer runs on this target, 'ready' when the next
  // drop groups instead of reordering (timer elapsed, middle zone, or G).
  groupState: GroupState;
  // Zone mode only: which side of this target the drop would insert on.
  dropSide: DropSide | null;
}

interface Props extends SortableListActions {
  ids: string[];
  groupTrigger?: GroupTrigger;
  dwellMs?: number;
  strategy?: SortingStrategy;
  // Whether siblings slide out of the way while dragging. Off for lists that
  // show their own before/after indicators instead.
  shiftItems?: boolean;
  getLabel?: (id: string) => string;
  children: ReactNode;
}

interface ListContextValue {
  activeId: string | null;
  overId: string | null;
  groupState: GroupState;
  dropSide: DropSide | null;
  shiftItems: boolean;
}

const SortableListContext = createContext<ListContextValue>({ activeId: null, overId: null, groupState: 'none', dropSide: null, shiftItems: true });

// Clicks on nested controls (remove button, inputs, selects) behave normally
// instead of starting a drag — the same exemption the native-DnD hook made.
const INTERACTIVE_SELECTOR = 'button, input, textarea, select';

class ControlAwarePointerSensor extends PointerSensor {
  static activators = [{
    eventName: 'onPointerDown' as const,
    handler: ({ nativeEvent: event }: ReactPointerEvent, { onActivation }: PointerSensorOptions) => {
      if (!event.isPrimary || event.button !== 0) return false;
      if (event.target instanceof Element && event.target.closest(INTERACTIVE_SELECTOR)) return false;
      onActivation?.({ event });
      return true;
    },
  }];
}

// Pointer drags need to actually be over a card to target it (so a dwell
// cannot start from the gap between cards); keyboard drags have no pointer
// and fall through to the nearest centre.
const overCardOrNearest: CollisionDetection = args => {
  const within = pointerWithin(args);
  return within.length ? within : closestCenter(args);
};

const HIDDEN_STYLE: CSSProperties = {
  position: 'absolute', width: 1, height: 1, margin: -1, padding: 0, overflow: 'hidden',
  clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', border: 0,
};

function pointerClientX(event: Event | null): number | null {
  return event instanceof MouseEvent ? event.clientX : null;
}

export function SortableList({
  ids, onReorder, onGroup, canGroup, groupTrigger = 'dwell', dwellMs = 1000,
  strategy = rectSortingStrategy, shiftItems = true, getLabel, children,
}: Props) {
  const r = getT().pr_editor.reorder;
  const sensors = useSensors(
    useSensor(ControlAwarePointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const [activeId, setActiveId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [groupState, setGroupState] = useState<GroupState>('none');
  const [dropSide, setDropSide] = useState<DropSide | null>(null);
  const [liveMessage, setLiveMessage] = useState('');
  // Mirrors of the state above for the dwell timer and the document-level
  // G listener, which cannot rely on render closures.
  const activeRef = useRef<string | null>(null);
  const overRef = useRef<string | null>(null);
  const groupStateRef = useRef<GroupState>('none');
  const dropSideRef = useRef<DropSide | null>(null);
  const dwellTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastDropRef = useRef<'group' | 'reorder' | null>(null);

  const indexOf = (id: UniqueIdentifier | null | undefined) => (id == null ? -1 : ids.indexOf(String(id)));
  const label = (id: UniqueIdentifier | null | undefined) => (id == null ? '' : getLabel?.(String(id)) ?? String(id));
  const canGroupIds = (from: UniqueIdentifier, to: UniqueIdentifier | null | undefined) => {
    if (!onGroup || to == null || from === to) return false;
    const fromIndex = indexOf(from);
    const toIndex = indexOf(to);
    if (fromIndex < 0 || toIndex < 0) return false;
    return canGroup ? canGroup(fromIndex, toIndex) : true;
  };

  const updateGroupState = (next: GroupState) => { groupStateRef.current = next; setGroupState(next); };
  const updateDropSide = (next: DropSide | null) => { dropSideRef.current = next; setDropSide(next); };
  const clearDwellTimer = () => {
    if (dwellTimerRef.current) clearTimeout(dwellTimerRef.current);
    dwellTimerRef.current = null;
  };
  const reset = () => {
    clearDwellTimer();
    activeRef.current = null;
    overRef.current = null;
    setActiveId(null);
    setOverId(null);
    updateGroupState('none');
    updateDropSide(null);
  };

  useEffect(() => clearDwellTimer, []);

  const handleDragStart = ({ active }: DragStartEvent) => {
    activeRef.current = String(active.id);
    setActiveId(String(active.id));
    lastDropRef.current = null;
    setLiveMessage('');
  };

  // Dwelling only arms grouping for pointer drags — a keyboard user pausing
  // on a position must not get grouped by surprise; they press G instead.
  const handleDragOver = ({ active, over, activatorEvent }: DragOverEvent) => {
    clearDwellTimer();
    const nextOver = over ? String(over.id) : null;
    overRef.current = nextOver;
    setOverId(nextOver);
    updateDropSide(null);
    if (!over || over.id === active.id || !canGroupIds(active.id, over.id)) {
      updateGroupState('none');
      return;
    }
    if (groupTrigger !== 'dwell' || activatorEvent instanceof KeyboardEvent) return;
    updateGroupState('pending');
    dwellTimerRef.current = setTimeout(() => {
      if (overRef.current !== nextOver || activeRef.current === null) return;
      updateGroupState('ready');
      setLiveMessage(fillTemplate(r.group_on, { item: label(active.id), target: label(nextOver) }));
    }, dwellMs);
  };

  // Zone mode: the pointer's horizontal position inside the target card
  // decides between insert-before, group and insert-after. Keyboard drags
  // carry no pointer, so they keep the plain reorder unless G arms grouping.
  const handleDragMove = ({ active, over, delta, activatorEvent }: DragMoveEvent) => {
    if (groupTrigger !== 'zone' || !over || over.id === active.id) return;
    const originX = pointerClientX(activatorEvent);
    if (originX === null || over.rect.width <= 0) return;
    const ratio = (originX + delta.x - over.rect.left) / over.rect.width;
    const zone = classifyDropZone(ratio, canGroupIds(active.id, over.id));
    updateDropSide(zone === 'group' ? null : zone);
    updateGroupState(zone === 'group' ? 'ready' : 'none');
  };

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    const from = indexOf(active.id);
    const target = indexOf(over?.id);
    const result = resolveDrop({
      from, target, groupState: groupStateRef.current, canGroup: canGroupIds(active.id, over?.id), side: dropSideRef.current,
    });
    lastDropRef.current = result?.kind ?? null;
    if (result?.kind === 'group') onGroup?.(from, result.to);
    else if (result?.kind === 'reorder') onReorder(from, result.to);
    reset();
  };

  // G while an item is picked up toggles grouping with the highlighted item.
  useEffect(() => {
    if (!activeId || !onGroup) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== 'g' || event.ctrlKey || event.metaKey || event.altKey) return;
      const active = activeRef.current;
      const over = overRef.current;
      if (!active || !over || !canGroupIds(active, over)) return;
      event.preventDefault();
      clearDwellTimer();
      const arming = groupStateRef.current !== 'ready';
      updateGroupState(arming ? 'ready' : 'none');
      updateDropSide(null);
      setLiveMessage(fillTemplate(arming ? r.group_on : r.group_off, { item: label(active), target: label(over) }));
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  });

  const count = ids.length;
  const announcements: Announcements = {
    onDragStart: ({ active }) =>
      fillTemplate(r.picked_up, { item: label(active.id), from: indexOf(active.id) + 1, count }),
    onDragOver: ({ active, over }) => (over
      ? fillTemplate(r.moved, { item: label(active.id), to: indexOf(over.id) + 1, count })
      : fillTemplate(r.no_target, { item: label(active.id) })),
    onDragEnd: ({ active, over }) => {
      if (lastDropRef.current === 'group') return fillTemplate(r.grouped, { item: label(active.id), target: label(over?.id) });
      if (lastDropRef.current === 'reorder') return fillTemplate(r.dropped, { item: label(active.id), to: indexOf(active.id) + 1, count });
      return fillTemplate(r.cancelled, { item: label(active.id) });
    },
    onDragCancel: ({ active }) => fillTemplate(r.cancelled, { item: label(active.id) }),
  };
  const instructions = onGroup ? `${r.instructions} ${r.instructions_group}` : r.instructions;

  return (
    <SortableListContext.Provider value={{ activeId, overId, groupState, dropSide, shiftItems }}>
      <DndContext
        sensors={sensors}
        collisionDetection={overCardOrNearest}
        accessibility={{ announcements, screenReaderInstructions: { draggable: instructions } }}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragMove={groupTrigger === 'zone' ? handleDragMove : undefined}
        onDragEnd={handleDragEnd}
        onDragCancel={reset}
      >
        <SortableContext items={ids} strategy={strategy}>
          {children}
        </SortableContext>
      </DndContext>
      {typeof document !== 'undefined' && createPortal(
        <div aria-live="assertive" aria-atomic="true" style={HIDDEN_STYLE}>{liveMessage}</div>,
        document.body,
      )}
    </SortableListContext.Provider>
  );
}

interface ItemProps {
  id: string;
  disabled?: boolean;
  children: (state: SortableItemState) => ReactNode;
}

export function SortableItem({ id, disabled, children }: ItemProps) {
  const list = useContext(SortableListContext);
  const r = getT().pr_editor.reorder;
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id, disabled, attributes: { roleDescription: r.role_description },
  });
  // The whole node is both the sortable and its activator, so dnd-kit ignores
  // Space/Enter pressed on a nested button (it checks event.target against
  // the activator node) and the button keeps its own keyboard behaviour.
  const ref = useCallback((node: HTMLElement | null) => {
    setNodeRef(node);
    setActivatorNodeRef(node);
  }, [setNodeRef, setActivatorNodeRef]);

  const style: CSSProperties | undefined = list.shiftItems || isDragging
    ? { transform: CSS.Transform.toString(transform), transition }
    : undefined;
  const isOver = list.overId === id && list.activeId !== id;
  const handleProps = { ref, style, ...attributes, ...listeners } as SortableHandleProps;

  return <>{children({
    handleProps,
    isDragging,
    isOver,
    groupState: isOver ? list.groupState : 'none',
    dropSide: isOver ? list.dropSide : null,
  })}</>;
}
