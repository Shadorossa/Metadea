import { useEffect, useLayoutEffect, useRef, useState, type WheelEvent } from 'react';
import { Heart, Monitor } from 'lucide-react';
import type { BigPictureItem } from '../../lib/big-picture/categories';
import { indexToPos } from '../../lib/big-picture/focus-grid';
import { CoverImage } from '../shared/CoverImage';

const GAP = 28;
const TITLE_HEIGHT = 44;
const MIN_CARD = 150;
const MAX_CARD = 250;
// Rows kept mounted beyond the visible ones (above / below) — the ones
// below double as the preload of the next covers.
const OVERSCAN_ABOVE = 1;
const OVERSCAN_BELOW = 2;
// Room around the track for the focused card's scale + glow
// (.bp-grid-track's inset in big-picture.css).
const EDGE = 20;

interface GridMetrics {
  width: number;
  height: number;
  columns: number;
  cardWidth: number;
  rowHeight: number;
}

function computeMetrics(width: number, height: number): GridMetrics {
  const target = Math.min(MAX_CARD, Math.max(MIN_CARD, width / 6.2));
  const columns = Math.max(1, Math.floor((width + GAP) / (target + GAP)));
  const cardWidth = Math.floor((width - GAP * (columns - 1)) / columns);
  return { width, height, columns, cardWidth, rowHeight: Math.round(cardWidth * 1.5) + TITLE_HEIGHT + GAP };
}

interface BigPictureGridProps {
  items: BigPictureItem[];
  focusIndex: number;
  /** Move real DOM focus onto the focused card (browse layer on top). */
  domFocus: boolean;
  onColumnsChange: (columns: number) => void;
  onCardClick: (index: number) => void;
  onWheelStep: (rows: 1 | -1) => void;
  emptyLabel: string;
  favoriteLabel: string;
}

// The carousel grid: covers laid out in rows, only the rows near the focus
// mounted, the whole track translated (transform only) so the focused row
// stays centred. Measures itself and reports its column count upward, where
// focus movement is computed (lib/big-picture/focus-grid).
export function BigPictureGrid({
  items, focusIndex, domFocus, onColumnsChange, onCardClick, onWheelStep, emptyLabel, favoriteLabel,
}: BigPictureGridProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const focusedRef = useRef<HTMLButtonElement>(null);
  const [metrics, setMetrics] = useState<GridMetrics | null>(null);

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => {
      const next = computeMetrics(el.clientWidth - EDGE * 2, el.clientHeight - EDGE * 2);
      setMetrics(prev => (prev && prev.width === next.width && prev.height === next.height ? prev : next));
    };
    // ResizeObserver also reports the initial size right after observe().
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const columns = metrics?.columns ?? 1;
  useEffect(() => { if (metrics) onColumnsChange(metrics.columns); }, [metrics, onColumnsChange]);

  // Also re-runs once the first measurement mounts the cards (after the
  // dialog shell's own initial focus).
  useEffect(() => {
    if (domFocus) focusedRef.current?.focus({ preventScroll: true });
  }, [domFocus, focusIndex, items, metrics]);

  const lastWheel = useRef(0);
  const onWheel = (e: WheelEvent<HTMLDivElement>) => {
    const now = performance.now();
    if (Math.abs(e.deltaY) < 4 || now - lastWheel.current < 120) return;
    lastWheel.current = now;
    onWheelStep(e.deltaY > 0 ? 1 : -1);
  };

  const rows = Math.ceil(items.length / columns);
  const rowHeight = metrics?.rowHeight ?? 1;
  const height = metrics?.height ?? 0;
  const focusRow = indexToPos(focusIndex, columns).row;
  const totalHeight = rows * rowHeight;
  const centred = height / 2 - (focusRow * rowHeight + rowHeight / 2);
  const offset = Math.round(Math.min(0, Math.max(Math.min(0, height - totalHeight), centred)));
  const firstRow = Math.max(0, Math.floor(-offset / rowHeight) - OVERSCAN_ABOVE);
  const lastRow = Math.min(rows - 1, Math.ceil((height - offset) / rowHeight) + OVERSCAN_BELOW);
  const visible = metrics ? items.slice(firstRow * columns, (lastRow + 1) * columns) : [];

  return (
    <div className={`bp-grid${items.length === 0 ? ' bp-grid--empty' : ''}`} ref={containerRef} onWheel={onWheel}>
      {items.length === 0 && <p>{emptyLabel}</p>}
      <div className="bp-grid-track" style={{ height: totalHeight, transform: `translate3d(0, ${offset}px, 0)` }}>
        {visible.map((item, i) => {
          const index = firstRow * columns + i;
          const { row, col } = indexToPos(index, columns);
          const focused = index === focusIndex;
          const cardWidth = metrics?.cardWidth ?? 0;
          const progress = item.progress?.total ? Math.min(1, item.progress.current / item.progress.total) : null;
          return (
            <button
              key={item.key}
              ref={focused ? focusedRef : undefined}
              type="button"
              className={`bp-card${focused ? ' is-focused' : ''}`}
              style={{ width: cardWidth, transform: `translate3d(${col * (cardWidth + GAP)}px, ${row * rowHeight}px, 0)` }}
              aria-label={item.title}
              aria-current={focused ? 'true' : undefined}
              tabIndex={focused ? 0 : -1}
              onClick={() => onCardClick(index)}
            >
              <span className="bp-card-cover" style={{ height: Math.round(cardWidth * 1.5) }}>
                {item.cover
                  ? <CoverImage externalId={item.externalId} src={item.cover} alt="" loading={Math.abs(row - focusRow) <= 1 ? 'eager' : 'lazy'} decoding="async" draggable={false} />
                  : <span className="bp-card-placeholder"><Monitor size={40} aria-hidden="true" /><span>{item.title}</span></span>}
                {item.favorite && <span className="bp-card-fav" title={favoriteLabel}><Heart size={16} fill="currentColor" aria-hidden="true" /></span>}
                {progress !== null && <span className="bp-card-progress"><span style={{ transform: `scaleX(${progress})` }} /></span>}
              </span>
              <span className="bp-card-title">{item.title}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
