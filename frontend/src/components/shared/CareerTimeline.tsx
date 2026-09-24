import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent } from 'react';
import type { Translations } from '../../i18n/index';
import {
  decadeLabel,
  groupTimeline,
  isMasterpiece,
  layoutTimeline,
  visibleColumns,
  type PositionedColumn,
} from '../../lib/media/career-timeline';
import type { WorkLibraryState } from '../../lib/media/creator-completion';
import { CreatorWorkState, creatorWorkClass } from './CreatorWorkState';

/** One work on the axis, already filtered by the page. */
export interface CareerTimelineItem {
  id: string;
  href: string;
  title: string;
  year: number | null;
  cover: string | null;
  score: number | null | undefined;
  state: WorkLibraryState | null;
  progress: number | null;
  /** Upcoming / DLC tag, as the grid shows it. */
  flag?: string | null;
  /** Left out of the "Active from–to" range (an upcoming work). */
  unreleased?: boolean;
}

interface Props {
  items: readonly CareerTimelineItem[];
  strings: Translations['creator_completion'];
}

// Geometry (px). Kept in sync with .career-timeline-* in creator-works.css.
const COVER_WIDTH = 72;
const COVER_HEIGHT = 108;
const SLOT_WIDTH = COVER_WIDTH + 8;
const ROW_HEIGHT = COVER_HEIGHT + 8;
const MAX_ROWS = 3;
const COLUMN_GAP = 14;
const DECADE_GAP = 30;
// Room above the stacks (tooltips of the top row, decade labels) and below
// them (the axis and the year markers).
const TOP_PAD = 52;
const AXIS_HEIGHT = 36;
const EDGE_PAD = 24;
// Columns rendered beyond each side of the viewport.
const OVERSCAN = 600;
// Before the scroller is measured (server render, tests): a desktop width.
const DEFAULT_VIEWPORT = 1200;
const DRAG_THRESHOLD = 5;

function TimelineWork({ item, row, lane, rows, strings }: {
  item: CareerTimelineItem;
  row: number;
  lane: number;
  rows: number;
  strings: Props['strings'];
}) {
  const great = isMasterpiece(item.score);
  const yearText = item.year != null ? String(item.year) : strings.timeline_unknown_year;
  const label = [item.title, yearText, great ? strings.masterpiece : null].filter(Boolean).join(' · ');
  return (
    <a
      href={item.href}
      className={`career-work${great ? ' career-work--masterpiece' : ''}${creatorWorkClass(item.state)}`}
      style={{ left: lane * SLOT_WIDTH, top: (rows - 1 - row) * ROW_HEIGHT }}
      aria-label={label}
      draggable={false}
    >
      <span className="career-work-cover">
        {item.cover
          ? <img src={item.cover} alt="" loading="lazy" draggable={false} />
          : <span className="career-work-placeholder" aria-hidden="true">{item.title.slice(0, 1).toUpperCase()}</span>}
        {item.flag && <span className="career-work-flag">{item.flag}</span>}
        <CreatorWorkState state={item.state} progress={item.progress} strings={strings} />
      </span>
      {great && <span className="career-work-star" aria-hidden="true">★</span>}
      <span className="career-work-tip" aria-hidden="true">
        <span className="career-work-tip-title">{item.title}</span>
        <span className="career-work-tip-year">{yearText}</span>
      </span>
    </a>
  );
}

function TimelineColumnView({ column, rows, strings }: {
  column: PositionedColumn<CareerTimelineItem>;
  rows: number;
  strings: Props['strings'];
}) {
  const stackHeight = rows * ROW_HEIGHT;
  return (
    <div className="career-column" style={{ left: EDGE_PAD + column.x, top: TOP_PAD, width: column.width }}>
      {column.decadeStart && (
        <span className="career-decade" style={{ left: -(COLUMN_GAP + DECADE_GAP) / 2, top: -TOP_PAD + 6, height: TOP_PAD - 6 + stackHeight }}>
          <span className="career-decade-label">
            {column.decade != null ? decadeLabel(column.decade, strings) : strings.timeline_unknown_year}
          </span>
        </span>
      )}
      <div className="career-column-stack" style={{ height: stackHeight }}>
        {column.works.map((item, i) => (
          <TimelineWork key={item.id} item={item} row={i % rows} lane={Math.floor(i / rows)} rows={rows} strings={strings} />
        ))}
      </div>
      <span className="career-year-marker">{column.year ?? '—'}</span>
    </div>
  );
}

// Horizontal career timeline for the company and author pages: one column
// per year with works (lib/media/career-timeline.ts), decade separators,
// masterpiece halos. Scrolls by drag, wheel and the
// keyboard; only the columns near the viewport are rendered, at fixed
// positions, so a big catalogue neither lags nor shifts.
export function CareerTimeline({ items, strings }: Props) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const [viewport, setViewport] = useState({ left: 0, width: DEFAULT_VIEWPORT });
  const drag = useRef<{ x: number; left: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);

  const layout = useMemo(
    () => layoutTimeline(groupTimeline(items, item => item.year), {
      slotWidth: SLOT_WIDTH, maxRows: MAX_ROWS, decadeGap: DECADE_GAP, columnGap: COLUMN_GAP,
    }),
    [items],
  );

  const trackWidth = layout.totalWidth + EDGE_PAD * 2;
  const trackHeight = TOP_PAD + layout.rows * ROW_HEIGHT + AXIS_HEIGHT;
  const shown = visibleColumns(layout, viewport.left - EDGE_PAD - OVERSCAN, viewport.left + viewport.width + OVERSCAN);

  const measure = useCallback(() => {
    const node = scrollerRef.current;
    if (!node) return;
    setViewport(prev => (prev.left === node.scrollLeft && prev.width === node.clientWidth
      ? prev
      : { left: node.scrollLeft, width: node.clientWidth }));
  }, []);

  // Viewport size + scroll position, batched per frame.
  useEffect(() => {
    const node = scrollerRef.current;
    if (!node) return;
    let frame = 0;
    const schedule = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => { frame = 0; measure(); });
    };
    schedule();
    node.addEventListener('scroll', schedule, { passive: true });
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(schedule) : null;
    observer?.observe(node);
    return () => {
      node.removeEventListener('scroll', schedule);
      observer?.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [measure, trackWidth]);

  // A vertical wheel scrolls the axis sideways while there is room to;
  // at either end the page scrolls as usual. Non-passive to preventDefault.
  useEffect(() => {
    const node = scrollerRef.current;
    if (!node) return;
    const onWheel = (event: WheelEvent) => {
      if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
      const max = node.scrollWidth - node.clientWidth;
      const canScroll = event.deltaY < 0 ? node.scrollLeft > 0 : node.scrollLeft < max - 1;
      if (!canScroll) return;
      event.preventDefault();
      node.scrollLeft += event.deltaY;
    };
    node.addEventListener('wheel', onWheel, { passive: false });
    return () => node.removeEventListener('wheel', onWheel);
  }, []);

  const scrollByPage = (direction: 1 | -1) => {
    const node = scrollerRef.current;
    if (!node) return;
    node.scrollBy({ left: direction * Math.max(SLOT_WIDTH, node.clientWidth * 0.8), behavior: 'smooth' });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const node = scrollerRef.current;
    if (!node) return;
    switch (event.key) {
      case 'ArrowLeft': node.scrollBy({ left: -SLOT_WIDTH * 2 }); break;
      case 'ArrowRight': node.scrollBy({ left: SLOT_WIDTH * 2 }); break;
      case 'PageUp': scrollByPage(-1); break;
      case 'PageDown': scrollByPage(1); break;
      case 'Home': node.scrollTo({ left: 0 }); break;
      case 'End': node.scrollTo({ left: node.scrollWidth }); break;
      default: return;
    }
    event.preventDefault();
  };

  // Mouse drag to pan; a drag that moved doesn't also open the work under
  // the pointer when released.
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== 'mouse' || event.button !== 0) return;
    const node = scrollerRef.current;
    if (!node) return;
    drag.current = { x: event.clientX, left: node.scrollLeft, moved: false };
    const onMove = (move: globalThis.PointerEvent) => {
      const state = drag.current;
      if (!state) return;
      const dx = move.clientX - state.x;
      if (!state.moved && Math.abs(dx) < DRAG_THRESHOLD) return;
      state.moved = true;
      node.classList.add('career-timeline-scroller--dragging');
      node.scrollLeft = state.left - dx;
    };
    const onUp = () => {
      suppressClick.current = drag.current?.moved ?? false;
      drag.current = null;
      node.classList.remove('career-timeline-scroller--dragging');
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  const onClickCapture = (event: MouseEvent<HTMLDivElement>) => {
    if (!suppressClick.current) return;
    suppressClick.current = false;
    event.preventDefault();
    event.stopPropagation();
  };

  return (
    <div className="career-timeline">
      <div
        ref={scrollerRef}
        className="career-timeline-scroller"
        role="region"
        aria-label={strings.timeline_label}
        tabIndex={0}
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onClickCapture={onClickCapture}
      >
        <div className="career-timeline-track" style={{ width: trackWidth, height: trackHeight }}>
          <span className="career-axis" style={{ top: TOP_PAD + layout.rows * ROW_HEIGHT }} aria-hidden="true" />
          {shown.map(column => <TimelineColumnView key={column.key} column={column} rows={layout.rows} strings={strings} />)}
        </div>
      </div>
    </div>
  );
}
