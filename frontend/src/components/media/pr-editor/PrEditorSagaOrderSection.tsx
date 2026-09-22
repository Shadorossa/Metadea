import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { MetaResolver } from '../../../lib/media/sagaGrouping';
import type { DragHandlers } from '../hooks/useDragReorder';

interface Props {
  externalId: string;
  sagaOrder: string[];
  sagaGroups: Record<string, string>;
  draggedIndex: number | null;
  dragHandlers: (index: number) => DragHandlers;
  groupTargetIndex: number | null;
  groupDropReady: boolean;
  onRemove: (id: string) => void;
  onUngroup: (ids: string[]) => void;
  onEditWork?: (id: string) => void;
  resolveMeta: MetaResolver;
}

// Chronological saga timeline. The current work is highlighted and remains
// fixed in the chain; other entries can still be reordered or removed.
export function PrEditorSagaOrderSection({
  externalId, sagaOrder, sagaGroups,
  draggedIndex, dragHandlers, groupTargetIndex, groupDropReady, onRemove, onUngroup, onEditWork, resolveMeta,
}: Props) {
  const currentItemRef = useRef<HTMLDivElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const [contextMenu, setContextMenu] = useState<{ id: string; x: number; y: number } | null>(null);

  const timelineUnits: { key: string; ids: string[] }[] = [];
  const groupedUnits = new Map<string, { key: string; ids: string[] }>();
  sagaOrder.forEach(id => {
    const group = sagaGroups[id]?.trim();
    if (!group) {
      timelineUnits.push({ key: id, ids: [id] });
      return;
    }
    const existing = groupedUnits.get(group);
    if (existing) {
      existing.ids.push(id);
      return;
    }
    const unit = { key: `group:${group}`, ids: [id] };
    groupedUnits.set(group, unit);
    timelineUnits.push(unit);
  });

  useEffect(() => {
    currentItemRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  }, [externalId]);

  useEffect(() => {
    const timeline = timelineRef.current;
    if (!timeline) return;
    const markLastItemsInRows = () => {
      const items = Array.from(timeline.querySelectorAll<HTMLElement>('[data-saga-timeline-item]'));
      items.forEach((item, index) => {
        const next = items[index + 1];
        item.toggleAttribute('data-row-last', !next || Math.abs(item.getBoundingClientRect().top - next.getBoundingClientRect().top) > 1);
      });
    };
    markLastItemsInRows();
    const observer = new ResizeObserver(markLastItemsInRows);
    observer.observe(timeline);
    return () => observer.disconnect();
  }, [sagaOrder, sagaGroups]);

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') close(); };
    window.addEventListener('pointerdown', close);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [contextMenu]);

  const renderItem = (id: string, nextUnitIsGroup = false) => {
    const index = sagaOrder.indexOf(id);
    const meta = resolveMeta(id);
    const isCurrent = id === externalId;
    const isGroupingTarget = groupTargetIndex === index;

    return (
      <div
        key={id}
        ref={isCurrent ? currentItemRef : undefined}
        data-saga-timeline-item
        data-next-group={nextUnitIsGroup || undefined}
        className={`pr-editor-saga-timeline-item${isCurrent ? ' is-current' : ''}${isGroupingTarget ? ` is-grouping${groupDropReady ? ' is-group-drop-ready' : ''}` : ''}`}
      >
        <span className="pr-editor-saga-timeline-year">{meta.release_year ?? ''}</span>
        <span className="pr-editor-saga-timeline-node" aria-label={isCurrent ? 'Obra actual' : undefined} />
        <div
        title={`${meta.title || id} · Mantén 1 s sobre otra obra para agrupar versiones alternativas`}
        className={`pr-editor-media-card${isCurrent ? ' pr-editor-media-card--current' : ''}${draggedIndex === index ? ' pr-editor-media-card--dragging' : ''}`}
        onContextMenu={event => {
          if (!onEditWork || isCurrent) return;
          event.preventDefault();
          event.stopPropagation();
          setContextMenu({ id, x: event.clientX, y: event.clientY });
        }}
        {...dragHandlers(index)}
        >
        <div className="pr-editor-media-card-cover">
          {meta.cover
            ? <img className="cover-image-fill" src={meta.cover} alt="" draggable={false} />
            : <div className="pr-editor-media-card-placeholder" />}
          <div className="pr-editor-saga-timeline-title" title={meta.title || id}>
            {meta.title || id}
          </div>
          {!isCurrent && (
              <button type="button" className="pr-editor-media-card-remove" onClick={() => onRemove(id)}>
                x
              </button>
            )}
          </div>
      </div>
      </div>
    );
  };

  return (
    <div className="pr-editor-subsection pr-editor-subsection--saga">
      <div ref={timelineRef} className="pr-editor-saga-timeline" aria-label="Orden cronológico de la saga">
        {timelineUnits.map((unit, unitIndex) => {
          const nextUnitIsGroup = timelineUnits[unitIndex + 1]?.ids.length > 1;
          return unit.ids.length > 1 ? (
          <div key={unit.key} className="pr-editor-saga-timeline-group" aria-label="Versiones alternativas">
            <button
              type="button"
              className="pr-editor-saga-timeline-ungroup"
              title="Eliminar este conjunto de alternativas"
              aria-label="Eliminar este conjunto de alternativas"
              onClick={() => onUngroup(unit.ids)}
            >
              ×
            </button>
            {unit.ids.map((id, index) => renderItem(id, index === unit.ids.length - 1 && nextUnitIsGroup))}
          </div>
          ) : renderItem(unit.ids[0], nextUnitIsGroup);
        })}
      </div>
      {contextMenu && onEditWork && createPortal(
        <div
          className="pr-editor-saga-context-menu"
          role="menu"
          style={{ left: Math.min(contextMenu.x, window.innerWidth - 210), top: Math.min(contextMenu.y, window.innerHeight - 60) }}
          onPointerDown={event => event.stopPropagation()}
        >
          <button type="button" role="menuitem" onClick={() => { onEditWork(contextMenu.id); setContextMenu(null); }}>
            Editar esta obra
          </button>
        </div>,
        document.body,
      )}
    </div>
  );
}
